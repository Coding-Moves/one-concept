"""Isolated, human-reviewed enrichment for already-published legacy lessons."""
import json

from fastapi import HTTPException
from sqlalchemy import text

from app.services import editorial_revisions as revisions
from app.services import editorial_workflow as workflow


def visible(row):
    return {key: row[key] for key in (
        'id', 'topic_id', 'name', 'model', 'prompt_version', 'status',
        'discovered_count', 'quota_limit', 'created_at', 'started_at', 'finished_at'
    )} | {'token': workflow.digest({key: row[key] for key in ('id', 'status', 'discovered_count', 'quota_limit', 'started_at', 'finished_at')})}


async def get_batch(db, batch_id, *, lock=False):
    row = (await db.execute(text('select * from editorial_legacy_batches where id=:id' + (' for update' if lock else '')), {'id': batch_id})).mappings().first()
    if not row:
        raise HTTPException(404, 'Legacy enrichment batch not found')
    return row


async def create(db, actor, settings, command):
    member = await revisions.lock_reviewer(db, actor, settings, 'request_generation')
    fingerprint, old = await workflow.receipt(db, actor, command, f'legacy-batch:{command.name}')
    if old is not None:
        return old
    if not settings.generation_enabled or not settings.gemini_api_key:
        raise HTTPException(409, 'Generation is paused or not configured')
    await db.execute(text('select id from topics where id=:id and is_active for update'), {'id': command.topic_id})
    eligible = (await db.execute(text('''select c.id,c.content_version,jsonb_build_object(
      'title',c.title,'summary',c.summary,'example',c.example,'curriculum',c.curriculum,
      'topic_id',c.topic_id,'subtopic_id',c.subtopic_id) as body
      from concepts c where c.topic_id=:topic and c.status='published'
      and not exists(select 1 from concept_revisions r where r.concept_id=c.id
        and r.status in ('draft','generating','validation_failed','pending_review','changes_requested','approved'))
      order by c.created_at,c.id'''), {'topic': command.topic_id})).mappings().all()
    if not eligible:
        raise ValueError('This subject has no eligible published lessons to enrich')
    if len(eligible) > command.quota_limit:
        raise ValueError('Quota limit is below this subject’s eligible lesson count')
    batch_id = await db.scalar(text('''insert into editorial_legacy_batches
      (topic_id,name,requested_by,model,prompt_version,discovered_count,quota_limit)
      values (:topic,:name,:actor,:model,'legacy-complete-card-v1',:count,:quota) returning id'''), {
        'topic': command.topic_id, 'name': command.name, 'actor': member.user_id,
        'model': settings.gemini_model, 'count': len(eligible), 'quota': command.quota_limit})
    for item in eligible:
        await db.execute(text('''insert into editorial_legacy_batch_entries
          (batch_id,concept_id,base_version,source_body) values (:batch,:concept,:version,cast(:body as jsonb))'''),
          {'batch': batch_id, 'concept': item['id'], 'version': item['content_version'], 'body': json.dumps(item['body'])})
    await workflow.audit(db, member, 'generation_requested', command.note, tid=command.topic_id,
                         details={'kind': 'legacy_enrichment', 'batch_id': batch_id, 'eligible': len(eligible)})
    return await workflow.remember(db, actor, command, fingerprint, visible(await get_batch(db, batch_id)))


async def action(db, actor, settings, batch_id, command):
    member = await revisions.lock_reviewer(db, actor, settings, 'request_generation')
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
    await workflow.audit(db, member, 'comment', command.note, tid=batch['topic_id'],
                         details={'kind': 'legacy_enrichment', 'batch_id': batch_id, 'action': command.action})
    return visible(await get_batch(db, batch_id))


async def list_batches(db, topic_id=None):
    rows = (await db.execute(text('''select * from editorial_legacy_batches
      where (cast(:topic as uuid) is null or topic_id=:topic) order by created_at desc'''), {'topic': topic_id})).mappings().all()
    return [visible(row) for row in rows]
