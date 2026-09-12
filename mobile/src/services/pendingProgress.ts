import type { ProgressState } from '../types';
import type { QueuedMutation } from './mutationOutbox';

/** A server refresh must not erase actions still waiting for acknowledgement. */
export function withPendingProgress(
  server: ProgressState,
  previous: ProgressState,
  mutations: QueuedMutation[],
): ProgressState {
  let state = server;
  for (const mutation of mutations) {
    if (mutation.kind === 'like' || mutation.kind === 'save') {
      const key = mutation.kind === 'like' ? 'likes' : 'bookmarks';
      const ids = state[key].filter(id => id !== mutation.slug);
      if (mutation.desired) ids.push(mutation.slug);
      state = { ...state, [key]: ids };
      if (mutation.kind === 'save') {
        const saved = (state.savedConcepts ?? []).filter(row => row.conceptId !== mutation.slug);
        const row = previous.savedConcepts?.find(row => row.conceptId === mutation.slug)
          ?? server.savedConcepts?.find(row => row.conceptId === mutation.slug);
        if (mutation.desired && row) saved.push(row);
        state = { ...state, savedConcepts: saved };
      }
    } else if (mutation.kind === 'learn' && mutation.date === state.assignment?.date) {
      const record = previous.learned.find(row => row.date === mutation.date);
      if (record && !state.learned.some(row => row.date === mutation.date)) {
        state = { ...state, learned: [...state.learned, record], stats: previous.stats ?? state.stats };
      }
    }
  }
  return state;
}
