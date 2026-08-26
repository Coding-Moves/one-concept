from fastapi import APIRouter

from app.api.v1 import concepts, daily, me, topics

api_router = APIRouter(prefix="/v1")
api_router.include_router(topics.router)
api_router.include_router(daily.router)
api_router.include_router(concepts.router)
api_router.include_router(me.router)
