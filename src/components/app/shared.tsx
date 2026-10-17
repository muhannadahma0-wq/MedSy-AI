import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/lib/types";
import type { Dict } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";

export const MED_COLORS: Record<
  string,
  { dot: string; soft: string; text: string; border: string }
> = {
  teal: {
    dot: "bg-teal-500",
    soft: "bg-teal-500/10",
    text: "text-teal-700 dark:text-teal-300",
    border: "border-teal-500/30",
  },
  rose: {
    dot: "bg-rose-500",
    soft: "bg-rose-500/10",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-500/30",
  },
  amber: {
    dot: "bg-amber-500",
    soft: "bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-500/30",
  },
  emerald: {
    dot: "bg-emerald-500",
    soft: "bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-500/30",
  },
  violet: {
    dot: "bg-violet-500",
    soft: "bg-violet-500/10",
    text: "text-violet-700 dark:text-violet-300",
    border: "border-violet-500/30",
  },
  sky: {
    dot: "bg-cyan-500",
    soft: "bg-cyan-500/10",
    text: "text-cyan-700 dark:text-cyan-300",
    border: "border-cyan-500/30",
  },
};

export function medColor(color: string) {
  return MED_COLORS[color] ?? MED_COLORS.teal;
}

export function RiskBadge({
  level,
  t,
  className,
}: {
  level: RiskLevel;
  t: (k: keyof Dict) => string;
  className?: string;
}) {
  const styles: Record<RiskLevel, string> = {
    low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    high: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  };
  const labelKey: Record<RiskLevel, keyof Dict> = {
    low: "riskLow",
    medium: "riskMedium",
    high: "riskHigh",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        styles[level],
        className
      )}
    >
      {t(labelKey[level])}
    </span>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <Card className={cn("py-4", className)}>
      <CardContent className="flex flex-col gap-1 px-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="text-2xl font-bold tabular-nums" dir="ltr">
          {value}
        </div>
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-14 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-7" aria-hidden />
      </div>
      <p className="font-semibold">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}

export function StatusPill({
  status,
  label,
}: {
  status: "pending" | "taken" | "missed" | "snoozed" | "skipped";
  label: string;
}) {
  const styles = {
    pending: "bg-muted text-muted-foreground border-transparent",
    taken: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
    missed: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25",
    snoozed: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25",
    skipped: "bg-muted text-muted-foreground border-border",
  } as const;
  return (
    <Badge variant="outline" className={cn("font-medium", styles[status])}>
      {label}
    </Badge>
  );
}
