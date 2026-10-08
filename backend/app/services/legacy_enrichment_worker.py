"""One short, fenced legacy-enrichment claim per provider request."""

import asyncio
import logging
from uuid import uuid4

from sqlalchemy import text

from app.services import editorial_generation
from app.services.curriculum import catalog_lock
from app.services.editorial_accounts import lock_accounts
from app.services.generation import GenerationError, RateLimitedError
from app.services.generation_budget import (
    GenerationBudgetExhausted,
    GenerationBusy,
    check_generation_capacity,
    reserve_generation_call,
)
from app.services.legacy_generation import (
    LegacyConfigurationError,
    LegacyRetryableError,
    LegacyValidationError,
    generate_legacy_card,
)
from app.services.publication import LessonBody, stage_revision
from app.services.review_capacity import review_load

log = logging.getLogger(__name__)


async def _locks(db):
    await lock_accounts(db)
    await catalog_lock(db)


async def _finish_batch_if_empty(db, batch_id):
    waiting = await db.scalar(text("""select exists(select 1 from editorial_legacy_batch_entries
      where batch_id=:id and status in ('queued','generating'))"""), {'id': batch_id})
    if not waiting:
        await db.execute(text("""update editorial_legacy_batches
          set status='completed',finished_at=clock_timestamp()
          where id=:id and status='running'"""), {'id': batch_id})


async def claim(db, settings):
    try:
        await _locks(db)
        await db.execute(text("""update editorial_legacy_batch_entries
          set status=case when attempts>=3 then 'failed' else 'queued' end,
          claim_token=null,claimed_at=null,failure_code='stale_claim',updated_at=clock_timestamp()
          where status='generating' and claimed_at<now()-interval '30 minutes'"""))
        batch = (await db.execute(text("""select * from editorial_legacy_batches
          where status='running' order by started_at,id for update skip locked limit 1"""))).mappings().first()
        if batch is None:
            await db.commit()
            return None, 'empty'
        if not await editorial_generation.requester_active(db, batch):
            await db.execute(text("""update editorial_legacy_batches
              set status='failed',finished_at=clock_timestamp() where id=:id"""), {'id': batch['id']})
            await db.execute(text("""update editorial_legacy_batch_entries set status='skipped',
              failure_code='requester_inactive',updated_at=clock_timestamp()
              where batch_id=:id and status='queued'"""), {'id': batch['id']})
            await db.commit()
            return None, 'requester_inactive'
        used = await db.scalar(text("""select coalesce(sum(attempts),0)::int
          from editorial_legacy_batch_entries where batch_id=:id"""), {'id': batch['id']})
        if used >= batch['quota_limit']:
            # A reserved call may still finish successfully. Do not fail its
            # batch or discard its private draft before that claim settles.
            in_flight = await db.scalar(text("""select exists(select 1
              from editorial_legacy_batch_entries where batch_id=:id
              and status='generating')"""), {'id': batch['id']})
            if in_flight:
                await db.commit()
                return None, 'in_progress'
            queued = await db.scalar(text("""select exists(select 1
              from editorial_legacy_batch_entries where batch_id=:id
              and status='queued')"""), {'id': batch['id']})
            if not queued:
                await _finish_batch_if_empty(db, batch['id'])
                await db.commit()
                return None, 'empty'
            await db.execute(text("""update editorial_legacy_batches
              set status='failed',finished_at=clock_timestamp() where id=:id"""), {'id': batch['id']})
            await db.execute(text("""update editorial_legacy_batch_entries set status='skipped',
              failure_code='batch_quota_exhausted',updated_at=clock_timestamp()
              where batch_id=:id and status='queued'"""), {'id': batch['id']})
            await db.commit()
            return None, 'batch_quota_exhausted'
        entry = (await db.execute(text("""select e.*,c.slug,c.content_version,c.status as concept_status,
          t.name as topic_name,s.name as subtopic_name
          from editorial_legacy_batch_entries e
          join concepts c on c.id=e.concept_id
          join topics t on t.id=c.topic_id
          join subtopics s on s.id=c.subtopic_id
          where e.batch_id=:id and e.status='queued' and e.attempts<3
          order by e.created_at,e.id for update of e skip locked limit 1"""),
          {'id': batch['id']})).mappings().first()
        if entry is None:
            await _finish_batch_if_empty(db, batch['id'])
            in_flight = await db.scalar(text("""select exists(select 1
              from editorial_legacy_batch_entries where batch_id=:id
              and status='generating')"""), {'id': batch['id']})
            await db.commit()
            return None, 'in_progress' if in_flight else 'empty'
        if await review_load(db, batch['topic_id']) >= settings.content_review_backlog_limit:
            await db.commit()
            return None, 'review_capacity_full'
        if (entry['concept_status'] != 'published' or
                entry['content_version'] != entry['base_version'] or
                await db.scalar(text("""select exists(select 1 from concept_revisions
                  where concept_id=:id and status in ('draft','generating','validation_failed',
                    'pending_review','changes_requested','approved'))"""), {'id': entry['concept_id']})):
            await db.execute(text("""update editorial_legacy_batch_entries
              set status='skipped',failure_code='source_changed',updated_at=clock_timestamp()
              where id=:id"""), {'id': entry['id']})
            await db.commit()
            return None, 'source_changed'
        token = uuid4()
        await db.execute(text("""update editorial_legacy_batch_entries
          set status='generating',attempts=attempts+1,claim_token=:token,
          claimed_at=clock_timestamp(),failure_code=null,updated_at=clock_timestamp()
          where id=:id"""), {'id': entry['id'], 'token': token})
        await reserve_generation_call(db, settings.generation_daily_call_cap)
        await check_generation_capacity(db)
        await db.commit()
        return dict(entry) | {'claim_token': token, 'model': batch['model']}, 'generating'
    except BaseException:
        await db.rollback()
        raise


