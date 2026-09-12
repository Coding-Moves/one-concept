/** Retry only while work remains or the API is unreachable. No native module:
 * timers pause in the background and resume immediately on foregrounding. */
export function createSyncLoop(run: () => Promise<boolean>, initiallyActive = true) {
  let active = initiallyActive;
  let stopped = false;
  let running = false;
  let wakeAgain = false;
  let delay = 5000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (ms: number) => {
    if (!active || stopped) return;
    cancel();
    timer = setTimeout(async () => {
      timer = undefined;
      running = true;
      let retry = true;
      try { retry = await run(); } catch { /* retry after transient failure */ }
      finally {
        running = false;
        if (wakeAgain) {
          wakeAgain = false;
          schedule(0);
        } else if (retry) {
          schedule(delay);
          delay = Math.min(delay * 2, 30000);
        } else {
          delay = 5000;
        }
      }
    }, ms);
  };
  const wake = () => {
    if (!active || stopped) return;
    delay = 5000;
    if (running) wakeAgain = true;
    else schedule(0);
  };

  return {
    wake,
    retry: () => { if (!running && timer === undefined) schedule(delay); },
    setActive: (next: boolean) => {
      active = next;
      if (active) wake();
      else { cancel(); wakeAgain = false; }
    },
    stop: () => { stopped = true; cancel(); wakeAgain = false; },
  };
}
