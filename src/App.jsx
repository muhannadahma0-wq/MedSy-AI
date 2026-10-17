import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSocket } from "./context/socketContext.jsx";
import { LanguageProvider } from "./context/languageContext.jsx";
import { CalendarSyncProvider } from "./context/calendarSyncContext.jsx";

// Pages
import LandingPage from "./pages/landingPage.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import HealthProfile from "./pages/HealthProfile.jsx";
import MedicationEntryForm from "./pages/addMedication.jsx";
import MultiAgentChat from "./pages/agents.jsx";
import NotificationsPage from "./pages/notifications.jsx";
import OAuthCallback from "./pages/OAuthCallback.jsx";
import Analytics from "./pages/Analytics.jsx";
import Intelligence from "./pages/intelligence.jsx";
import AIMonitoring from "./pages/aiMonitoring.jsx";
import ResearchOverview from "./pages/research.jsx";
import Reports from "./pages/Reports.jsx";
import ReportChat from "./pages/ReportChat.jsx";
import ReportAnalysis from "./pages/ReportAnalysis.jsx";
import Settings from "./pages/Settings.jsx";

// Components
import NotificationContainer from "./components/NotificationToast.jsx";
// Offline sync (plan §Phase 11) — queue replay engine + visible status badge.
import SyncStatusBadge from "./components/SyncStatusBadge.jsx";
import { startSyncEngine } from "./services/offline/syncEngine";
//import OfflineBanner from "./components/OfflineBanner.jsx";

function App() {
  const { notifications, removeNotification } = useSocket();

  // Phase 11 — start the offline queue replay engine once per page load
  // (idempotent; listens to online/offline, flushes every 30s and on focus).
  useEffect(() => {
    startSyncEngine();
    // Phase 13 — re-apply the persisted text-size preference (root
    // font-size %) so the accessibility setting survives reloads.
    const savedSize = localStorage.getItem("medsync-text-size");
    if (["100", "110", "125"].includes(savedSize || "")) {
      document.documentElement.style.fontSize = `${savedSize}%`;
    }
  }, []);

  return (
    <LanguageProvider>
      <CalendarSyncProvider>

        {/* Global offline indicator */}
        {/*<OfflineBanner />*/}

        {/* Phase 11 — visible sync status (offline / syncing / queued count) */}
        <SyncStatusBadge />

        <Routes>
          <Route path="/" element={<Navigate to="/landing" />} />
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/agents" element={<MultiAgentChat />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/health" element={<HealthProfile />} />
          <Route path="/addMedication" element={<MedicationEntryForm />} />
          <Route path="/oauth2callback" element={<OAuthCallback />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/intelligence" element={<Intelligence />} />
          <Route path="/ai-monitoring" element={<AIMonitoring />} />
          <Route path="/research" element={<ResearchOverview />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reportChat" element={<ReportChat />} />
          <Route path="/report-analysis" element={<ReportAnalysis />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>

        {/* Global notification toasts */}
        <NotificationContainer
          notifications={notifications}
          onRemoveNotification={removeNotification}
        />

      </CalendarSyncProvider>
    </LanguageProvider>
  );
}

export default App;