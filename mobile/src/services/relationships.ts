import { ApiError, apiRequest } from '../api/client';

export interface RelationshipEntry {
  id: string;
  display_name: string;
  public_path: string | null;
  avatar_ref?: string | null;
  avatar_url?: string | null;
}

export interface RelationshipPage {
  items: RelationshipEntry[];
  next_cursor: string | null;
}

export interface RelationshipStatus {
  state: 'available' | 'connected' | 'self' | 'unavailable';
  relationship_id: string | null;
}

const prefix = '/v1/me/relationships';
const tokenPath = (token: string) => `${prefix}/with/${encodeURIComponent(token)}`;
const account = (id: string) => ({ expectedUserId: id });

export const relationshipList = (id: string, cursor?: string) =>
  apiRequest<RelationshipPage>(`${prefix}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, account(id));
export const relationshipStatus = (id: string, token: string) => apiRequest<RelationshipStatus>(tokenPath(token), account(id));
export const connectProfile = (id: string, token: string) =>
  apiRequest<RelationshipStatus>(tokenPath(token), { ...account(id), method: 'POST', rateLimitScope: 'request' });
export const disconnectProfile = (id: string, relationshipId: string) =>
  apiRequest<void>(`${prefix}/${encodeURIComponent(relationshipId)}`, { ...account(id), method: 'DELETE' });
export const blockRelationship = (id: string, relationshipId: string) =>
  apiRequest<void>(`${prefix}/${encodeURIComponent(relationshipId)}/block`, { ...account(id), method: 'POST', rateLimitScope: 'request' });
export const blockProfileConnection = (id: string, token: string) =>
  apiRequest<void>(`${tokenPath(token)}/block`, { ...account(id), method: 'POST' });

export function relationshipError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'You have reached today’s Connect limit. Please try again tomorrow.';
    if (error.status === 404) return 'This profile is unavailable.';
    if (error.status === 401) return 'Your session changed. Sign in again to continue.';
  }
  return 'Could not update this connection. Check your internet and try again.';
}

const changed = new Set<() => void>();
export function relationshipsChanged() { changed.forEach(listener => listener()); }
export function onRelationshipsChanged(listener: () => void) { changed.add(listener); return () => { changed.delete(listener); }; }
