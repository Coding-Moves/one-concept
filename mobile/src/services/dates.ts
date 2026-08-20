/** Local calendar day as YYYY-MM-DD. Uses local time, not UTC — a "day" is the user's day. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Human-readable form of a YYYY-MM-DD key, e.g. "Aug 20, 2026". */
export function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The date key for the day before the given key. */
export function previousDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return toDateKey(date);
}
