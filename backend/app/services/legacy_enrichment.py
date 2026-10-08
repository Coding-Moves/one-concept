"""Isolated, human-reviewed enrichment for already-published legacy lessons."""
import json

from fastapi import HTTPException
from sqlalchemy import text

from app.services import editorial_revisions as revisions
from app.services import editorial_workflow as workflow
from app.services.legacy_generation import PROMPT_VERSION


def visible(row):
    return {key: row[key] for key in (
        'id', 'topic_id', 'name', 'model', 'prompt_version', 'status',
        'discovered_count', 'quota_limit', 'created_at', 'started_at', 'finished_at'
    )} | {'token': workflow.digest({key: row[key] for key in ('id', 'status', 'discovered_count', 'quota_limit', 'started_at', 'finished_at')})}


async def detail(db, row):
    counts = (await db.execute(text("""select
      case when e.status='ready_for_review' and r.status='published'
           then 'published' else e.status end as status, count(*)::int as total
      from editorial_legacy_batch_entries e
      left join concept_revisions r on r.id=e.result_revision_id
      where e.batch_id=:id group by 1"""), {'id': row['id']})).all()
    return visible(row) | {'counts': dict(counts)}


async def get_batch(db, batch_id, *, lock=False):
    row = (await db.execute(text('select * from editorial_legacy_batches where id=:id' + (' for update' if lock else '')), {'id': batch_id})).mappings().first()
    if not row:
        raise HTTPException(404, 'Legacy enrichment batch not found')
    return row


async def eligible_lessons(db, topic_id):
    return (await db.execute(text('''select c.id,c.content_version,jsonb_build_object(
      'title',c.title,'summary',c.summary,'example',c.example,'curriculum',c.curriculum,
      'flashcard',c.flashcard,'mcqs',c.mcqs,
      'topic_id',c.topic_id,'subtopic_id',c.subtopic_id,'subtopic_slug',s.slug) as body
      from concepts c join subtopics s on s.id=c.subtopic_id where c.topic_id=:topic
      and c.status='published' and s.is_active
      and (not exists(select 1 from editorial_publications p
        where p.concept_id=c.id and p.content_version=c.content_version)
        or length(btrim(coalesce(c.curriculum->>'objective','')))=0
        or c.curriculum->'difficulty' is null
        or case when jsonb_typeof(c.curriculum->'references')='array'
           then jsonb_array_length(c.curriculum->'references')=0 else true end
        or length(btrim(coalesce(c.flashcard->>'front','')))=0
        or length(btrim(coalesce(c.flashcard->>'back','')))=0
        or case when jsonb_typeof(c.mcqs)='array'
           then jsonb_array_length(c.mcqs)<>3 else true end)
      and not exists(select 1 from concept_revisions r where r.concept_id=c.id
        and r.status in ('draft','generating','validation_failed','pending_review','changes_requested','approved'))
      and not exists(select 1 from editorial_legacy_batch_entries e
        where e.concept_id=c.id and e.status='ready_for_review')
      order by c.created_at,c.id'''), {'topic': topic_id})).mappings().all()


async def eligibility(db, topic_id, settings):
    topic = await db.scalar(text('select id from topics where id=:id and is_active'), {'id': topic_id})
    if topic is None:
        raise HTTPException(404, 'Active subject not found')
    active = await db.scalar(text("""select id from editorial_legacy_batches
      where status in ('queued','running','paused') limit 1"""))
    return {
        'eligible_count': len(await eligible_lessons(db, topic_id)),
        'active_batch_id': active,
        'configured': bool(settings.generation_enabled and settings.legacy_enrichment_enabled
                           and settings.gemini_api_key and settings.gemini_model.startswith('gemini-3')),
    }


