import React, { createContext, useEffect, useState } from "react";
import { subscribeToNetwork } from "../services/network/networkListener";

export const NetworkContext = createContext({ online: true });

export function NetworkProvider({ children }) {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const unsubscribe = subscribeToNetwork(setOnline);
    return unsubscribe;
  }, []);

  return (
    <NetworkContext.Provider value={{ online }}>
      {children}
    </NetworkContext.Provider>
  );
}
