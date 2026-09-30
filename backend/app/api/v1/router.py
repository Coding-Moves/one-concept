from fastapi import APIRouter

from app.api.v1 import achievements, concepts, daily, me, quizzes, reviews, subtopics, topics

api_router = APIRouter(prefix="/v1")
api_router.include_router(topics.router)
api_router.include_router(daily.router)
api_router.include_router(concepts.router)
api_router.include_router(me.router)
api_router.include_router(subtopics.router)

api_router.include_router(reviews.router)

api_router.include_router(achievements.router)
api_router.include_router(quizzes.router)
