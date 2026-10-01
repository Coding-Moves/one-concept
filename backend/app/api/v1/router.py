from fastapi import APIRouter

from app.api.v1 import analytics, achievements, concepts, daily, me, quizzes, reviews, subtopic_quizzes, subtopics, topics

from app.api.v1.connections import router as connections_router
from app.api.v1.profile_sharing import router as profile_sharing_router

api_router = APIRouter(prefix="/v1")
api_router.include_router(topics.router)
api_router.include_router(daily.router)
api_router.include_router(concepts.router)
api_router.include_router(me.router)
api_router.include_router(subtopics.router)

api_router.include_router(reviews.router)

api_router.include_router(achievements.router)
api_router.include_router(analytics.router)
api_router.include_router(quizzes.router)
api_router.include_router(subtopic_quizzes.router)

api_router.include_router(profile_sharing_router)

api_router.include_router(connections_router)
