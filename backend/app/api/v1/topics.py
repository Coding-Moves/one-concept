from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.schemas.topics import TopicOut

router = APIRouter(prefix="/topics", tags=["topics"])

_LIST = text("""
    select t.id, t.slug, t.name, t.description,
           count(c.id) filter (where c.status = 'published') as concept_count,
           exists (select 1 from public.user_topics ut
                    where ut.user_id = :uid and ut.topic_id = t.id) as following
      from public.topics t
      left join public.concepts c on c.topic_id = t.id
     where t.is_active
     group by t.id, t.slug, t.name, t.description, t.sort_order
     order by t.sort_order, t.name
""")


@router.get("", response_model=list[TopicOut])
async def list_topics(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TopicOut]:
    rows = (await db.execute(_LIST, {"uid": user.id})).mappings().all()
    return [TopicOut(**row) for row in rows]
