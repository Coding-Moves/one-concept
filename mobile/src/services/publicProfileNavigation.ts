import { profileTokenFromLink } from './profileSharing';
const listeners = new Set<(url: string) => void>();
/** Transient UI intent only: no visited profile or account data is stored. */
export function openPublicProfile(url: string): boolean {
  if (!profileTokenFromLink(url)) return false;
  listeners.forEach(listener => listener(url));
  return true;
}
export function onPublicProfileOpen(listener: (url: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
