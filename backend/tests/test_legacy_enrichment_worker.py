"""A legacy batch cannot change published content without human review."""

from uuid import uuid4
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import text

from app.services import legacy_enrichment_worker as worker
from app.services import legacy_generation
from app.services.generation import GenerationError, validate
from app.services.legacy_generation import (
    LegacyConfigurationError, LegacyRetryableError, LegacyValidationError,
    _candidate_payload, build_body, generate_legacy_card,
)
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


@pytest.mark.parametrize(('field', 'value', 'expected_code'), [
    ('summary', 42, 'content_invalid'),
    ('example', ['not lesson text'], 'content_invalid'),
    ('summary', 'Too short.', 'summary_length'),
    ('summary', 'A crucial mechanism that should be explained without filler. ' * 2,
     'summary_style'),
    ('example', '', 'content_empty'),
])
def test_malformed_lesson_text_is_retryable_not_a_worker_crash(field, value, expected_code):
    payload = generated_payload() | {field: value}
    source = {'title': 'A Practical Mechanism', 'subtopic_slug': 'foundations'}
    with pytest.raises(LegacyRetryableError) as caught:
        build_body(source, payload, grounded_candidate(), 'gemini-3.1-flash-lite')
    assert caught.value.failure_code == expected_code


def test_complete_card_uses_validated_trimmed_text():
    payload = generated_payload()
    payload['summary'] = '  ' + payload['summary'] + '  '
    payload['example'] = '  ' + payload['example'] + '  '
    source = {'title': 'A Practical Mechanism', 'subtopic_slug': 'foundations'}
    body = build_body(source, payload, grounded_candidate(), 'gemini-3.1-flash-lite')
    assert body.summary == payload['summary'].strip()
    assert body.example == payload['example'].strip()


def test_legacy_example_uses_published_card_length_limit():
    source = {'title': 'A Practical Mechanism', 'subtopic_slug': 'foundations'}
    payload = generated_payload() | {'example': 'A' * 400}
    body = build_body(source, payload, grounded_candidate(), 'gemini-3.1-flash-lite')
    assert len(body.example) == 400
    with pytest.raises(GenerationError, match='example length'):
        validate(payload, source['title'])

    payload['example'] = 'A' * 501
    with pytest.raises(LegacyRetryableError) as caught:
        build_body(source, payload, grounded_candidate(), 'gemini-3.1-flash-lite')
    assert caught.value.failure_code == 'example_length'


def test_gemini_response_skips_thought_parts_and_joins_text():
    encoded = ('Searched the official documentation and checked the definition.\n'
               'BEGIN_CARD_JSON\n' + legacy_generation.json.dumps(generated_payload()))
    body = {'candidates': [{**grounded_candidate(), 'finishReason': 'STOP',
        'content': {'parts': [{'thought': True, 'text': 'private reasoning'},
                              {'text': encoded[:60]}, {'text': encoded[60:]}]}}]}
    payload, candidate = _candidate_payload(body)
    assert payload == generated_payload()
    assert candidate['groundingMetadata'] == grounded_candidate()['groundingMetadata']


@pytest.mark.parametrize(('response', 'error', 'code'), [
    ({'candidates': [{'finishReason': 'MAX_TOKENS'}]}, LegacyRetryableError, 'response_truncated'),
    ({'candidates': [{'finishReason': 'SAFETY'}]}, LegacyValidationError, 'safety_blocked'),
    ({'promptFeedback': {'blockReason': 'SAFETY'}}, LegacyValidationError, 'safety_blocked'),
    ({'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': '{'}]}}]},
     LegacyRetryableError, 'response_missing_card_marker'),
    ({'candidates': [{'finishReason': 'STOP', 'content': {'parts': [
        {'text': 'Grounded note\nBEGIN_CARD_JSON\n{'}]}}]},
     LegacyRetryableError, 'response_invalid_json'),
    ({'candidates': [{'finishReason': 'STOP', 'content': {'parts': [
        {'text': 'Grounded note\nBEGIN_CARD_JSON\n{} trailing text'}]}}]},
     LegacyRetryableError, 'response_invalid_json'),
    ({'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'thought': True,
                                                                    'text': 'hidden'}]}}]},
     LegacyRetryableError, 'response_missing_text'),
])
def test_gemini_response_failure_codes_are_safe(response, error, code):
    with pytest.raises(error) as caught:
        _candidate_payload(response)
    assert caught.value.failure_code == code


async def test_legacy_generation_parses_complete_grounded_response(monkeypatch):
    calls = []

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def post(self, url, json, headers):
            calls.append((url, json, headers))
            return httpx.Response(200, json={'candidates': [{**grounded_candidate(),
                'finishReason': 'STOP', 'content': {'parts': [
                    {'thought': True, 'text': 'discard'},
                    {'text': 'Grounded research note.\nBEGIN_CARD_JSON\n'
                             + legacy_generation.json.dumps(generated_payload())}]}}]})

    monkeypatch.setattr(legacy_generation.httpx, 'AsyncClient', lambda **_: Client())
    result = await generate_legacy_card(
        source={'title': 'A Practical Mechanism', 'subtopic_slug': 'foundations'},
        topic='Systems', subtopic='Foundations', api_key='fixture-key',
        model='gemini-3.1-flash-lite',
    )
    assert len(result.learning_package.mcqs) == 3
    assert result.prompt_version == legacy_generation.PROMPT_VERSION
    assert calls[0][1]['generationConfig']['maxOutputTokens'] == 4096
    assert 'responseMimeType' not in calls[0][1]['generationConfig']
    assert 'responseSchema' not in calls[0][1]['generationConfig']
    assert calls[0][1]['tools'] == [{'googleSearch': {}}]
    prompt = calls[0][1]['contents'][0]['parts'][0]['text']
    assert 'BEGIN_CARD_JSON' in prompt
    assert 'summary (string, 100-420 characters; aim for 150-300)' in prompt
    assert 'example (string, 40-500 characters; aim for 70-200)' in prompt
    assert "Do not use code fences or filler phrases such as 'crucial'" in prompt
    assert calls[0][2]['x-goog-api-key'] == 'fixture-key'


async def test_legacy_generation_treats_unknown_model_as_configuration_error(monkeypatch):
    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def post(self, *_args, **_kwargs):
            return httpx.Response(404)

    monkeypatch.setattr(legacy_generation.httpx, 'AsyncClient', lambda **_: Client())
    with pytest.raises(LegacyConfigurationError, match='404'):
        await generate_legacy_card(
            source={'title': 'A Practical Mechanism'}, topic='Systems',
            subtopic='Foundations', api_key='fixture-key', model='missing-model',
        )


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


@pytest.mark.parametrize(('error', 'expected_status', 'expected_code'), [
    (LegacyValidationError('no grounded source links', 'source_missing'), 'blocked', 'source_missing'),
    (LegacyRetryableError('response_truncated'), 'queued', 'response_truncated'),
])
async def test_specific_failure_codes_preserve_review_gate(
    api, session, batch, monkeypatch, error, expected_status, expected_code
):
    current, _, _ = batch
    monkeypatch.setattr(worker, 'generate_legacy_card', AsyncMock(side_effect=error))
    assert await worker.run_one(session, api.settings) == expected_status
    result = await api.client.get(
        f"{ROOT}/legacy-enrichment-batches/{current['id']}/entries",
        headers=api.headers())
    entry = result.json()['items'][0]
    assert entry['status'] == expected_status
    assert entry['failure_code'] == expected_code
    assert entry['result_revision_id'] is None
