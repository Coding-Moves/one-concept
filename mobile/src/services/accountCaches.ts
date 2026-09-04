/**
 * The one list of everything cached FOR AN ACCOUNT on this device.
 *
 * Adding a new account-scoped cache? Its clearer belongs here — this list is
 * what sign-out wipes, and a cache missing from it outlives the account
 * (exactly issue #31). Device-scoped stores (theme, the signed-out demo
 * progress) deliberately stay out.
 */

import { clearDailyCache } from './dailyApi';
import { clearNotificationPrefsCache } from './notifications';
import { clearServerStateCache } from './remoteProgressRepository';

export async function clearAccountCaches(): Promise<void> {
  await Promise.all([
    clearServerStateCache(),
    clearDailyCache(),
    clearNotificationPrefsCache(),
  ]);
}
