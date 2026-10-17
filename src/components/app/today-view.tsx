"use client";

import { useMemo } from "react";
import {
  AlarmClockCheck,
  BellRing,
  CalendarCheck2,
  Check,
  Flame,
  Info,
  Pill,
  SkipForward,
  Activity,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useData, useI18n, useSettings } from "@/lib/store";
import { fmtTime, greetingKey, medName } from "@/lib/format";
import { EmptyState, RiskBadge, StatusPill, medColor } from "./shared";
import { cn } from "@/lib/utils";

function AdherenceRing({ rate, taken, total }: { rate: number; taken: number; total: number }) {
  const { t } = useI18n();
  const R = 52;
  const C = 2 * Math.PI * R;
  const filled = total === 0 ? 0 : rate;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="size-28 shrink-0 -rotate-90" role="img" aria-label={t("adherenceToday")}>
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="12" className="stroke-muted" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - filled)}
          className="stroke-primary transition-all duration-700 ease-out"
        />
      </svg>
      <div className="flex flex-col gap-1">
        <span className="text-3xl font-bold tabular-nums leading-none" dir="ltr">
          {Math.round(filled * 100)}%
        </span>
        <span className="text-sm text-muted-foreground">
          {t("dosesTaken")}: {taken} {t("of")} {total}
        </span>
      </div>
    </div>
  );
}

export function TodayView() {
  const { t, locale } = useI18n();
  const setTab = useSettings((s) => s.setTab);
  const { today, loading, updateDoseStatus } = useData();

  const sortedDoses = useMemo(
    () => (today ? [...today.doses].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)) : []),
    [today]
  );
  const upcomingRisk = useMemo(
    () =>
      sortedDoses
        .filter((d) => d.status === "pending" || d.status === "snoozed")
        .some((d) => d.riskLevel !== "low"),
    [sortedDoses]
  );

  const handle = async (doseId: string, status: "taken" | "snoozed" | "skipped") => {
    try {
      await updateDoseStatus(doseId, status);
      if (status === "taken") toast.success(t("markTaken"));
      if (status === "snoozed") toast.info(t("snoozeHint"));
    } catch {
      toast.error(t("error"));
    }
  };

  if (loading && !today) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-2xl font-bold tracking-tight">
          {t(greetingKey() as "todayGreetingMorning")}, {t("demoUser")} 👋
        </h2>
        <p className="text-sm text-muted-foreground">{t("todayTitle")}</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-3 px-5 py-5">
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarCheck2 className="size-4" aria-hidden />
              {t("adherenceToday")}
            </p>
            {today && today.total > 0 ? (
              <AdherenceRing rate={today.adherenceRate} taken={today.taken} total={today.total} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("todayEmpty")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 px-5 py-5">
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Flame className="size-4 text-orange-500" aria-hidden />
              {t("currentStreak")}
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold tabular-nums leading-none" dir="ltr">
                {today?.streak ?? 0}
              </span>
              <span className="text-sm text-muted-foreground">{t("dayStreak")}</span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 flex-1 rounded-full",
                    i < Math.min(today?.streak ?? 0, 7) ? "bg-orange-400" : "bg-muted"
                  )}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 px-5 py-5">
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity className="size-4" aria-hidden />
              {t("riskLevel")}
            </p>
            <div className="flex flex-col gap-2">
              <RiskBadge level={today?.overallRisk ?? "low"} t={t} className="w-fit px-3 py-1 text-sm" />
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("riskHint")}
              </p>
              {today?.nextDose && (
                <p className="text-xs">
                  <span className="text-muted-foreground">{t("nextDose")}: </span>
                  <bdi className="font-semibold">
                    {medName(locale, today.nextDose.medicationName, today.nextDose.medicationNameAr).primary}
                  </bdi>{" "}
                  — <span dir="ltr">{fmtTime(locale, today.nextDose.scheduledAt)}</span>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Smart reminder callout (WP2 preview) */}
      {upcomingRisk && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <BellRing className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold">{t("smartReminder")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("smartReminderText")}</p>
          </div>
        </div>
      )}

      {/* Dose timeline */}
      {sortedDoses.length === 0 ? (
        <EmptyState
          icon={Pill}
          title={t("todayEmpty")}
          hint={t("todayEmptyHint")}
          action={
            <Button className="mt-2" onClick={() => setTab("medications")}>
              {t("addMedication")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3" role="list" aria-label={t("todayTitle")}>
          {sortedDoses.map((dose) => {
            const c = medColor(dose.color);
            const name = medName(locale, dose.medicationName, dose.medicationNameAr);
            const open = dose.status === "pending" || dose.status === "snoozed";
            const isNow =
              open &&
              Math.abs(new Date(dose.scheduledAt).getTime() - now.getTime()) < 45 * 60 * 1000;
            return (
              <Card
                key={dose.id}
                role="listitem"
                className={cn(
                  "transition-shadow",
                  isNow && "ring-2 ring-primary/40 shadow-md"
                )}
              >
                <CardContent className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex size-11 shrink-0 flex-col items-center justify-center rounded-xl text-[10px] font-bold leading-none",
                        c.soft,
                        c.text
                      )}
                    >
                      <AlarmClockCheck className="size-4" aria-hidden />
                      <span className="mt-0.5 tabular-nums">{fmtTime(locale, dose.scheduledAt)}</span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <bdi className="truncate font-semibold">{name.primary}</bdi>
                        {dose.dosage && (
                          <bdi className="text-xs text-muted-foreground" dir="ltr">
                            {dose.dosage}
                          </bdi>
                        )}
                        <StatusPill status={dose.status} label={t(dose.status)} />
                        {open && dose.riskLevel !== "low" && <RiskBadge level={dose.riskLevel} t={t} />}
                      </div>
                      {name.secondary && (
                        <bdi className="truncate text-xs text-muted-foreground">{name.secondary}</bdi>
                      )}
                    </div>
                  </div>

                  {open ? (
                    <div className="grid shrink-0 grid-cols-3 gap-2 sm:flex" dir={locale === "ar" ? "rtl" : "ltr"}>
                      <Button
                        size="sm"
                        onClick={() => handle(dose.id, "taken")}
                        className="h-11 gap-1.5 bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <Check className="size-4" aria-hidden />
                        {t("markTaken")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handle(dose.id, "snoozed")}
                        className="h-11 gap-1.5 px-3 text-xs"
                        title={t("snoozeHint")}
                      >
                        <AlarmClockCheck className="size-4" aria-hidden />
                        {t("snooze")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handle(dose.id, "skipped")}
                        className="h-11 gap-1.5 px-3 text-xs text-muted-foreground"
                      >
                        <SkipForward className="size-4" aria-hidden />
                        {t("skip")}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {dose.status === "taken" ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                          <Check className="size-4" aria-hidden />
                          {t("taken")}
                        </span>
                      ) : (
                        t(dose.status)
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {sortedDoses.length > 0 &&
            sortedDoses.every((d) => d.status !== "pending" && d.status !== "snoozed") && (
              <p className="py-2 text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
                🎉 {t("allDone")}
              </p>
            )}
        </div>
      )}
    </div>
  );
}
