import { useAchievements } from '../context/AchievementsContext';
import { AchievementDetail } from './AchievementDetail';

/** One summary for historical/imported awards; no stack of milestone pop-ups.
 * Wait for What's New to close so a release never presents competing modals. */
export function AchievementCelebration({ paused }: { paused: boolean }) {
  const { unseen, dismiss } = useAchievements();
  if (paused || unseen.length === 0) return null;
  const highest = unseen[unseen.length - 1];
  return <AchievementDetail key={highest.code} award={highest} celebration count={unseen.length}
    onClose={() => dismiss(unseen.map(a => a.code))} />;
}
