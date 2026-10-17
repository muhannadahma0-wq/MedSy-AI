"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BotMessageSquare,
  FileText,
  FlaskConical,
  Loader2,
  MessageSquareQuote,
  Send,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useI18n } from "@/lib/store";
import { SAMPLE_REPORT } from "@/lib/sample-report";
import { fmtShortDate } from "@/lib/format";
import { EmptyState } from "./shared";
import { cn } from "@/lib/utils";
import type { AssistantApiResponse } from "@/lib/types";

interface ReportAnalysisDTO {
  summary: string;
  keyFindings: { finding: string; source: string }[];
  warnings: string[];
  readability: { level: "easy" | "medium" | "hard"; note: string };
}

interface ReportListItem {
  id: string;
  title: string;
  createdAt: string;
  hasAnalysis: boolean;
}

interface ReportDetail extends ReportListItem {
  content: string;
  analysis: ReportAnalysisDTO | null;
}

interface QaMessage {
  role: "user" | "assistant";
  content: string;
  grounded?: boolean;
  citations?: { index: number; passage: string }[];
}

function ReadabilityBadge({ level, t }: { level: "easy" | "medium" | "hard"; t: (k: never) => string }) {
  const styles = {
    easy: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    hard: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  } as const;
  const labels = { easy: "readabilityEasy", medium: "readabilityMedium", hard: "readabilityHard" } as const;
  return (
    <Badge variant="outline" className={cn("font-medium", styles[level])}>
      {t(labels[level] as never)}
    </Badge>
  );
}

