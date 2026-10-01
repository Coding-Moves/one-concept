import { ApiError, apiRequest } from '../api/client';

export type ConnectionKind = 'accepted' | 'incoming' | 'outgoing' | 'blocked';
export type ConnectionAction = 'accept' | 'decline' | 'cancel' | 'remove' | 'block';
export interface ConnectionEntry { id: string; display_name: string; public_path: string | null }
export interface ConnectionPage { items: ConnectionEntry[]; next_cursor: string | null }
export interface ConnectionPreferences { accepting_requests: boolean; version: number }
export interface ConnectionStatus { state: 'available' | 'unavailable' | 'self' | 'incoming' | 'outgoing' | 'accepted' | 'cooldown'; id: string | null; retry_after?: number | null }
const prefix = '/v1/me/connections';
const account = (id: string) => ({ expectedUserId: id });
const tokenPath = (token: string) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid profile link');
  return `${prefix}/with/${token}`;
};
export const connectionSettings = (id: string) => apiRequest<ConnectionPreferences>(`${prefix}/settings`, account(id));
export const saveConnectionSettings = (id: string, body: ConnectionPreferences) => apiRequest<ConnectionPreferences>(`${prefix}/settings`, { ...account(id), method: 'PUT', body });
export const connectionList = (id: string, kind: ConnectionKind, cursor?: string) => apiRequest<ConnectionPage>(`${prefix}?kind=${kind}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, account(id));
export const connectionStatus = (id: string, token: string) => apiRequest<ConnectionStatus>(tokenPath(token), account(id));
export const requestConnection = (id: string, token: string) => apiRequest<ConnectionStatus>(tokenPath(token), { ...account(id), method: 'POST', rateLimitScope: 'request' });
export const actOnConnection = (id: string, relationship: string, action: ConnectionAction) => apiRequest<void>(`${prefix}/${encodeURIComponent(relationship)}/actions`, { ...account(id), method: 'POST', body: { action } });
export const blockProfile = (id: string, token: string) => apiRequest<void>(`${tokenPath(token)}/block`, { ...account(id), method: 'POST' });
export const unblockConnection = (id: string, block: string) => apiRequest<void>(`${prefix}/blocks/${encodeURIComponent(block)}`, { ...account(id), method: 'DELETE' });
export function connectionError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Please wait before sending another request. Requests are limited to 20 per day, with a seven-day wait after a request ends.';
    if (error.status === 409) return 'This connection changed. Reload to see its current status.';
    if (error.status === 404) return 'This connection is unavailable. Check your sharing choices and try reloading.';
    if (error.status === 401) return 'Your session changed. Sign in again to continue.';
  }
  return 'Could not confirm that change. Check your connection and reload before retrying.';
}

const changed = new Set<() => void>();
export function connectionsChanged() { changed.forEach(listener => listener()); }
export function onConnectionsChanged(listener: () => void) { changed.add(listener); return () => { changed.delete(listener); }; }