async def finish(db, settings, entry, *, body=None, failure=None):
    try:
        await _locks(db)
        row = (await db.execute(text("""select e.*,b.status as batch_status,
          b.requested_by,b.topic_id from editorial_legacy_batch_entries e
          join editorial_legacy_batches b on b.id=e.batch_id
          where e.id=:id for update of e,b"""), {'id': entry['id']})).mappings().one()
        if row['status'] != 'generating' or row['claim_token'] != entry['claim_token']:
            await db.commit()
            return 'superseded'
        if row['batch_status'] != 'running' or not settings.generation_enabled or not settings.legacy_enrichment_enabled:
            state = 'skipped' if row['batch_status'] in {'cancelled', 'failed', 'completed'} else 'queued'
            code = 'batch_stopped'
        elif not await editorial_generation.requester_active(db, row):
            state, code = 'skipped', 'requester_inactive'
        elif failure:
            state = ('blocked' if failure in {'validation_failed', 'package_invalid',
                                               'source_missing', 'safety_blocked',
                                               'provider_configuration'} else
                     'failed' if row['attempts'] >= 3 else 'queued')
            code = failure
        else:
            source = (await db.execute(text("""select slug,content_version,status from concepts
              where id=:id for update"""), {'id': row['concept_id']})).mappings().one()
            competing = await db.scalar(text("""select exists(select 1 from concept_revisions
              where concept_id=:id and status in ('draft','generating','validation_failed',
                'pending_review','changes_requested','approved'))"""), {'id': row['concept_id']})
            if source['status'] != 'published' or source['content_version'] != row['base_version'] or competing:
                state, code = 'skipped', 'source_changed'
            else:
                try:
                    # Stage only a complete validated package. Publication remains
                    # exclusively behind authenticated human approval.
                    if not isinstance(body, LessonBody):
                        raise ValueError('Complete card missing')
                    revision_id = await stage_revision(db, source['slug'], body)
                except ValueError:
                    state, code = 'blocked', 'validation_failed'
                else:
                    await db.execute(text("""update editorial_legacy_batch_entries
                      set status='ready_for_review',result_revision_id=:rid,
                      claim_token=null,claimed_at=null,failure_code=null,
                      updated_at=clock_timestamp() where id=:id"""),
                      {'id': row['id'], 'rid': revision_id})
                    await _finish_batch_if_empty(db, row['batch_id'])
                    await db.commit()
                    return 'ready_for_review'
        await db.execute(text("""update editorial_legacy_batch_entries
          set status=:state,claim_token=null,claimed_at=null,failure_code=:code,
          updated_at=clock_timestamp() where id=:id"""),
          {'id': row['id'], 'state': state, 'code': code})
        await _finish_batch_if_empty(db, row['batch_id'])
        await db.commit()
        return state
    except BaseException:
        await db.rollback()
        raise


async def run_one(db, settings):
    if not settings.generation_enabled or not settings.legacy_enrichment_enabled:
        return 'disabled'
    if not settings.gemini_api_key:
        return 'key_missing'
    try:
        entry, state = await claim(db, settings)
    except GenerationBudgetExhausted:
        return 'quota_exhausted'
    except GenerationBusy:
        return 'capacity_busy'
    if entry is None:
        return state
    try:
        body = await generate_legacy_card(
            source=entry['source_body'], topic=entry['topic_name'],
            subtopic=entry['subtopic_name'], api_key=settings.gemini_api_key,
            model=entry['model'],
        )
    except RateLimitedError:
        result = await finish(db, settings, entry, failure='rate_limited')
        return 'rate_limited' if result in {'queued', 'failed'} else result
    except LegacyValidationError as exc:
        log.warning('legacy enrichment blocked entry=%s code=%s', entry['id'], exc.failure_code)
        return await finish(db, settings, entry, failure=exc.failure_code)
    except LegacyConfigurationError:
        log.warning('legacy enrichment provider configuration blocked entry=%s', entry['id'])
        result = await finish(db, settings, entry, failure='provider_configuration')
        return 'provider_configuration' if result == 'blocked' else result
    except LegacyRetryableError as exc:
        log.warning('legacy enrichment retryable entry=%s code=%s', entry['id'], exc.failure_code)
        return await finish(db, settings, entry, failure=exc.failure_code)
    except GenerationError:
        log.warning('legacy enrichment unexpected provider response entry=%s', entry['id'])
        return await finish(db, settings, entry, failure='provider_or_source_error')
    return await finish(db, settings, entry, body=body)


async def run_batch(db, settings):
    outcomes = {}
    for index in range(settings.legacy_enrichment_batch_size):
        if index:
            await asyncio.sleep(settings.generation_pace_seconds)
        state = await run_one(db, settings)
        outcomes[state] = outcomes.get(state, 0) + 1
        if state in {'empty', 'in_progress', 'disabled', 'key_missing', 'quota_exhausted',
                     'capacity_busy', 'review_capacity_full', 'rate_limited',
                     'requester_inactive', 'batch_quota_exhausted',
                     'provider_configuration'}:
            break
    if outcomes.get('ready_for_review'):
        log.info('legacy enrichment prepared %s private drafts', outcomes['ready_for_review'])
    return outcomes
