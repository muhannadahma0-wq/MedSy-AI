"use client";

import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";
import {
  BotMessageSquare,
  CalendarCheck2,
  ChartLine,
  FileText,
  Languages,
  Moon,
  Pill,
  Settings2,
  Sun,
  HeartPulse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FONT_SCALE_MAP, useI18n, useSettings, useData, type TabId } from "@/lib/store";
import { fmtFullDate } from "@/lib/format";
import { TodayView } from "./today-view";
import { MedicationsView } from "./medications-view";
import { AssistantView } from "./assistant-view";
import { ReportsView } from "./reports-view";
import { InsightsView } from "./insights-view";
import { SettingsView } from "./settings-view";

const NAV: { id: TabId; labelKey: Parameters<ReturnType<typeof useI18n>["t"]>[0]; icon: typeof Pill }[] = [
  { id: "today", labelKey: "navToday", icon: CalendarCheck2 },
  { id: "medications", labelKey: "navMedications", icon: Pill },
  { id: "assistant", labelKey: "navAssistant", icon: BotMessageSquare },
  { id: "reports", labelKey: "navReports", icon: FileText },
  { id: "insights", labelKey: "navInsights", icon: ChartLine },
  { id: "settings", labelKey: "navSettings", icon: Settings2 },
];

/** Hydration-safe "mounted" flag without setState-in-effect. */
const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <HeartPulse className="size-5" aria-hidden />
      </span>
      {!compact && (
        <span className="flex flex-col leading-tight">
          <span className="font-bold tracking-tight">{t("appName")}</span>
          <span className="text-[11px] text-muted-foreground">{t("appTagline")}</span>
        </span>
      )}
    </div>
  );
}

export function AppShell() {
  const { t, locale, dir } = useI18n();
  const tab = useSettings((s) => s.tab);
  const setTab = useSettings((s) => s.setTab);
  const setLocale = useSettings((s) => s.setLocale);
  const fontScale = useSettings((s) => s.fontScale);
  const highContrast = useSettings((s) => s.highContrast);
  const refreshAll = useData((s) => s.refreshAll);
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  // Apply locale / a11y preferences to <html>
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SCALE_MAP[fontScale];
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.classList.toggle("hc", highContrast);
  }, [highContrast]);

  // First visit → seed the demo profile, then load data
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    const run = async () => {
      const seeded = window.localStorage.getItem("medsync-seeded");
      if (!seeded) {
        try {
          await fetch("/api/seed", { method: "POST" });
          window.localStorage.setItem("medsync-seeded", "1");
        } catch {
          /* seeding is best-effort */
        }
      }
      if (!cancelled) refreshAll();
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [mounted, refreshAll]);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <span className="flex size-12 animate-pulse items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <HeartPulse className="size-6" aria-hidden />
          </span>
          <span className="text-sm text-muted-foreground">MedSync AI</span>
        </div>
      </div>
    );
  }

  const toggleLang = () => setLocale(locale === "ar" ? "en" : "ar");
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const view = (() => {
    switch (tab) {
      case "today":
        return <TodayView />;
      case "medications":
        return <MedicationsView />;
      case "assistant":
        return <AssistantView />;
      case "reports":
        return <ReportsView />;
      case "insights":
        return <InsightsView />;
      case "settings":
        return <SettingsView />;
    }
  })();

  const activeNav = NAV.find((n) => n.id === tab);

  return (
    <div className="flex min-h-screen w-full">
      {/* ===== Desktop sidebar ===== */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-5 pt-6 pb-4">
          <Logo />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1 px-3">
          {NAV.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className={cn("size-[18px]", active && "text-primary")} aria-hidden />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto px-5 pb-6">
          <div className="rounded-xl border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">{t("demoProfile")}</p>
            <p className="mt-0.5 text-sm font-semibold">{t("demoUser")}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleLang}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("languageLabel")}
              >
                <Languages className="size-3.5" aria-hidden />
                {locale === "ar" ? "EN" : "ع"}
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex size-8 items-center justify-center rounded-md border bg-background hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("themeLabel")}
              >
                {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== Main column ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 px-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="md:hidden">
                <Logo compact />
              </span>
              <div className="hidden min-w-0 md:block">
                <h1 className="truncate text-lg font-bold leading-tight">{t(activeNav?.labelKey ?? "navToday")}</h1>
                <p className="truncate text-xs text-muted-foreground">{fmtFullDate(locale, new Date())}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleLang}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs font-semibold hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("languageLabel")}
              >
                <Languages className="size-4" aria-hidden />
                <span>{locale === "ar" ? "EN" : "عربي"}</span>
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex size-9 items-center justify-center rounded-lg border bg-background hover:bg-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("themeLabel")}
              >
                {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
              </button>
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-28 md:pb-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {view}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="mt-auto border-t bg-muted/40 pb-24 md:pb-0">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-4 text-[11px] leading-relaxed text-muted-foreground">
            <p>{t("safetyDisclaimer")}</p>
            <p>
              MedSync AI — graduation project prototype · upstream: tirth-patel06/MedSync-AI (MIT)
            </p>
          </div>
        </footer>
      </div>

      {/* ===== Mobile bottom tab bar ===== */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-6">
          {NAV.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="size-5" aria-hidden />
                <span className="truncate leading-none">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
