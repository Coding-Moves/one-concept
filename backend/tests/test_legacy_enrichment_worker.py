"""A legacy batch cannot change published content without human review."""

from uuid import uuid4
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text

from app.services import legacy_enrichment_worker as worker
from app.services.legacy_generation import LegacyValidationError, build_body
from app.services.publication import LessonBody
from tests import test_editorial_content_api as content

api = content.api
draft = content.draft
editorial = content.editorial
ROOT = content.ROOT
NOTE = content.NOTE


def generated_payload():
    return {
        'objective': 'Explain this concept and apply it to a practical situation.',
        'difficulty': 2,
        'summary': 'A useful, specific explanation that helps a learner understand the mechanism. ' * 2,
        'example': 'A concrete worked example shows how the mechanism changes an actual decision.',
        'flashcard': {'front': 'What should a learner recall about this mechanism?',
                      'back': 'Recall the mechanism and use it in the given practical situation.'},
        'mcqs': [
            {'question': f'Which choice correctly applies the mechanism in situation {n}?',
             'options': ['Apply the mechanism', 'Ignore the mechanism', 'Reverse the inputs', 'Guess randomly'],
             'correct_index': 0}
            for n in range(1, 4)
        ],
    }


def grounded_candidate():
    return {'groundingMetadata': {'groundingChunks': [
        {'web': {'uri': 'https://docs.python.org/3/', 'title': 'Python documentation'}},
        {'web': {'uri': 'http://127.0.0.1/private', 'title': 'Unsafe source'}},
    ]}}


def test_grounded_candidate_requires_real_safe_source():
    source = {'title': 'A Practical Mechanism', 'subtopic_slug': 'foundations'}
    body = build_body(source, generated_payload(), grounded_candidate(), 'gemini-3.1-flash-lite')
    assert body.curriculum.references[0].url.host == 'docs.python.org'
    assert len(body.learning_package.mcqs) == 3
    with pytest.raises(LegacyValidationError, match='grounded'):
        build_body(source, generated_payload(), {'groundingMetadata': {'groundingChunks': []}}, 'gemini-3.1-flash-lite')
    with pytest.raises(LegacyValidationError, match='grounded'):
        build_body(source, generated_payload(), {'groundingMetadata': None}, 'gemini-3.1-flash-lite')


@pytest.fixture
async def batch(api, session, draft):
    slug, concept_id = draft
    topic_id = await session.scalar(text('select topic_id from concepts where id=:id'), {'id': concept_id})
    await session.execute(text("""update concepts set status='published',content_version=1,
      published_at=now() where id=:id"""), {'id': concept_id})
    await session.execute(text("""update concept_revisions set status='retired'
      where concept_id=:id"""), {'id': concept_id})
    await session.commit()
    api.settings.generation_enabled = True
    api.settings.legacy_enrichment_enabled = True
    api.settings.future_refill_enabled = False
    api.settings.gemini_api_key = 'fixture-key'
    command = {'request_id': str(uuid4()), 'topic_id': str(topic_id),
               'name': f'legacy-{uuid4().hex}', 'quota_limit': 2, 'note': NOTE}
    response = await api.client.post(f'{ROOT}/legacy-enrichment-batches',
                                     headers=api.headers(), json=command)
    assert response.status_code == 201, response.text
    created = response.json()
    assert created['discovered_count'] == 1
    started = await api.client.post(
        f"{ROOT}/legacy-enrichment-batches/{created['id']}/actions",
        headers=api.headers(),
        json={'request_id': str(uuid4()), 'expected_token': created['token'],
              'action': 'resume', 'note': NOTE})
    assert started.status_code == 200, started.text
    yield started.json(), concept_id, slug
    await session.rollback()
    await session.execute(text("""update editorial_legacy_batches set status='cancelled',
      finished_at=clock_timestamp() where id=:id and status in ('queued','running','paused')"""),
      {'id': created['id']})
    await session.execute(text("""update editorial_legacy_batch_entries
      set status='skipped',claim_token=null,claimed_at=null where batch_id=:id
      and status in ('queued','generating')"""), {'id': created['id']})
    await session.commit()


