(() => {
  const token = /^\/p\/([A-Za-z0-9_-]{43})$/.exec(location.pathname)?.[1];
  const config = window.ONE_CONCEPT_PUBLIC_CONFIG;
  const status = document.getElementById('status');
  const unavailable = () => { status.textContent = 'This profile is private or no longer available.'; };
  if (!token || !config?.apiUrl || !config?.supabaseUrl) { unavailable(); return; }

  fetch(`${config.apiUrl}/v1/public-profiles/${token}`, {
    cache: 'no-store', credentials: 'omit', redirect: 'error',
  }).then(async (response) => {
    if (!response.ok) throw new Error('unavailable');
    const profile = await response.json();
    if (!profile || !Array.isArray(profile.achievements)) throw new Error('invalid');
    document.getElementById('name').textContent = profile.display_name || 'One Concept learner';
    document.title = 'Shared profile · One Concept';
    const bio = document.getElementById('bio');
    if (typeof profile.bio === 'string' && profile.bio) { bio.textContent = profile.bio; bio.hidden = false; }
    const highlights = document.getElementById('highlights');
    if (Number.isSafeInteger(profile.current_streak) && profile.current_streak >= 0) {
      const streak = document.getElementById('streak');
      streak.textContent = `Current streak: ${profile.current_streak} days · Best: ${profile.longest_streak ?? profile.current_streak} days`;
      streak.hidden = false; highlights.hidden = false;
    }
    if (Number.isSafeInteger(profile.concepts_learned) && profile.concepts_learned >= 0) {
      const learning = document.getElementById('learning');
      learning.textContent = `${profile.concepts_learned} concepts learned`;
      learning.hidden = false; highlights.hidden = false;
    }
    const awards = document.getElementById('awards');
    const list = document.getElementById('awards-list');
    for (const item of profile.achievements) {
      if (typeof item?.name !== 'string' || typeof item?.description !== 'string') continue;
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = item.name;
      li.append(strong, ` — ${item.description}`);
      list.append(li);
      awards.hidden = false;
    }
    if (typeof profile.avatar_url === 'string') {
      try {
        const image = new URL(profile.avatar_url);
        if (image.origin === config.supabaseUrl && image.pathname.startsWith('/storage/v1/object/sign/profile-avatars/')) {
          const avatar = document.getElementById('avatar');
          avatar.src = image.href; avatar.hidden = false;
        }
      } catch { /* An invalid optional photo must not hide the public text. */ }
    }
    const open = document.getElementById('open-app');
    open.href = `com.codingmoves.oneconcept://p/${token}`;
    open.hidden = false;
    status.textContent = '';
  }).catch(unavailable);
})();
