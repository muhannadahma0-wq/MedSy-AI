"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "@/lib/i18n";
import { translate, type Dict } from "@/lib/i18n";
import type { InsightsDTO, MedicationDTO, TodaySummaryDTO, InteractionWarning } from "@/lib/types";

export type TabId = "today" | "medications" | "assistant" | "reports" | "insights" | "settings";
export type FontScale = "sm" | "md" | "lg" | "xl";

export const FONT_SCALE_MAP: Record<FontScale, string> = {
  sm: "15px",
  md: "16px",
  lg: "18px",
  xl: "20px",
};

interface SettingsState {
  locale: Locale;
  tab: TabId;
  fontScale: FontScale;
  highContrast: boolean;
  assistantSeed: string | null;
  setLocale: (locale: Locale) => void;
  setTab: (tab: TabId) => void;
  setFontScale: (scale: FontScale) => void;
  toggleHighContrast: (value: boolean) => void;
  setAssistantSeed: (q: string | null) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      locale: "ar",
      tab: "today",
      fontScale: "md",
      highContrast: false,
      assistantSeed: null,
      setLocale: (locale) => set({ locale }),
      setTab: (tab) => set({ tab }),
      setFontScale: (fontScale) => set({ fontScale }),
      toggleHighContrast: (highContrast) => set({ highContrast }),
      setAssistantSeed: (assistantSeed) => set({ assistantSeed }),
    }),
    {
      name: "medsync-settings",
      partialize: (s) => ({ locale: s.locale, fontScale: s.fontScale, highContrast: s.highContrast }) as SettingsState,
    }
  )
);

export function useI18n() {
  const locale = useSettings((s) => s.locale);
  const t = (key: keyof Dict, vars?: Record<string, string | number>) => translate(locale, key, vars);
  return { locale, t, dir: (locale === "ar" ? "rtl" : "ltr") as "rtl" | "ltr" };
}

interface DataState {
  loading: boolean;
  medications: MedicationDTO[];
  interactions: InteractionWarning[];
  today: TodaySummaryDTO | null;
  insights: InsightsDTO | null;
  error: string | null;
  refreshAll: () => Promise<void>;
  updateDoseStatus: (doseId: string, status: "taken" | "snoozed" | "skipped") => Promise<void>;
  deleteMedication: (id: string) => Promise<void>;
  resetDemo: () => Promise<void>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const useData = create<DataState>((set, get) => ({
  loading: true,
  medications: [],
  interactions: [],
  today: null,
  insights: null,
  error: null,

  refreshAll: async () => {
    set({ loading: true, error: null });
    try {
      const [meds, today, insights] = await Promise.all([
        api<{ medications: MedicationDTO[]; interactions: InteractionWarning[] }>("/api/medications"),
        api<TodaySummaryDTO>("/api/doses/today"),
        api<InsightsDTO>("/api/insights"),
      ]);
      set({
        medications: meds.medications,
        interactions: meds.interactions,
        today,
        insights,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : "error" });
    }
  },

  updateDoseStatus: async (doseId, status) => {
    // optimistic update
    const prev = get().today;
    if (prev) {
      set({
        today: {
          ...prev,
          doses: prev.doses.map((d) =>
            d.id === doseId ? { ...d, status, respondedAt: new Date().toISOString() } : d
          ),
        },
      });
    }
    try {
      const today = await api<TodaySummaryDTO>(`/api/doses/${doseId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      set({ today });
      // refresh insights in background (streak/adherence changed)
      api<InsightsDTO>("/api/insights").then((insights) => set({ insights })).catch(() => {});
    } catch (e) {
      set({ today: prev, error: e instanceof Error ? e.message : "error" });
      throw e;
    }
  },

  deleteMedication: async (id) => {
    await api(`/api/medications?id=${id}`, { method: "DELETE" });
    await get().refreshAll();
  },

  resetDemo: async () => {
    set({ loading: true });
    await api("/api/seed", { method: "POST" });
    await get().refreshAll();
  },
}));