async def create(db, actor, settings, command):
    member = await revisions.lock_reviewer(db, actor, settings, 'request_generation')
    fingerprint, old = await workflow.receipt(db, actor, command, f'legacy-batch:{command.name}')
    if old is not None:
        return old
    if not settings.generation_enabled or not settings.legacy_enrichment_enabled or not settings.gemini_api_key:
        raise HTTPException(409, 'Legacy enrichment is paused or not configured')
    if not settings.gemini_model.startswith('gemini-3'):
        raise ValueError('Legacy grounding and structured output require a Gemini 3 model')
    active = await db.scalar(text("""select id from editorial_legacy_batches
      where status in ('queued','running','paused') limit 1"""))
    if active:
        raise ValueError('Finish or cancel the active subject batch before selecting another')
    topic = await db.scalar(text('select id from topics where id=:id and is_active for update'), {'id': command.topic_id})
    if topic is None:
        raise ValueError('Choose an active subject')
    eligible = await eligible_lessons(db, command.topic_id)
    if not eligible:
        raise ValueError('This subject has no eligible published lessons to enrich')
    if len(eligible) > command.quota_limit:
        raise ValueError('Quota limit is below this subject’s eligible lesson count')
    batch_id = await db.scalar(text('''insert into editorial_legacy_batches
      (topic_id,name,requested_by,model,prompt_version,discovered_count,quota_limit)
      values (:topic,:name,:actor,:model,:prompt,:count,:quota) returning id'''), {
        'topic': command.topic_id, 'name': command.name, 'actor': member.user_id,
        'model': settings.gemini_model, 'prompt': PROMPT_VERSION,
        'count': len(eligible), 'quota': command.quota_limit})
    for item in eligible:
        await db.execute(text('''insert into editorial_legacy_batch_entries
          (batch_id,concept_id,base_version,source_body) values (:batch,:concept,:version,cast(:body as jsonb))'''),
          {'batch': batch_id, 'concept': item['id'], 'version': item['content_version'], 'body': json.dumps(item['body'])})
    await workflow.audit(db, member, 'generation_requested', command.note, tid=command.topic_id,
                         details={'kind': 'legacy_enrichment', 'batch_id': batch_id, 'eligible': len(eligible)})
    return await workflow.remember(db, actor, command, fingerprint,
                                   await detail(db, await get_batch(db, batch_id)))


async def action(db, actor, settings, batch_id, command):
    member = await revisions.lock_reviewer(db, actor, settings, 'request_generation')
    fingerprint, old = await workflow.receipt(db, actor, command, f'legacy-batch-action:{batch_id}')
    if old is not None:
        return old
    batch = await get_batch(db, batch_id, lock=True)
    workflow.expect(visible(batch)['token'], command.expected_token)
    target = {'pause': 'paused', 'resume': 'running', 'cancel': 'cancelled'}[command.action]
    allowed = {'pause': ('queued', 'running'), 'resume': ('queued', 'paused'), 'cancel': ('queued', 'running', 'paused')}
    if batch['status'] not in allowed[command.action]:
        raise ValueError('This batch cannot make that transition')
    await db.execute(text('''update editorial_legacy_batches set status=:status,
      started_at=coalesce(started_at,clock_timestamp()),
      finished_at=case when :status='cancelled' then clock_timestamp() else null end where id=:id'''),
      {'id': batch_id, 'status': target})
    if command.action == 'cancel':
        await db.execute(text("""update editorial_legacy_batch_entries
          set status='skipped',claim_token=null,claimed_at=null,
          failure_code='batch_cancelled',updated_at=clock_timestamp()
          where batch_id=:id and status in ('queued','generating')"""), {'id': batch_id})
    await workflow.audit(db, member, 'comment', command.note, tid=batch['topic_id'],
                         details={'kind': 'legacy_enrichment', 'batch_id': batch_id, 'action': command.action})
    return await workflow.remember(db, actor, command, fingerprint,
                                   await detail(db, await get_batch(db, batch_id)))


async def list_batches(db, topic_id=None):
    rows = (await db.execute(text('''select * from editorial_legacy_batches
      where (cast(:topic as uuid) is null or topic_id=:topic) order by created_at desc'''), {'topic': topic_id})).mappings().all()
    return [await detail(db, row) for row in rows]


async def list_entries(db, batch_id):
    await get_batch(db, batch_id)
    rows = (await db.execute(text("""select e.id,e.concept_id,c.title,e.base_version,e.attempts,
      case when e.status='ready_for_review' and r.status='published'
           then 'published' else e.status end as status,
      e.result_revision_id,e.failure_code
      from editorial_legacy_batch_entries e
      join concepts c on c.id=e.concept_id
      left join concept_revisions r on r.id=e.result_revision_id
      where e.batch_id=:id order by e.created_at,e.id"""), {'id': batch_id})).mappings().all()
    return [dict(row) for row in rows]
