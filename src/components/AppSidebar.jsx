import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarPlus,
  FlaskConical,
  LogOut,
  Pill,
  Settings,
} from "lucide-react";
import { useLanguage } from "../hooks/useTranslation.js";

/**
 * AppSidebar — the shared "Rhythm" light sidebar (design-system v4).
 *
 * A fixed-width (280px) near-white panel: logo, primary navigation with
 * mint-emerald active pills, a "stay in rhythm" section with the calendar
 * link, and a bottom user card + logout. Hidden on mobile — pages keep
 * their own mobile navigation.
 *
 * Presentational only: navigation/actions are passed in via `items`, so
 * every page keeps its own routing logic untouched.
 */
export default function AppSidebar({ items = [], activeId, onConnectCalendar, calendarLabel }) {
  const navigate = useNavigate();
  const { t, language, setLanguage: updateLanguage } = useLanguage();
  // Client-only component (loaded via dynamic ssr:false) — lazy initial
  // state reads the stored profile without an effect.
  const [user] = useState(() => {
    try {
      const stored =
        typeof window !== "undefined" ? localStorage.getItem("user") : null;
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const handleLogout = () => {
    localStorage.removeItem("token");
    window.dispatchEvent(new Event("medsync-auth-changed"));
    navigate("/login");
  };

  const initials = (user?.name || user?.email || "U")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // v5 item 43 — the research dashboard (de-identified supervisor view) is a
  // shared navigation entry shown on every page's sidebar. Pages pass their
  // own primary `items` (presentational contract unchanged); Research is
  // appended once here so no per-page edits are needed, and pages that list
  // it themselves (dedup by id) never see it twice.
  const researchItem = {
    id: "research",
    icon: FlaskConical,
    label: t("Research", "البحث"),
    onClick: () => navigate("/research"),
  };
  const navItems = items.some((item) => item.id === "research")
    ? items
    : [...items, researchItem];

  return (
    <aside className="sticky top-0 hidden h-screen w-[280px] shrink-0 flex-col bg-[#F8F9FA] md:flex">
      {/* Logo */}
      <div className="px-6 pt-7 pb-5">
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="group flex items-center gap-3 text-start"
          aria-label="MedSync AI — Dashboard"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-[0_6px_16px_-4px_rgba(5,150,105,0.55)] transition-transform duration-300 group-hover:scale-105">
            <Pill className="h-5 w-5" aria-hidden />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="ms-serif text-[17px] font-semibold tracking-tight text-slate-900">
              MedSync <span className="text-emerald-600">AI</span>
            </span>
            <span className="text-[11px] font-medium text-slate-400">
              {t("Stay in rhythm", "حافظ على إيقاعك")}
            </span>
          </span>
        </button>
      </div>

      {/* Primary navigation */}
      <nav aria-label="Primary" className="flex flex-col gap-1 px-4">
        {navItems.map((item) => {
          const active = item.id === activeId;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              aria-current={active ? "page" : undefined}
              className={
                active ? "nav-item-active-modern" : "nav-item-modern"
              }
            >
              <Icon
                className={`h-[18px] w-[18px] ${active ? "text-emerald-700" : "text-slate-400"}`}
                aria-hidden
              />
              <span className="text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Stay-in-rhythm section */}
      <div className="mt-8 px-4">
        <p className="ms-eyebrow px-4 pb-2">
          {t("Stay in rhythm", "حافظ على إيقاعك")}
        </p>
        <button
          type="button"
          onClick={onConnectCalendar || (() => navigate("/settings"))}
          className="nav-item-modern"
        >
          <CalendarPlus className="h-[18px] w-[18px] text-slate-400" aria-hidden />
          <span className="text-sm">
            {calendarLabel || t("Connect calendar", "ربط التقويم")}
          </span>
        </button>
      </div>

      {/* Bottom: logout + profile card */}
      <div className="mt-auto flex flex-col gap-3 px-5 pb-6">
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-2 self-start px-2 py-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-slate-700"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {t("Logout", "تسجيل الخروج")}
        </button>

        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white">
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-800">
              {user?.name || t("Demo User", "مستخدم تجريبي")}
            </span>
            <span className="block truncate text-xs text-slate-400">
              {user?.email || "demo@medsync.ai"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label={t("Settings", "الإعدادات")}
            title={t("Settings", "الإعدادات")}
          >
            <Settings className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Language pill toggle */}
        <div className="flex items-center gap-1 self-center rounded-xl bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => updateLanguage("en")}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all duration-200 ${
              language === "en"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            aria-pressed={language === "en"}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => updateLanguage("ar")}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all duration-200 ${
              language === "ar"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            aria-pressed={language === "ar"}
          >
            عربي
          </button>
        </div>
      </div>
    </aside>
  );
}
