/** Only known quiz payloads may select a screen; never execute a supplied URL. */
export function weeklyQuizNotificationId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  return value.type === 'weekly_quiz' && typeof value.quiz_id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.quiz_id)
    ? value.quiz_id : null;
}

/** Per mounted account instance: duplicate cold/warm events navigate only once. */
export function createQuizNotificationConsumer(open: (requestId: string) => void) {
  const seen = new Set<string>();
  let active = true;
  return {
    consume(requestId: string, data: unknown) {
      if (!active || !requestId || seen.has(requestId) || !weeklyQuizNotificationId(data)) return false;
      seen.add(requestId);
      if (seen.size > 100) seen.delete(seen.values().next().value!);
      open(requestId);
      return true;
    },
    dispose() { active = false; seen.clear(); },
  };
}
