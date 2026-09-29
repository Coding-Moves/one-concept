/** Deterministic greeting based on the profile timezone, never device/server time. */
export function greetingFor(date: Date, timezone?: string, displayName?: string | null): string {
  let hour: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', hourCycle: 'h23', timeZone: timezone,
    }).formatToParts(date);
    hour = Number(parts.find((part) => part.type === 'hour')?.value);
  } catch {
    hour = date.getHours();
  }
  const salutation = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = displayName?.trim();
  return name ? `${salutation}, ${name}` : salutation;
}
