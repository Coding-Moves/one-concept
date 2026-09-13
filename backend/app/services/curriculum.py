"""Maintainer-only catalog operations. Callers commit the whole import or roll back.

Stable slugs identify records; importing a registry never deletes omitted topics.
The advisory transaction lock serializes imports and publication across operators.
"""

import re
from difflib import SequenceMatcher
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

Slug = Annotated[str, Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=120)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Subject(StrictModel):
    slug: Slug
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=500)
    sort_order: int = Field(default=0, ge=0, le=32767)
    is_active: bool = True


class Reference(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    url: HttpUrl


class Curriculum(StrictModel):
    objective: str = Field(min_length=15, max_length=500)
    # 1 = foundations, 2 = intermediate, 3 = advanced applications.
    difficulty: int = Field(ge=1, le=3)
    prerequisites: list[Slug] = Field(default_factory=list, max_length=20)
    references: list[Reference] = Field(min_length=1, max_length=10)

    @field_validator("prerequisites")
    @classmethod
    def unique_prerequisites(cls, values):
        if len(values) != len(set(values)):
            raise ValueError("Duplicate prerequisites")
        return values


class PlannedLesson(StrictModel):
    slug: Slug
    topic_slug: Slug
    title: str = Field(min_length=3, max_length=160)
    angle: str = Field(default="", max_length=1000)
    curriculum: Curriculum


def normalized(value: str) -> str:
    return " ".join(re.findall(r"\w+", value.casefold()))


async def catalog_lock(session: AsyncSession) -> None:
    await session.execute(text("select pg_advisory_xact_lock(195, 1)"))


async def import_subjects(session: AsyncSession, items: list[Subject]) -> int:
    if len({item.slug for item in items}) != len(items):
        raise ValueError("Duplicate subject slug in import")
    await catalog_lock(session)
    for item in items:
        await session.execute(
            text("""insert into public.topics
          (slug,name,description,sort_order,is_active)
          values (:slug,:name,:description,:sort_order,:is_active)
          on conflict(slug) do update set name=excluded.name,
            description=excluded.description,sort_order=excluded.sort_order,
            is_active=excluded.is_active"""),
            item.model_dump(),
        )
    return len(items)


async def validate_graph(session: AsyncSession, additions: dict[str, dict]) -> None:
    rows = (
        await session.execute(
            text("""select slug,curriculum from public.concept_backlog
      union all select slug,curriculum from public.concepts""")
        )
    ).all()
    graph = {r.slug: r.curriculum.get("prerequisites", []) for r in rows}
    graph.update(
        {slug: data.get("prerequisites", []) for slug, data in additions.items()}
    )
    visited, visiting = set(), set()

    def visit(slug):
        if slug in visiting:
            raise ValueError(f"Prerequisite cycle includes {slug}")
        if slug in visited:
            return
        if slug not in graph:
            raise ValueError(f"Unknown prerequisite {slug}")
        visiting.add(slug)
        for prereq in graph[slug]:
            visit(prereq)
        visiting.remove(slug)
        visited.add(slug)

    for slug in additions:
        visit(slug)


async def import_lessons(
    session: AsyncSession, items: list[PlannedLesson], *, revise: bool = False
) -> list[str]:
    """Idempotent exact re-import; changed existing plans need explicit editorial work."""
    import json

    if len({item.slug for item in items}) != len(items):
        raise ValueError("Duplicate lesson slug in import")
    await catalog_lock(session)
    await validate_graph(
        session, {i.slug: i.curriculum.model_dump(mode="json") for i in items}
    )
    existing = (
        await session.execute(
            text("""select slug,title,curriculum from public.concepts
      union all select slug,title,curriculum from public.concept_backlog""")
        )
    ).all()
    titles = {normalized(r.title): r.slug for r in existing}
    objectives = {
        normalized(r.curriculum["objective"]): r.slug
        for r in existing
        if r.curriculum.get("objective")
    }
    warnings = []
    for item in items:
        title_key, objective_key = (
            normalized(item.title),
            normalized(item.curriculum.objective),
        )
        for key, index in ((title_key, titles), (objective_key, objectives)):
            if key in index and index[key] != item.slug:
                raise ValueError(f"Exact duplicate of {index[key]}: {item.slug}")
        for key, slug in titles.items():
            if (
                slug != item.slug
                and SequenceMatcher(None, title_key, key).ratio() >= 0.78
            ):
                warnings.append(f"Check overlap: {item.slug} and {slug}")
        titles[title_key], objectives[objective_key] = item.slug, item.slug
        topic = await session.scalar(
            text("select id from public.topics where slug=:s and is_active"),
            {"s": item.topic_slug},
        )
        if topic is None:
            raise ValueError(f"Unknown or retired subject {item.topic_slug}")
        previous = (
            await session.execute(
                text("select * from public.concept_backlog where slug=:s for update"),
                {"s": item.slug},
            )
        ).first()
        data = item.curriculum.model_dump(mode="json")
        if previous:
            if previous.topic_id != topic:
                raise ValueError("A plan cannot move between subject identities")
            if (
                previous.topic_id,
                previous.title,
                previous.angle or "",
                previous.curriculum,
            ) != (topic, item.title, item.angle, data):
                if not revise or previous.status not in ("pending", "failed"):
                    raise ValueError(
                        f"{item.slug} already exists with a different plan; only pending/failed plans can be revised explicitly"
                    )
                await session.execute(
                    text("""update public.concept_backlog set title=:title,angle=:angle,
                  difficulty=:difficulty,curriculum=cast(:data as jsonb) where id=:id"""),
                    {
                        "id": previous.id,
                        "title": item.title,
                        "angle": item.angle,
                        "difficulty": item.curriculum.difficulty,
                        "data": json.dumps(data),
                    },
                )
            continue
        if revise:
            raise ValueError(f"No existing plan for {item.slug}")
        if any(row.slug == item.slug for row in existing):
            raise ValueError(f"{item.slug} already exists in the catalog")
        await session.execute(
            text("""insert into public.concept_backlog
          (topic_id,slug,title,angle,difficulty,curriculum) values
          (:t,:s,:title,:angle,:difficulty,cast(:data as jsonb))"""),
            {
                "t": topic,
                "s": item.slug,
                "title": item.title,
                "angle": item.angle,
                "difficulty": item.curriculum.difficulty,
                "data": json.dumps(data),
            },
        )
    return sorted(set(warnings))