function ReportDetailDialog({
  report,
  open,
  onOpenChange,
  onDelete,
}: {
  report: ReportDetail | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [qa, setQa] = useState<QaMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const qaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQa([]);
    setQuestion("");
  }, [report?.id]);

  useEffect(() => {
    qaRef.current?.scrollTo({ top: qaRef.current.scrollHeight, behavior: "smooth" });
  }, [qa, asking]);

  const ask = async () => {
    if (!report || !question.trim() || asking) return;
    const q = question.trim();
    setQuestion("");
    setQa((prev) => [...prev, { role: "user", content: q }]);
    setAsking(true);
    try {
      const res = await fetch("/api/reports/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: report.id, question: q, locale }),
      });
      if (!res.ok) throw new Error("api");
      const data = (await res.json()) as AssistantApiResponse;
      setQa((prev) => [...prev, { role: "assistant", content: data.reply, grounded: data.grounded, citations: data.citations }]);
    } catch {
      toast.error(t("error"));
    } finally {
      setAsking(false);
    }
  };

  if (!report) return null;
  const a = report.analysis;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pe-8">
            <FileText className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
            <span className="leading-snug">{report.title}</span>
          </DialogTitle>
          <DialogDescription>{fmtShortDate(locale, report.createdAt)}</DialogDescription>
        </DialogHeader>

        {!a ? (
          <p className="text-sm text-muted-foreground">{t("analyzing")}</p>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Summary */}
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-bold">{t("summary")}</h3>
              <p className="rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">{a.summary}</p>
              {a.readability?.level && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t("readability")}:</span>
                  <ReadabilityBadge level={a.readability.level} t={t as never} />
                </div>
              )}
            </section>

            {/* Key findings with source passages */}
            {a.keyFindings.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-bold">{t("keyFindings")}</h3>
                <ol className="flex flex-col gap-2">
                  {a.keyFindings.map((f, i) => (
                    <li key={i} className="rounded-lg border p-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary" dir="ltr">
                          {i + 1}
                        </span>
                        <p className="text-sm leading-relaxed">{f.finding}</p>
                      </div>
                      {f.source && (
                        <details className="ms-7 mt-1.5">
                          <summary className="w-fit cursor-pointer list-none text-[11px] font-semibold text-primary hover:underline">
                            « {t("sources")} »
                          </summary>
                          <blockquote className="mt-1 rounded border-s-2 border-primary/40 bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                            <bdi>{f.source}</bdi>
                          </blockquote>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Warnings */}
            {a.warnings.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-rose-700 dark:text-rose-300">
                  <TriangleAlert className="size-4" aria-hidden />
                  {t("warnings")}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {a.warnings.map((w, i) => (
                    <li key={i} className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed">
                      <bdi>{w}</bdi>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Grounded Q&A */}
            <section className="flex flex-col gap-2 border-t pt-4">
              <h3 className="flex items-center gap-1.5 text-sm font-bold">
                <MessageSquareQuote className="size-4 text-primary" aria-hidden />
                {t("askAboutReport")}
              </h3>
              <div
                ref={qaRef}
                className="flex max-h-64 min-h-16 flex-col gap-2 overflow-y-auto rounded-lg bg-muted/40 p-3"
                aria-live="polite"
              >
                {qa.length === 0 && !asking && (
                  <p className="py-4 text-center text-xs text-muted-foreground">{t("askPlaceholder")}</p>
                )}
                {qa.map((m, i) => (
                  <div key={i} className={cn("flex flex-col gap-1 max-w-[90%]", m.role === "user" ? "self-end items-end" : "self-start items-start")}>
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
                        m.role === "user" ? "rounded-ee-sm bg-primary text-primary-foreground" : "rounded-es-sm border bg-background"
                      )}
                    >
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    </div>
                    {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                      <details className="w-full max-w-sm rounded-lg border bg-muted/40 px-2.5 py-1.5">
                        <summary className="cursor-pointer list-none text-[11px] font-semibold text-primary">
                          {t("sources")} ({m.citations.length})
                        </summary>
                        <ol className="mt-1 flex list-decimal flex-col gap-1.5 ps-4 text-[11px] leading-relaxed text-muted-foreground">
                          {m.citations.map((c) => (
                            <li key={c.index} className="rounded border bg-background px-2 py-1.5">
                              <bdi>{c.passage}</bdi>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </div>
                ))}
                {asking && (
                  <div className="flex items-center gap-2 self-start text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {t("thinking")}
                  </div>
                )}
              </div>
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask();
                }}
              >
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={t("askPlaceholder")}
                  className="h-10 flex-1"
                  dir="auto"
                />
                <Button type="submit" size="icon" className="size-10 shrink-0" disabled={asking || !question.trim()} aria-label={t("send")}>
                  <Send className={cn("size-4", locale === "ar" && "-scale-x-100")} aria-hidden />
                </Button>
              </form>
            </section>

            {/* Raw report text */}
            <details className="border-t pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
                {t("viewReport")}
              </summary>
              <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">
                {report.content}
              </p>
            </details>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 self-end text-destructive hover:text-destructive"
              onClick={() => onDelete(report.id)}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {t("deleteReport")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ReportsView() {
  const { t, locale } = useI18n();
  const [reports, setReports] = useState<ReportListItem[] | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch("/api/reports");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { reports: ReportListItem[] };
      setReports(data.reports);
    } catch {
      setReports([]);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const openReport = async (id: string) => {
    try {
      const res = await fetch(`/api/reports?id=${id}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as ReportDetail;
      setDetail(data);
      setDetailOpen(true);
    } catch {
      toast.error(t("error"));
    }
  };

  const analyze = async () => {
    if (analyzing) return;
    if (!title.trim() || content.trim().length < 60) {
      toast.error(t("error"));
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), locale }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "error");
      }
      toast.success(t("reportAnalyzed"));
      setTitle("");
      setContent("");
      await loadReports();
    } catch (e) {
      toast.error(e instanceof Error && e.message !== "error" ? e.message : t("error"));
    } finally {
      setAnalyzing(false);
    }
  };

  const deleteReport = async (id: string) => {
    try {
      await fetch(`/api/reports?id=${id}`, { method: "DELETE" });
      setDetailOpen(false);
      toast.success(t("deleteReport"));
      await loadReports();
    } catch {
      toast.error(t("error"));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-2xl font-bold tracking-tight">{t("reportsTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("reportsSubtitle")}</p>
      </div>

      {/* Upload form */}
      <Card>
        <CardContent className="flex flex-col gap-4 px-4 py-5">
          <div className="flex items-center gap-2">
            <Upload className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-bold">{t("uploadTitle")}</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("uploadHint")}</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="report-title">{t("reportTitleLabel")}</Label>
            <Input
              id="report-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("reportTitlePlaceholder")}
              dir="auto"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="report-content">{t("reportContentLabel")}</Label>
            <Textarea
              id="report-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("reportContentPlaceholder")}
              rows={6}
              dir="auto"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={analyze} disabled={analyzing || !title.trim() || content.trim().length < 60} className="gap-1.5">
              {analyzing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FlaskConical className="size-4" aria-hidden />}
              {analyzing ? t("analyzing") : t("analyze")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => {
                setTitle(SAMPLE_REPORT.title);
                setContent(SAMPLE_REPORT.content);
              }}
            >
              {t("trySample")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reports list */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-bold">{t("yourReports")}</h3>
        {reports === null ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : reports.length === 0 ? (
          <EmptyState icon={FileText} title={t("noReports")} hint={t("noReportsHint")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {reports.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openReport(r.id)}
                className="group flex flex-col gap-1.5 rounded-xl border bg-card p-4 text-start shadow-sm transition-all hover:border-primary/40 hover:shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold leading-tight">
                    <FileText className="size-4 shrink-0 text-primary" aria-hidden />
                    <bdi className="line-clamp-1">{r.title}</bdi>
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    <BotMessageSquare className="me-1 size-3" aria-hidden />
                    AI
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{fmtShortDate(locale, r.createdAt)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <ReportDetailDialog report={detail} open={detailOpen} onOpenChange={setDetailOpen} onDelete={deleteReport} />
    </div>
  );
}
