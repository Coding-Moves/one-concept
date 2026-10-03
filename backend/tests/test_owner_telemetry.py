from uuid import uuid4

import pytest
from sqlalchemy import text

from app.services.owner_telemetry import record, worker_observation


async def test_worker_observations_and_redaction(session, sessionmaker_for_test):
    await session.execute(text("delete from owner_operation_events"))
    await session.commit()
    async with worker_observation(
        "reminders", factory=sessionmaker_for_test, enabled=True
    ):
        pass
    with pytest.raises(RuntimeError):
        async with worker_observation(
            "pool_topup", factory=sessionmaker_for_test, enabled=True
        ):
            raise RuntimeError("password and private prompt must not escape")
    rows = (
        await session.execute(
            text(
                "select service,code,correlation_id from owner_operation_events order by observed_at"
            )
        )
    ).all()
    assert [(r.service, r.code) for r in rows] == [
        ("reminders", "started"),
        ("reminders", "completed"),
        ("pool_topup", "started"),
        ("pool_topup", "failed"),
    ]
    assert rows[0].correlation_id == rows[1].correlation_id
    assert rows[2].correlation_id == rows[3].correlation_id
    assert "password" not in str(rows)


async def test_retention_cap_and_disabled_telemetry(session, sessionmaker_for_test):
    await session.execute(text("delete from owner_operation_events"))
    await session.execute(
        text("""insert into owner_operation_events(service,code,severity,correlation_id,observed_at)
       select 'api','unexpected_failure','error',gen_random_uuid(),now()-interval '31 days' from generate_series(1,5)""")
    )
    await session.execute(
        text("""insert into owner_operation_events(service,code,severity,correlation_id)
       select 'api','unexpected_failure','error',gen_random_uuid() from generate_series(1,10005)""")
    )
    await session.commit()
    await record(
        "api",
        "unexpected_failure",
        uuid4(),
        factory=sessionmaker_for_test,
        enabled=False,
    )
    assert (
        await session.scalar(text("select count(*) from owner_operation_events"))
        == 10010
    )
    await session.rollback()
    await record(
        "api",
        "unexpected_failure",
        uuid4(),
        factory=sessionmaker_for_test,
        enabled=True,
    )
    assert (
        await session.scalar(text("select count(*) from owner_operation_events"))
        == 10000
    )
    assert (
        await session.scalar(
            text(
                "select count(*) from owner_operation_events where observed_at<now()-interval '30 days'"
            )
        )
        == 0
    )
    with pytest.raises(ValueError):
        await record(
            "api",
            "private raw error",
            uuid4(),
            factory=sessionmaker_for_test,
            enabled=True,
        )


async def test_telemetry_failure_never_replaces_worker_result():
    def broken():
        raise RuntimeError("database credentials")

    async with worker_observation("reminders", factory=broken, enabled=True):
        pass
    with pytest.raises(ValueError, match="original"):
        async with worker_observation("reminders", factory=broken, enabled=True):
            raise ValueError("original")
