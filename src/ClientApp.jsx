"use client";

/**
 * ClientApp — sandbox port of the original MedSync-AI client entry (main.jsx).
 *
 * The original mounts:
 *   GoogleOAuthProvider > BrowserRouter > NetworkProvider > SocketProvider >
 *   NotificationProvider > MedicineProvider > App
 *
 * In this environment the whole app must live on the single Next.js `/` route,
 * so BrowserRouter is swapped for HashRouter (URLs like /#/dashboard keep the
 * real path at `/` while preserving the original page components untouched).
 *
 * MASTER AUDIT P0-10/P1-62 — server-side logout hook: every logout path in
 * the app (Navbar, AppSidebar, Dashboard) dispatches `medsync-auth-changed`
 * after clearing localStorage. This single listener (additive wiring — no
 * page component is modified) forwards the event to POST /api/auth/logout,
 * which clears the HttpOnly session cookie that JavaScript cannot touch.
 * Without it, the cookie would keep authenticating raw API calls after the
 * UI logged out.
 */

import React, { useEffect } from "react";
import { HashRouter } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { NetworkProvider } from "./context/NetworkContext.jsx";
import { SocketProvider } from "./context/socketContext.jsx";
import { NotificationProvider } from "./context/notificationContext.jsx";
import { MedicineProvider } from "./context/medicationContext.jsx";
import App from "./App.jsx";

export default function ClientApp() {
  useEffect(() => {
    const onAuthChanged = () => {
      // Fire-and-forget: the UI never waits for the cookie to be cleared.
      if (typeof window !== "undefined" && !localStorage.getItem("token")) {
        fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).catch(() => {
          /* the cookie clears on the next login/logout cycle if this fails */
        });
      }
    };
    window.addEventListener("medsync-auth-changed", onAuthChanged);
    return () => window.removeEventListener("medsync-auth-changed", onAuthChanged);
  }, []);

  return (
    <GoogleOAuthProvider clientId="medsync-demo-client-id">
      <HashRouter>
        <NetworkProvider>
          <SocketProvider>
            <NotificationProvider>
              <MedicineProvider>
                <App />
              </MedicineProvider>
            </NotificationProvider>
          </SocketProvider>
        </NetworkProvider>
      </HashRouter>
    </GoogleOAuthProvider>
  );
}
