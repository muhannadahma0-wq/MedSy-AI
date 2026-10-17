"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import {
  Contrast,
  Database,
  Globe,
  Info,
  Languages,
  Monitor,
  Moon,
  RefreshCcw,
  Sun,
  Type,
  Wind,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { FONT_SCALE_MAP, useI18n, useSettings, useData, type FontScale } from "@/lib/store";
import { cn } from "@/lib/utils";

function Row({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label className="text-sm font-medium leading-none">{label}</Label>
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function SettingsView() {
  const { t } = useI18n();
  const { locale, setLocale, fontScale, setFontScale, highContrast, toggleHighContrast } = useSettings();
  const resetDemo = useData((s) => s.resetDemo);
  const { theme, setTheme } = useTheme();
  const [resetting, setResetting] = useState(false);

  const fontValues: FontScale[] = ["sm", "md", "lg", "xl"];
  const fontIndex = fontValues.indexOf(fontScale);

  const doReset = async () => {
    setResetting(true);
    try {
      await resetDemo();
      toast.success(t("resetDone"));
    } catch {
      toast.error(t("error"));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-2xl font-bold tracking-tight">{t("settingsTitle")}</h2>
      </div>

      {/* Language */}
      <Card>
        <CardContent className="flex flex-col divide-y px-4 py-1">
          <div className="pb-1 pt-3 text-xs font-bold text-muted-foreground">{t("sectionLanguage")}</div>
          <Row icon={Languages} label={t("languageLabel")} hint={t("rtlNote")}>
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                variant={locale === "ar" ? "default" : "outline"}
                className="min-w-14"
                onClick={() => setLocale("ar")}
              >
                العربية
              </Button>
              <Button
                size="sm"
                variant={locale === "en" ? "default" : "outline"}
                className="min-w-14"
                onClick={() => setLocale("en")}
              >
                English
              </Button>
            </div>
          </Row>
          <Row icon={Globe} label="English / العربية" hint={t("appTagline")}>
            <span className="text-xs text-muted-foreground" dir="ltr">
              v0.1.0 · WP1 + WP4
            </span>
          </Row>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardContent className="flex flex-col divide-y px-4 py-1">
          <div className="pb-1 pt-3 text-xs font-bold text-muted-foreground">{t("sectionAppearance")}</div>
          <Row icon={theme === "dark" ? Moon : Sun} label={t("themeLabel")}>
            <div className="flex shrink-0 gap-1.5">
              {[
                { v: "light", label: t("themeLight"), icon: Sun },
                { v: "dark", label: t("themeDark"), icon: Moon },
                { v: "system", label: t("themeSystem"), icon: Monitor },
              ].map((opt) => (
                <Button
                  key={opt.v}
                  size="sm"
                  variant={theme === opt.v ? "default" : "outline"}
                  className="gap-1.5"
                  onClick={() => setTheme(opt.v)}
                  aria-pressed={theme === opt.v}
                >
                  <opt.icon className="size-3.5" aria-hidden />
                  <span className="hidden sm:inline">{opt.label}</span>
                </Button>
              ))}
            </div>
          </Row>

          <Row icon={Type} label={t("fontSizeLabel")} hint={t("fontSizeHint")}>
            <div className="flex w-44 shrink-0 items-center gap-3">
              <span className="text-[10px] font-bold text-muted-foreground">A</span>
              <Slider
                value={[fontIndex === -1 ? 1 : fontIndex]}
                min={0}
                max={3}
                step={1}
                onValueChange={([v]) => setFontScale(fontValues[v])}
                aria-label={t("fontSizeLabel")}
              />
              <span className="text-sm font-bold">A</span>
            </div>
          </Row>

          <Row icon={Contrast} label={t("highContrastLabel")} hint={t("highContrastHint")}>
            <Switch checked={highContrast} onCheckedChange={toggleHighContrast} aria-label={t("highContrastLabel")} />
          </Row>

          <Row icon={Wind} label={t("reducedMotionLabel")} hint={t("reducedMotionHint")}>
            <span className="text-xs font-medium text-muted-foreground">
              <span dir="ltr">prefers-reduced-motion</span>
            </span>
          </Row>
        </CardContent>
      </Card>

      {/* Data */}
      <Card>
        <CardContent className="flex flex-col divide-y px-4 py-1">
          <div className="pb-1 pt-3 text-xs font-bold text-muted-foreground">{t("sectionData")}</div>
          <Row icon={Database} label={t("resetDemo")} hint={t("resetDemoHint")}>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={doReset}
              disabled={resetting}
            >
              <RefreshCcw className={cn("size-3.5", resetting && "animate-spin")} aria-hidden />
              {resetting ? t("resetting") : t("resetDemo")}
            </Button>
          </Row>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardContent className="flex flex-col gap-2 px-4 py-5">
          <div className="flex items-center gap-2">
            <Info className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-bold">{t("about")}</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("aboutText")}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("attribution")}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/70">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: "var(--primary)" }} />
              Teal design system (no blue/indigo)
            </span>
            <span>WCAG 2.1 AA targets</span>
            <span dir="ltr">{FONT_SCALE_MAP[fontScale]} base</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
