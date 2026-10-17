"use client";

import dynamic from "next/dynamic";

// The MedSync-AI client is a browser-only SPA (localStorage, sockets,
// window listeners), so it is loaded with SSR disabled.
const ClientApp = dynamic(() => import("@/ClientApp.jsx"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="animate-spin rounded-full h-16 w-16 border-4 border-orange-500 border-t-transparent" />
    </div>
  ),
});

export default function Home() {
  return <ClientApp />;
}
