"""The three concept actions share FastAPI tokens, evidence, and receipts."""

import json
import uuid

import pytest
from sqlalchemy import text

from app.schemas.editorial_content import ConceptAction
from app.services import editorial_workflow
from tests import test_editorial_content_api as content
from tests.test_content_quality import review


api = content.api
draft = content.draft
editorial = content.editorial


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_concept_comment_attest_and_retire_replay_in_fastapi(api, session, draft):
    cid = draft[1]
    query = text("""select public.edge_api_editorial_concept_action(
      :uid,:sid,:aal,:cid,:req,:note,:token,:action,
      cast(:quality as jsonb),:valid,:fp)""")

    async def action(name, token, quality=None):
        command = ConceptAction.model_validate({
            "request_id": str(uuid.uuid4()), "note": content.NOTE,
            "expected_token": token, "action": name, "quality": quality,
        })
        dump = command.model_dump(mode="json")
        args = {"uid": api.owner.id, "sid": api.owner.session_id,
                "aal": "aal2", "cid": cid, "req": command.request_id,
                "note": command.note, "token": token, "action": name,
                "quality": json.dumps(dump["quality"]) if quality is not None else None,
                "valid": True,
                "fp": editorial_workflow.digest({
                    "resource": f"concept:{cid}", "command": dump})}
        result = _json(await session.scalar(query, args))
        assert "error" not in result, result
        await session.commit()
        replay = await api.client.post(
            f"{content.ROOT}/concepts/{cid}/actions",
            headers=api.headers(), json=dump)
        assert replay.status_code == 200, replay.text
        assert replay.json() == result
        assert _json(await session.scalar(query, args)) == result
        if name == "attest":
            assert _json(await session.scalar(query, {**args, "valid": False})) == result
        assert _json(await session.scalar(query, {**args, "fp": "f" * 64}))[
            "error"] == "receipt_conflict"
        return result

    source = (await api.client.get(
        f"{content.ROOT}/concepts/{cid}", headers=api.headers())).json()
    assert _json(await session.scalar(query, {
        "uid": api.owner.id, "sid": api.owner.session_id, "aal": "aal1",
        "cid": cid, "req": uuid.uuid4(), "note": content.NOTE,
        "token": source["token"], "action": "comment",
        "quality": None, "valid": True, "fp": "f" * 64,
    }))["error"] == "mfa_required"
    commented = await action("comment", source["token"])
    assert commented["status"] == "draft" and commented["token"] == source["token"]

    rid = await content.rid_for(session, cid)
    body = (await content.detail(api, rid))["body"]
    await session.execute(text("""update concepts set status='published',
      content_version=1,flashcard=cast(:flashcard as jsonb),
      mcqs=cast(:mcqs as jsonb) where id=:cid"""), {
        "cid": cid,
        "flashcard": json.dumps(body["learning_package"]["flashcard"]),
        "mcqs": json.dumps(body["learning_package"]["mcqs"]),
    })
    await session.execute(text("""insert into editorial_legacy_versions
      (concept_id,content_version,snapshot)
      select c.id,c.content_version,to_jsonb(c)-array['created_at','published_at','status']
      from concepts c where c.id=:cid"""), {"cid": cid})
    await session.commit()
    legacy = (await api.client.get(
        f"{content.ROOT}/concepts/{cid}", headers=api.headers())).json()
    assert legacy["unchanged_legacy"] and legacy["validation"]["valid"]
    attested = await action("attest", legacy["token"], review())
    assert attested["status"] == "published" and attested["content_version"] == 1
    assert await session.scalar(text("""select count(*) from editorial_publications
      where concept_id=:cid"""), {"cid": cid}) == 1
    retired = await action("retire", attested["token"])
    assert retired["status"] == "archived" and retired["token"] != attested["token"]


@pytest.mark.asyncio
async def test_concept_action_helpers_are_service_only(session):
    signatures = ["edge_api_editorial_quality_valid(jsonb)",
                  "edge_api_editorial_concept_token(uuid)",
                  "edge_api_editorial_candidate_problem(uuid,text,jsonb)",
                  "edge_api_editorial_concept_action(uuid,uuid,text,uuid,uuid,text,text,text,jsonb,boolean,text)"]
    for signature in signatures:
        authenticated, service = (await session.execute(text("""select
          has_function_privilege('authenticated',:signature,'EXECUTE'),
          has_function_privilege('service_role',:signature,'EXECUTE')"""),
          {"signature": f"public.{signature}"})).one()
        assert (authenticated, service) == (False, True)
