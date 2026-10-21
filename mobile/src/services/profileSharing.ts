import { API_BASE_URL, ApiError, apiRequest } from '../api/client';
import { fetchWithTimeout } from '../api/fetchWithTimeout';
import qrcode from 'qrcode-generator';

export interface SharingSettings {
  enabled: boolean;
  show_name: boolean;
  show_avatar: boolean;
  show_bio: boolean;
  show_streak: boolean;
  show_learning: boolean;
  achievement_codes: string[];
  version: number;
  public_path: string | null;
}
export interface PublicProfile {
  display_name?: string;
  bio?: string;
  avatar_ref?: string;
  avatar_url?: string;
  current_streak?: number;
  longest_streak?: number;
  concepts_learned?: number;
  achievements: { name: string; description: string }[];
}
export const getSharing = (userId: string) => apiRequest<SharingSettings>('/v1/me/profile-sharing', { expectedUserId: userId });
export function putSharing(userId: string, settings: SharingSettings) {
  const { public_path: _, ...body } = settings;
  return apiRequest<SharingSettings>('/v1/me/profile-sharing', { method: 'PUT', body, expectedUserId: userId });
}
export function publicProfileUrl(path: string): string {
  if (!/^\/p\/[A-Za-z0-9_-]{43}$/.test(path)) throw new Error('Invalid public profile link');
  const value = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '';
  const base = new URL(value);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid public website URL');
  return `${base.origin}${path}`;
}
export function profileTokenFromLink(link: string): string | null {
  const scheme = 'com.codingmoves.oneconcept://';
  if (link.startsWith(scheme)) return /^p\/([A-Za-z0-9_-]{43})$/.exec(link.slice(scheme.length))?.[1] ?? null;
  try {
    const url = new URL(link);
    const web = new URL(process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '');
    const legacy = process.env.EXPO_PUBLIC_LEGACY_WEB_BASE_URL
      ? new URL(process.env.EXPO_PUBLIC_LEGACY_WEB_BASE_URL) : null;
    if ((url.origin !== web.origin && url.origin !== legacy?.origin)
      || url.username || url.password || url.search || url.hash) return null;
    return /^\/p\/([A-Za-z0-9_-]{43})$/.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}
/** Visitors never send an account token or read an offline copy of revoked data. */
export async function getPublicProfile(token: string): Promise<PublicProfile> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid profile');
  const response = await fetchWithTimeout(`${API_BASE_URL}/v1/public-profiles/${token}`, { cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status, 'Profile unavailable');
  return response.json();
}
export function profileQr(url: string): boolean[][] {
  const token = profileTokenFromLink(url);
  if (!token || url !== publicProfileUrl(`/p/${token}`)) throw new Error('Invalid share URL');
  const code = qrcode(0, 'M');
  code.addData(url); code.make();
  return Array.from({ length: code.getModuleCount() }, (_, row) =>
    Array.from({ length: code.getModuleCount() }, (_, col) => code.isDark(row, col)));
}
