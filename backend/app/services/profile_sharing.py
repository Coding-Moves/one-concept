"""Explicit public allowlist; never serialize an account/profile row to visitors."""
import secrets

from fastapi import HTTPException
from sqlalchemy import text

from app.schemas.profile_sharing import PublicAchievement, PublicProfile, SharingOut
from app.services.streaks import compute_streaks
from app.config import get_settings
from app.services.profile_avatar import signed_avatar_url


async def sharing_row(db, user_id):
    await db.execute(text('''insert into public.profile_sharing(user_id, public_token)
        values (:uid,:token) on conflict (user_id) do nothing'''),
        {'uid': user_id, 'token': secrets.token_urlsafe(32)})
    return (await db.execute(text('select * from public.profile_sharing where user_id=:uid for update'),
                             {'uid': user_id})).one()


def sharing_output(row):
    return SharingOut(enabled=row.enabled, show_name=row.show_name, show_avatar=row.show_avatar,
                      show_streak=row.show_streak, show_learning=row.show_learning,
                      achievement_codes=row.achievement_codes, version=row.version,
                      public_path=f'/p/{row.public_token}' if row.enabled else None)


async def save_sharing(db, user_id, body):
    row = await sharing_row(db, user_id)
    if row.version != body.version:
        raise HTTPException(409, 'Settings changed. Reload before saving.')
    codes = sorted(set(body.achievement_codes))
    earned = set((await db.execute(text('select achievement_code from public.user_achievements where user_id=:uid'),
                                  {'uid': user_id})).scalars())
    if not set(codes) <= earned:
        raise HTTPException(422, 'Only earned achievements can be shared')
    # Revoked URLs never regain access when sharing is enabled again.
    token = secrets.token_urlsafe(32) if row.enabled and not body.enabled else row.public_token
    await db.execute(text('''update public.profile_sharing set enabled=:enabled,
        show_name=:show_name,show_avatar=:show_avatar,show_streak=:show_streak,show_learning=:show_learning,
        achievement_codes=:codes,public_token=:token,version=version+1 where user_id=:uid'''),
        {**body.model_dump(exclude={'achievement_codes', 'version'}), 'uid': user_id,
         'codes': codes, 'token': token})
    result = sharing_output(await sharing_row(db, user_id))
    await db.commit()
    return result


async def public_profile(db, token):
    row = (await db.execute(text('''select s.*,p.display_name,p.avatar_url from public.profile_sharing s
        join public.profiles p on p.id=s.user_id
        where s.public_token=:token and s.enabled for share of s'''), {'token': token})).first()
    if row is None:
        raise HTTPException(404, 'Profile unavailable', headers={'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow'})
    result = PublicProfile()
    # Name sharing is explicit; no email or authentication row is queried.
    if row.show_name:
        result.display_name = row.display_name or 'Learner'
    if row.show_avatar:
        result.avatar_url = await signed_avatar_url(get_settings(), row.avatar_url)
    if row.show_streak or row.show_learning:
        stats = await compute_streaks(db, row.user_id)
        if row.show_streak:
            result.current_streak, result.longest_streak = stats.current, stats.longest
        if row.show_learning:
            result.concepts_learned = stats.total_learned
    if row.achievement_codes:
        achievements = (await db.execute(text('''select d.name,d.description
            from public.user_achievements a join public.achievement_definitions d on d.code=a.achievement_code
            where a.user_id=:uid and a.achievement_code=any(:codes) order by d.sort_order,d.code'''),
            {'uid': row.user_id, 'codes': row.achievement_codes})).all()
        result.achievements = [PublicAchievement(name=a.name, description=a.description) for a in achievements]
    return result
