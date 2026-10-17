import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Settings, LogOut, Bell } from "lucide-react";
import { useLanguage } from "../hooks/useTranslation.js";

/**
 * Navbar — "Rhythm" top bar (v4): frosted dark strip above the slate canvas.
 * Same navigation/logout behaviour as before — presentation only.
 */
export default function Navbar() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleLogout = () => {
    localStorage.removeItem("token"); // remove JWT
    window.dispatchEvent(new Event("medsync-auth-changed")); // sandbox: tear socket down (original used full page nav)
    navigate("/login");
  };

  return (
    <nav className="sticky top-0 z-40 border-b border-white/5 bg-slate-950/70 px-4 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3">
        <div className="flex items-center gap-1 sm:gap-x-2">
          <Link
            to="/dashboard"
            className="rounded-full px-3.5 py-2 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-white/5 hover:text-white"
          >
            {t("Dashboard", "لوحة التحكم")}
          </Link>
          <Link
            to="/health"
            className="rounded-full px-3.5 py-2 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-white/5 hover:text-white"
          >
            {t("Health", "الصحة")}
          </Link>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher />
          <button
            onClick={() => navigate("/notifications")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-400 transition-all duration-200 hover:bg-white/10 hover:text-white"
            title={t("Notifications", "الإشعارات")}
            aria-label={t("Notifications", "الإشعارات")}
          >
            <Bell className="h-5 w-5" />
          </button>
          <button
            onClick={() => navigate("/settings")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-400 transition-all duration-200 hover:bg-white/10 hover:text-white"
            title={t("Settings", "الإعدادات")}
            aria-label={t("Settings", "الإعدادات")}
          >
            <Settings className="h-5 w-5" />
          </button>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-300 transition-all duration-200 hover:border-red-400/40 hover:bg-red-500/20 active:scale-[0.98]"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t("Logout", "تسجيل الخروج")}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
