import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Achievement, AchievementSnapshot, AchievementStore, uncelebrated } from '../services/achievementStore';
import { createAchievementStore } from '../services/achievementsApi';
import { useAuth } from './AuthContext';
import { useOnline } from './ConnectivityContext';
import { useProgress } from './ProgressContext';

interface Value {
  snapshot: AchievementSnapshot | null;
  loading: boolean;
  failed: boolean;
  fresh: boolean;
  unseen: Achievement[];
  refresh: () => Promise<void>;
  dismiss: (codes: string[]) => void;
}
const Context = createContext<Value | null>(null);

/** The key resets snapshots, dismissed state and in-flight UI work immediately
 * on identity replacement, including a direct A → B switch without sign-out. */
export function AchievementsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return <AccountAchievements key={session?.user.id ?? 'signed-out'} userId={session?.user.id}>{children}</AccountAchievements>;
}

function AccountAchievements({ userId, children }: { userId?: string; children: ReactNode }) {
  const { progress, loading: progressLoading } = useProgress();
  const online = useOnline();
  const store = useRef<AchievementStore | null>(null);
  const [snapshot, setSnapshot] = useState<AchievementSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [failed, setFailed] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    if (!userId) return;
    const account = createAchievementStore(userId);
    store.current = account;
    let active = true;
    void account.cached().then(cached => {
      if (active && cached) { setSnapshot(current => current ?? cached); setLoading(false); }
    });
    return () => { active = false; account.dispose(); store.current = null; };
  }, [userId]);

  const refresh = useCallback(async () => {
    const account = store.current;
    if (!account) return;
    try {
      const result = await account.refresh();
      if (store.current !== account || !result) return;
      setSnapshot(result); setFailed(false); setFresh(true);
    } catch {
      if (store.current === account) { setFailed(true); setFresh(false); }
    } finally {
      if (store.current === account) setLoading(false);
    }
  }, []);

  // Confirmed progress and offline replay both replace this snapshot. Debounce
  // optimistic/confirmed renders; do not derive an award from optimistic counts.
  useEffect(() => {
    if (!userId || progressLoading) return;
    const timer = setTimeout(() => { void refresh(); }, 200);
    return () => clearTimeout(timer);
  }, [userId, progressLoading, progress, online, refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => listener.remove();
  }, [refresh]);

  const dismiss = useCallback((codes: string[]) => {
    setDismissed(current => [...new Set([...current, ...codes])]);
    const account = store.current;
    if (!account) return;
    void account.dismiss(codes).then(result => {
      if (store.current === account && result) setSnapshot(result);
    });
  }, []);
  const value = useMemo<Value>(() => ({
    snapshot, loading, failed, fresh, refresh, dismiss,
    unseen: fresh ? uncelebrated(snapshot).filter(a => !dismissed.includes(a.code)) : [],
  }), [snapshot, loading, failed, fresh, refresh, dismiss, dismissed]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAchievements() {
  const value = useContext(Context);
  if (!value) throw new Error('AchievementsProvider is required');
  return value;
}
