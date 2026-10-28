export type SetupFlow = "invite" | "recovery" | "setup";

const key = "one-concept-review-pending-password";

export function rememberPendingSetup(userId: string, flow: SetupFlow): void {
  localStorage.setItem(key, JSON.stringify({ userId, flow }));
}

export function hasPendingSetup(): boolean {
  return localStorage.getItem(key) !== null;
}

export function pendingSetupFor(userId: string): SetupFlow | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const pending = value as { userId?: unknown; flow?: unknown };
    return pending.userId === userId &&
      (pending.flow === "invite" || pending.flow === "recovery" || pending.flow === "setup")
      ? pending.flow : null;
  } catch {
    return null;
  }
}

export function clearPendingSetup(): void {
  localStorage.removeItem(key);
}
