"""Protected maintainer CLI: python -m app.workers.content --help.

Uses backend credentials; intentionally has no public HTTP route. Import files
are validated before mutation and every operation is a single transaction.
"""

import argparse
import asyncio
import json
import uuid
from pathlib import Path

from pydantic import TypeAdapter
from sqlalchemy import text

from app.db.session import SessionLocal, engine
from app.services.curriculum import (
    PlannedLesson,
    Subject,
    import_lessons,
    import_subjects,
)
from app.services.publication import (
    LessonBody,
    publish_revision,
    retry_failed,
    stage_revision,
)


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    sub = root.add_subparsers(dest="command", required=True)
    for name in ("import-subjects", "import-curriculum", "revise-plan"):
        p = sub.add_parser(name)
        p.add_argument("file", type=Path)
    p = sub.add_parser(
        "stage", help="Stage a corrected lesson body without replacing published text"
    )
    p.add_argument("slug")
    p.add_argument("file", type=Path)
    sub.add_parser("drafts")
    p = sub.add_parser(
        "report", help="Content health; --observe emits only condition transitions"
    )
    p.add_argument("--observe", action="store_true")
    p = sub.add_parser("failures", help="Redacted failed titles, up to 100 per page")
    p.add_argument("--after", default="", help="Continue after the last slug")
    p = sub.add_parser("show")
    p.add_argument("revision", type=uuid.UUID)
    for name in ("publish", "reject"):
        p = sub.add_parser(name)
        p.add_argument("revision", type=uuid.UUID)
        p.add_argument("--reviewed-by", required=True)
        p.add_argument("--note", required=True)
    p = sub.add_parser("retry")
    p.add_argument("slug")
    p.add_argument("--operator", required=True)
    p.add_argument("--reason", required=True)
    return root


async def run(args):
    try:
        async with SessionLocal() as session:
            async with session.begin():
                if args.command == "failures":
                    from app.services.content_health import failed_items

                    result = await failed_items(session, args.after)
                elif args.command == "report":
                    from app.services.content_health import (
                        health_report,
                        observe_conditions,
                    )

                    result = await health_report(session)
                    if args.observe:
                        result = await observe_conditions(session, result["conditions"])
                elif args.command == "import-subjects":
                    rows = TypeAdapter(list[Subject]).validate_json(
                        args.file.read_text()
                    )
                    result = {"subjects": await import_subjects(session, rows)}
                elif args.command in ("import-curriculum", "revise-plan"):
                    rows = TypeAdapter(list[PlannedLesson]).validate_json(
                        args.file.read_text()
                    )
                    result = {
                        "planned": len(rows),
                        "overlap_warnings": await import_lessons(
                            session, rows, revise=args.command == "revise-plan"
                        ),
                    }
                elif args.command == "stage":
                    result = {
                        "revision": str(
                            await stage_revision(
                                session,
                                args.slug,
                                LessonBody.model_validate_json(args.file.read_text()),
                            )
                        )
                    }
                elif args.command == "publish":
                    result = {
                        "version": await publish_revision(
                            session, args.revision, args.reviewed_by, args.note
                        )
                    }
                elif args.command == "reject":
                    if not args.reviewed_by.strip() or len(args.note.strip()) < 10:
                        raise ValueError("Record reviewer and rejection reason")
                    count = await session.scalar(
                        text("""with changed as (
                      update public.concept_revisions set status='rejected',reviewed_at=now(),
                        reviewed_by=:who,review_note=:note where id=:id and status='draft' returning id
                      ) select count(*) from changed"""),
                        {
                            "id": args.revision,
                            "who": args.reviewed_by,
                            "note": args.note,
                        },
                    )
                    result = {"rejected": count}
                elif args.command == "retry":
                    await retry_failed(session, args.slug, args.operator, args.reason)
                    result = {"retry_granted": args.slug}
                elif args.command == "show":
                    row = (
                        (
                            await session.execute(
                                text(
                                    "select * from public.concept_revisions where id=:id"
                                ),
                                {"id": args.revision},
                            )
                        )
                        .mappings()
                        .first()
                    )
                    if row is None:
                        raise ValueError("Unknown revision")
                    result = dict(row)
                else:
                    result = [
                        dict(r)
                        for r in (
                            await session.execute(
                                text("""select r.id,c.slug,
                      r.base_version,r.created_at from public.concept_revisions r
                      join public.concepts c on c.id=r.concept_id where r.status='draft'
                      order by r.created_at limit 100""")
                            )
                        ).mappings()
                    ]
            if args.command != "report" or not args.observe or result:
                print(json.dumps(result, default=str, indent=2))
    finally:
        await engine.dispose()


def main():
    args = parser().parse_args()
    try:
        asyncio.run(run(args))
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
