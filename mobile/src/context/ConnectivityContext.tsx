import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { getConnectivity, subscribeConnectivity } from '../api/client';

/**
 * App-wide online/offline state, inferred from request outcomes in the API
 * client (no native connectivity module — keeps the app JS-only / OTA). Starts
 * optimistic (online) and flips the first time a request fails or succeeds.
 */
const ConnectivityContext = createContext<boolean>(true);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<boolean>(getConnectivity());
  useEffect(() => subscribeConnectivity(setOnline), []);
  return <ConnectivityContext.Provider value={online}>{children}</ConnectivityContext.Provider>;
}

/** True when the last network attempt reached the server. */
export function useOnline(): boolean {
  return useContext(ConnectivityContext);
}
