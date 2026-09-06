"""Notification preference writes (issue #131)."""

from app.api.v1.me import _load_prefs, save_notification_prefs
from app.schemas.notifications import NotificationPrefs


async def test_saving_prefs_persists_off_and_new_times(session, user):
    # The toggle used to snap back on because this write 500'd: asyncpg can't
    # encode "HH:MM" strings as time[]. Turning reminders off must now stick.
    await save_notification_prefs(
        session, user, NotificationPrefs(enabled=False, reminder_times=["09:00", "21:00"])
    )
    prefs = await _load_prefs(session, user)
    assert prefs.enabled is False
    assert prefs.reminder_times == ["09:00", "21:00"]

    # And back on, single time.
    await save_notification_prefs(
        session, user, NotificationPrefs(enabled=True, reminder_times=["07:30"])
    )
    prefs = await _load_prefs(session, user)
    assert prefs.enabled is True
    assert prefs.reminder_times == ["07:30"]
