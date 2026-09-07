import { createContext, ReactNode, useContext, useSyncExternalStore } from 'react';
import { getConnectivity, subscribeConnectivity } from '../api/client';

/**
 * App-wide online/offline state, inferred from request outcomes in the API
 * client (no native connectivity module — keeps the app JS-only / OTA).
 *
 * useSyncExternalStore reads the current value on every render and can't drop a
 * flip that happens before subscription — important because child providers
 * fire the first requests (flipping connectivity) before this parent's effects
 * would run (issue #133).
 */
const ConnectivityContext = createContext<boolean>(true);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const online = useSyncExternalStore(subscribeConnectivity, getConnectivity);
  return <ConnectivityContext.Provider value={online}>{children}</ConnectivityContext.Provider>;
}

/** True when the last network attempt reached the server. */
export function useOnline(): boolean {
  return useContext(ConnectivityContext);
}
