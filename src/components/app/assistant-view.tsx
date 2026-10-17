"use client";

import { useEffect, useRef, useState } from "react";
import {
  BotMessageSquare,
  Dumbbell,
  Eraser,
  Phone,
  Pill,
  Send,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  User,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useI18n, useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { AssistantApiResponse, ChatCitation } from "@/lib/types";

type Agent = "medication-info" | "adherence-coach" | "triage";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  emergency?: boolean;
  grounded?: boolean;
  citations?: ChatCitation[];
}

const AGENTS: { id: Agent; labelKey: "agentMedInfo" | "agentCoach" | "agentTriage"; descKey: "agentMedInfoDesc" | "agentCoachDesc" | "agentTriageDesc"; icon: typeof BotMessageSquare }[] = [
  { id: "medication-info", labelKey: "agentMedInfo", descKey: "agentMedInfoDesc", icon: Pill },
  { id: "adherence-coach", labelKey: "agentCoach", descKey: "agentCoachDesc", icon: Dumbbell },
  { id: "triage", labelKey: "agentTriage", descKey: "agentTriageDesc", icon: Stethoscope },
];

export function AssistantView() {
  const { t, locale } = useI18n();
  const seed = useSettings((s) => s.assistantSeed);
  const setSeed = useSettings((s) => s.setAssistantSeed);
  const [agent, setAgent] = useState<Agent>("medication-info");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-filled question coming from the Medications page ("Explain with assistant")
  useEffect(() => {
    if (seed) {
      setInput(seed);
      setSeed(null);
      inputRef.current?.focus();
    }
  }, [seed, setSeed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          agent,
          locale,
        }),
      });
      if (!res.ok) throw new Error("api");
      const data = (await res.json()) as AssistantApiResponse;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          emergency: data.emergency,
          grounded: data.grounded,
          citations: data.citations,
        },
      ]);
    } catch {
      toast.error(t("error"));
      setMessages((prev) => [...prev, { role: "assistant", content: t("error"), grounded: false, citations: [] }]);
    } finally {
      setBusy(false);
    }
  };

  const activeAgent = AGENTS.find((a) => a.id === agent)!;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-2xl font-bold tracking-tight">{t("assistantTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("assistantSubtitle")}</p>
      </div>

      {/* Safety banner (persistent) */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5" role="note">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <p className="text-xs font-medium leading-relaxed">{t("safetyBanner")}</p>
      </div>

      {/* Emergency button */}
      <Button
        variant="destructive"
        className="h-12 w-full gap-2 text-sm font-bold"
        onClick={() => setEmergencyOpen(true)}
      >
        <Phone className="size-4" aria-hidden />
        {t("emergencyButton")}
      </Button>

      {/* Agent chips */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("assistantTitle")}>
          {AGENTS.map((a) => {
            const on = agent === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setAgent(a.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent"
                )}
              >
                <a.icon className="size-3.5" aria-hidden />
                {t(a.labelKey)}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t(activeAgent.descKey)}</p>
      </div>

      {/* Chat card */}
      <Card>
        <CardContent className="flex flex-col gap-3 px-4 py-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <BotMessageSquare className="size-4 text-primary" aria-hidden />
              {t(activeAgent.labelKey)}
            </p>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground"
                onClick={() => setMessages([])}
              >
                <Eraser className="size-3.5" aria-hidden />
                {t("clearChat")}
              </Button>
            )}
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex max-h-[52vh] min-h-48 flex-col gap-3 overflow-y-auto rounded-lg bg-muted/40 p-3"
            aria-live="polite"
          >
            {messages.length === 0 && !busy && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="size-5" aria-hidden />
                </span>
                <div className="flex max-w-sm flex-col gap-2">
                  {[t("quickAsk1"), t("quickAsk2"), t("quickAsk3")].map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => send(q)}
                      className="rounded-full border bg-background px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "flex max-w-[88%] flex-col gap-1",
                  m.role === "user" ? "self-end items-end" : "self-start items-start"
                )}
              >
                <div
                  className={cn(
                    "flex flex-col gap-1.5 rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                    m.role === "user"
                      ? "rounded-ee-sm bg-primary text-primary-foreground"
                      : "rounded-es-sm border bg-background",
                    m.emergency && "border-destructive/50 bg-destructive/10 text-destructive"
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase opacity-70">
                    {m.role === "user" ? <User className="size-3" aria-hidden /> : <BotMessageSquare className="size-3" aria-hidden />}
                    {m.role === "user" ? t("demoUser") : t("appName")}
                  </span>
                  <span className="whitespace-pre-wrap">{m.content}</span>
                </div>

                {m.role === "assistant" && !m.emergency && (
                  <div className="flex flex-col gap-1 px-1">
                    {m.citations && m.citations.length > 0 ? (
                      <details className="group w-full max-w-md rounded-lg border bg-muted/40 px-2.5 py-1.5">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold text-primary">
                          <Sparkles className="size-3" aria-hidden />
                          {t("sources")} ({m.citations.length})
                        </summary>
                        <p className="mt-1.5 text-[10px] font-normal text-muted-foreground">{t("sourcesHint")}</p>
                        <ol className="mt-1 flex list-decimal flex-col gap-1.5 ps-4 text-[11px] leading-relaxed text-muted-foreground">
                          {m.citations.map((c) => (
                            <li key={c.index} className="rounded border bg-background px-2 py-1.5">
                              <bdi>{c.passage}</bdi>
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/70">{t("noSources")}</span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 self-start rounded-2xl rounded-es-sm border bg-background px-3.5 py-2.5 text-sm text-muted-foreground shadow-sm">
                <span className="size-2 animate-pulse rounded-full bg-primary" />
                {t("thinking")}
              </div>
            )}
          </div>

          {/* Input */}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("chatPlaceholder")}
              className="h-11 flex-1"
              maxLength={500}
              dir="auto"
            />
            <Button type="submit" size="icon" className="size-11 shrink-0" disabled={busy || !input.trim()} aria-label={t("send")}>
              <Send className={cn("size-4", locale === "ar" && "-scale-x-100")} aria-hidden />
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Emergency dialog */}
      <Dialog open={emergencyOpen} onOpenChange={setEmergencyOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Phone className="size-5" aria-hidden />
              {t("emergencyTitle")}
            </DialogTitle>
            <DialogDescription>{t("emergencyBanner")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
              <span className="text-sm font-semibold">Palestine — Red Crescent</span>
              <bdi className="text-2xl font-bold tabular-nums text-destructive" dir="ltr">101</bdi>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border px-3 py-2">
                <p className="text-xs text-muted-foreground">US / Canada</p>
                <bdi className="font-bold tabular-nums" dir="ltr">911</bdi>
              </div>
              <div className="rounded-lg border px-3 py-2">
                <p className="text-xs text-muted-foreground">EU</p>
                <bdi className="font-bold tabular-nums" dir="ltr">112</bdi>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
