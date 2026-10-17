"use client";

import { useMemo } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Flame,
  TrendingUp,
  TrendingDown,
  Trophy,
  LineChart as LineChartIcon,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useData, useI18n } from "@/lib/store";
import { fmtShortDate } from "@/lib/format";
import { StatCard } from "./shared";
import { cn } from "@/lib/utils";

function heatColor(rate: number): string {
  if (rate >= 0.95) return "bg-emerald-600";
  if (rate >= 0.8) return "bg-emerald-500";
  if (rate >= 0.6) return "bg-amber-400";
  if (rate > 0) return "bg-rose-400";
  return "bg-muted";
}

export function InsightsView() {
  const { t, locale } = useI18n();
  const { insights, loading } = useData();

  // arrange heatmap into 8 columns (weeks) × 7 rows
  const heatColumns = useMemo(() => {
    if (!insights) return [];
    const cols: { date: string; rate: number; total: number }[][] = [];
    for (let i = 0; i < insights.heatmap.length; i += 7) {
      cols.push(insights.heatmap.slice(i, i + 7));
    }
    return cols;
  }, [insights]);

  const weeklyData = useMemo(
    () =>
      (insights?.weekly ?? []).map((w) => ({
        name: t(`weekdayShort_${w.weekday}` as Parameters<typeof t>[0]),
        taken: w.taken,
        missed: w.missed,
      })),
    [insights, t]
  );

  const forecastData = useMemo(
    () =>
      (insights?.riskForecast ?? []).map((r) => ({
        name: fmtShortDate(locale, `${r.date}T12:00:00`),
        risk: Math.round(r.risk * 100),
      })),
    [insights, locale]
  );

  const hourData = useMemo(
    () =>
      (insights?.byHourBucket ?? []).map((b) => ({
        name: t(b.bucket),
        rate: b.total > 0 ? Math.round((b.taken / b.total) * 100) : 0,
      })),
    [insights, t]
  );

  if (!insights || loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!insights.hasData) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-2xl font-bold tracking-tight">{t("insightsTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("insightsSubtitle")}</p>
        </div>
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("noData")}
        </p>
      </div>
    );
  }

  const weekDelta = insights.week.taken - insights.week.prevTaken;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-2xl font-bold tracking-tight">{t("insightsTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("insightsSubtitle")}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={Activity}
          label={t("overallAdherence")}
          value={`${Math.round(insights.overallAdherence * 100)}%`}
        />
        <StatCard icon={Flame} label={t("currentStreak")} value={String(insights.streak)} sub={t("dayStreak")} />
        <StatCard
          icon={Trophy}
          label={t("bestDay")}
          value={
            insights.bestDay
              ? t(`weekdayShort_${insights.bestDay.weekday}` as Parameters<typeof t>[0])
              : t("notAvailable")
          }
          sub={
            insights.bestDay
              ? `${Math.round(insights.bestDay.rate * 100)}%`
              : undefined
          }
        />
        <StatCard icon={CalendarDays} label={t("totalDoses")} value={String(insights.totalDoses)} />
      </div>

      {/* Week summary */}
      <Card>
        <CardContent className="flex flex-col gap-3 px-4 py-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">{t("weeklySummary")}</h3>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                weekDelta >= 0
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
              )}
            >
              {weekDelta >= 0 ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
              <span dir="ltr">
                {weekDelta >= 0 ? "+" : ""}
                {weekDelta} {t("weekOverWeek")}
              </span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400" dir="ltr">
                {insights.week.taken}
              </p>
              <p className="text-xs text-muted-foreground">{t("weeklyTaken")}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400" dir="ltr">
                {insights.week.missed}
              </p>
              <p className="text-xs text-muted-foreground">{t("weeklyMissed")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Heatmap */}
      <Card>
        <CardContent className="flex flex-col gap-3 px-4 py-5">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-bold">
              <CalendarDays className="size-4 text-primary" aria-hidden />
              {t("last8Weeks")}
            </h3>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="size-2.5 rounded-sm bg-muted" />
              <span className="size-2.5 rounded-sm bg-rose-400" />
              <span className="size-2.5 rounded-sm bg-amber-400" />
              <span className="size-2.5 rounded-sm bg-emerald-500" />
              <span className="size-2.5 rounded-sm bg-emerald-600" />
            </div>
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="flex gap-1" dir="ltr">
              {heatColumns.map((col, ci) => (
                <div key={ci} className="flex flex-col gap-1">
                  {col.map((cell) => (
                    <span
                      key={cell.date}
                      title={`${cell.date} — ${cell.total > 0 ? Math.round(cell.rate * 100) + "%" : "—"}`}
                      className={cn(
                        "size-4 rounded-sm transition-colors",
                        heatColor(cell.rate),
                        cell.total === 0 && "opacity-40"
                      )}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Taken vs missed by weekday */}
      <Card>
        <CardContent className="flex flex-col gap-3 px-4 py-5">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <BarChart3 className="size-4 text-primary" aria-hidden />
            {t("takenVsMissed")}
          </h3>
          <div className="h-56" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} />
                <YAxis tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="taken" name={t("taken")} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="missed" name={t("missed")} fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Risk forecast */}
        <Card>
          <CardContent className="flex flex-col gap-3 px-4 py-5">
            <div className="flex flex-col gap-0.5">
              <h3 className="flex items-center gap-1.5 text-sm font-bold">
                <TrendingUp className="size-4 text-primary" aria-hidden />
                {t("riskForecast")}
              </h3>
              <p className="text-[11px] text-muted-foreground">{t("riskForecastHint")}</p>
            </div>
            <div className="h-44" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecastData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.6} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.6} unit="%" />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: "var(--popover)",
                      fontSize: 12,
                    }}
                    formatter={(v) => [`${v}%`, t("riskLevel")]}
                  />
                  <Line
                    type="monotone"
                    dataKey="risk"
                    stroke="var(--chart-3)"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Adherence by hour bucket */}
        <Card>
          <CardContent className="flex flex-col gap-3 px-4 py-5">
            <h3 className="flex items-center gap-1.5 text-sm font-bold">
              <LineChartIcon className="size-4 text-primary" aria-hidden />
              {t("adherenceByHour")}
            </h3>
            <div className="flex flex-1 flex-col justify-center gap-2.5">
              {hourData.map((b) => (
                <div key={b.name} className="flex items-center gap-2.5">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">{b.name}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted" dir="ltr">
                    <div
                      className="flex h-full items-center justify-end rounded-md bg-primary/80 pe-1.5 text-[10px] font-bold text-primary-foreground transition-all duration-500"
                      style={{ width: `${Math.max(b.rate, 8)}%` }}
                    >
                      {b.rate}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