async def test_batch_stages_private_complete_revision_without_changing_learner_card(
    api, session, batch, monkeypatch
):
    current, concept_id, slug = batch
    source = await session.scalar(text("""select body from concept_revisions
      where concept_id=:id limit 1"""), {'id': concept_id})
    complete = build_body(source, generated_payload(), grounded_candidate(), 'gemini-3.1-flash-lite')
    generator = AsyncMock(return_value=complete)
    monkeypatch.setattr(worker, 'generate_legacy_card', generator)
    before = (await session.execute(text("""select summary,content_version from concepts
      where id=:id"""), {'id': concept_id})).one()
    assert await worker.run_one(session, api.settings) == 'ready_for_review'
    entry = (await api.client.get(
        f"{ROOT}/legacy-enrichment-batches/{current['id']}/entries",
        headers=api.headers())).json()['items'][0]
    assert entry['status'] == 'ready_for_review'
    assert entry['result_revision_id']
    revision = await session.scalar(text('select body from concept_revisions where id=:id'),
                                    {'id': entry['result_revision_id']})
    assert LessonBody.model_validate(revision).curriculum.references
    after = (await session.execute(text("""select summary,content_version from concepts
      where id=:id"""), {'id': concept_id})).one()
    assert after == before
    assert generator.await_count == 1
    assert await worker.run_one(session, api.settings) == 'empty'
    submitted, _ = await content.act(api, entry['result_revision_id'], 'submit')
    assert submitted.status_code == 200, submitted.text
    rejected, _ = await content.act(api, entry['result_revision_id'], 'rejected')
    assert rejected.status_code == 200, rejected.text
    eligibility = await api.client.get(
        f"{ROOT}/legacy-enrichment-eligibility/{current['topic_id']}",
        headers=api.headers())
    assert eligibility.json()['eligible_count'] == 0


async def test_pausing_fences_a_claimed_result(api, session, batch):
    current, concept_id, _ = batch
    eligibility = await api.client.get(
        f"{ROOT}/legacy-enrichment-eligibility/{current['topic_id']}",
        headers=api.headers())
    assert eligibility.status_code == 200
    assert eligibility.json()['active_batch_id'] == current['id']
    claimed, state = await worker.claim(session, api.settings)
    assert state == 'generating'
    action = {'request_id': str(uuid4()), 'expected_token': current['token'],
              'action': 'pause', 'note': NOTE}
    paused = await api.client.post(
        f"{ROOT}/legacy-enrichment-batches/{current['id']}/actions",
        headers=api.headers(), json=action)
    assert paused.status_code == 200, paused.text
    replay = await api.client.post(
        f"{ROOT}/legacy-enrichment-batches/{current['id']}/actions",
        headers=api.headers(), json=action)
    assert replay.status_code == 200 and replay.json() == paused.json()
    source = claimed['source_body']
    complete = build_body(source, generated_payload(), grounded_candidate(), 'gemini-3.1-flash-lite')
    assert await worker.finish(session, api.settings, claimed, body=complete) == 'queued'
    assert await session.scalar(text("""select count(*) from concept_revisions
      where concept_id=:id and status='draft'"""), {'id': concept_id}) == 0


async def test_last_reserved_call_finishes_before_batch_quota_is_decided(api, session, batch):
    current, _, _ = batch
    await session.execute(text("""update editorial_legacy_batches set quota_limit=1
      where id=:id"""), {'id': current['id']})
    await session.commit()

    claimed, state = await worker.claim(session, api.settings)
    assert state == 'generating'
    waiting, state = await worker.claim(session, api.settings)
    assert waiting is None and state == 'in_progress'
    assert await session.scalar(text("""select status from editorial_legacy_batches
      where id=:id"""), {'id': current['id']}) == 'running'

    complete = build_body(
        claimed['source_body'], generated_payload(), grounded_candidate(),
        'gemini-3.1-flash-lite',
    )
    assert await worker.finish(session, api.settings, claimed, body=complete) == 'ready_for_review'
    assert await session.scalar(text("""select status from editorial_legacy_batches
      where id=:id"""), {'id': current['id']}) == 'completed'
    assert await worker.run_one(session, api.settings) == 'empty'


async def test_exhausted_batch_fails_after_its_last_call_fails(api, session, batch):
    current, _, _ = batch
    await session.execute(text("""update editorial_legacy_batches set quota_limit=1
      where id=:id"""), {'id': current['id']})
    await session.commit()

    claimed, state = await worker.claim(session, api.settings)
    assert state == 'generating'
    assert await worker.finish(session, api.settings, claimed, failure='provider_or_source_error') == 'queued'
    waiting, state = await worker.claim(session, api.settings)
    assert waiting is None and state == 'batch_quota_exhausted'
    assert await session.scalar(text("""select status from editorial_legacy_batches
      where id=:id"""), {'id': current['id']}) == 'failed'
    assert await session.scalar(text("""select status from editorial_legacy_batch_entries
      where batch_id=:id"""), {'id': current['id']}) == 'skipped'


async def test_provider_permission_error_blocks_without_retrying(api, session, batch, monkeypatch):
    from app.services.legacy_generation import LegacyConfigurationError

    current, _, _ = batch
    generator = AsyncMock(side_effect=LegacyConfigurationError('provider permission'))
    monkeypatch.setattr(worker, 'generate_legacy_card', generator)
    assert await worker.run_batch(session, api.settings) == {'provider_configuration': 1}
    result = await api.client.get(
        f"{ROOT}/legacy-enrichment-batches/{current['id']}/entries",
        headers=api.headers())
    assert result.json()['items'][0]['status'] == 'blocked'
    assert result.json()['items'][0]['failure_code'] == 'provider_configuration'
    assert generator.await_count == 1
