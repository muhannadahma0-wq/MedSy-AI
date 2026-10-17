"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BotMessageSquare,
  Check,
  Clock,
  Pill,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useData, useI18n, useSettings } from "@/lib/store";
import { fmtTime, medName } from "@/lib/format";
import { DRUG_CATALOG, findInteractions } from "@/lib/medical";
import { EmptyState, MED_COLORS, medColor } from "./shared";
import { cn } from "@/lib/utils";
import type { MedicationDTO } from "@/lib/types";

const COLOR_KEYS = ["teal", "rose", "amber", "emerald", "violet", "sky"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function daysLabel(days: number[], t: ReturnType<typeof useI18n>["t"]): string {
  const sorted = [...days].sort();
  if (sorted.length === 7) return t("everyDay");
  if (sorted.join() === "1,2,3,4,5") return t("weekdays");
  if (sorted.join() === "5,6") return t("weekends");
  return sorted.map((d) => t(`weekdayShort_${d}` as Parameters<typeof t>[0])).join(" · ");
}

function MedCard({ med, onDelete }: { med: MedicationDTO; onDelete: (m: MedicationDTO) => void }) {
  const { t, locale } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);
  const c = medColor(med.color);
  const name = medName(locale, med.name, med.nameAr);

  const instruction = useMemo(() => {
    if (locale === "ar" && med.instructionsAr) {
      return showOriginal ? med.instructions : med.instructionsAr;
    }
    if (med.instructions) {
      return showOriginal && med.instructionsAr ? med.instructionsAr : med.instructions;
    }
    return null;
  }, [locale, med.instructions, med.instructionsAr, showOriginal]);

  const canToggle =
    locale === "ar" ? Boolean(med.instructions && med.instructionsAr) : Boolean(med.instructionsAr);

  return (
    <Card className={cn("border-s", c.border)}>
      <CardContent className="flex flex-col gap-3 px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn("mt-1 size-3 shrink-0 rounded-full", c.dot)} aria-hidden />
            <div className="flex min-w-0 flex-col">
              <bdi className="truncate font-semibold leading-tight">{name.primary}</bdi>
              {name.secondary && (
                <bdi className="truncate text-xs text-muted-foreground">{name.secondary}</bdi>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {med.dosage && (
                  <bdi className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium" dir="ltr">
                    {med.dosage}
                  </bdi>
                )}
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                  {t(med.form as "formTablet")}
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(med)}
            aria-label={t("delete")}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Clock className="size-3.5 text-muted-foreground" aria-hidden />
          {med.times.map((time) => (
            <span
              key={time}
              className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", c.soft, c.text)}
              dir="ltr"
            >
              {fmtTime(locale, `2000-01-01T${time}:00`)}
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">· {daysLabel(med.days, t)}</span>
        </div>

        {instruction && (
          <div className="flex flex-col gap-1">
            <p className="text-xs leading-relaxed text-muted-foreground">{instruction}</p>
            {canToggle && (
              <button
                type="button"
                onClick={() => setShowOriginal((v) => !v)}
                className="w-fit text-[11px] font-medium text-primary underline-offset-2 hover:underline"
              >
                {showOriginal ? t("showTranslated") : t("showOriginal")}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddWizard({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: MedicationDTO[];
}) {
  const { t, locale } = useI18n();
  const refreshAll = useData((s) => s.refreshAll);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [dosage, setDosage] = useState("");
  const [form, setForm] = useState("tablet");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [times, setTimes] = useState<string[]>(["08:00"]);
  const [instructions, setInstructions] = useState("");
  const [instructionsAr, setInstructionsAr] = useState("");
  const [color, setColor] = useState("teal");
  const [showSuggest, setShowSuggest] = useState(false);

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    const en = DRUG_CATALOG.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 5);
    const ar = DRUG_CATALOG.filter((d) => d.nameAr.includes(name.trim())).slice(0, 5);
    const seen = new Set<string>();
    return [...en, ...ar].filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)));
  }, [name]);

  const liveWarning = useMemo(() => {
    if (!name.trim()) return [];
    return findInteractions([name, ...existing.map((m) => m.name)]);
  }, [name, existing]);

  const reset = () => {
    setStep(1);
    setName("");
    setNameAr("");
    setDosage("");
    setForm("tablet");
    setDays(ALL_DAYS);
    setTimes(["08:00"]);
    setInstructions("");
    setInstructionsAr("");
    setColor("teal");
    setShowSuggest(false);
  };

  const applySuggestion = (idx: number) => {
    const d = suggestions[idx];
    setName(d.name);
    setNameAr(d.nameAr);
    if (d.defaultDosage) setDosage(d.defaultDosage);
    setForm(d.forms[0] ?? "tablet");
    setShowSuggest(false);
  };

  const canNext = step === 1 ? name.trim().length >= 2 : step === 2 ? days.length > 0 && times.length > 0 : true;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/medications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          nameAr: nameAr.trim() || null,
          dosage: dosage.trim() || null,
          form,
          times,
          days,
          instructions: instructions.trim() || null,
          instructionsAr: instructionsAr.trim() || null,
          color,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "error");
      }
      toast.success(t("created"));
      onOpenChange(false);
      reset();
      await refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    } finally {
      setSaving(false);
    }
  };

  const stepIndicator = (n: number) => (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all",
            i === n ? "w-6 bg-primary" : i < n ? "w-3 bg-primary/50" : "w-3 bg-muted"
          )}
        />
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            {t("addMedTitle")}
            {stepIndicator(step)}
          </DialogTitle>
          <DialogDescription>{t("stepOf", { n: step, total: 3 })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {step === 1 && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="med-name">{t("medNameLabel")}</Label>
                <div className="relative">
                  <Input
                    id="med-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setShowSuggest(true);
                    }}
                    placeholder={t("medNamePlaceholder")}
                    autoComplete="off"
                  />
                  {showSuggest && suggestions.length > 0 && (
                    <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded-lg border bg-popover shadow-lg">
                      {suggestions.map((d, i) => (
                        <button
                          key={d.name}
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-accent"
                          onClick={() => applySuggestion(i)}
                        >
                          <span className="flex flex-col">
                            <bdi className="font-medium">{d.name}</bdi>
                            <bdi className="text-xs text-muted-foreground">{d.nameAr}</bdi>
                          </span>
                          <Plus className="size-4 text-muted-foreground" aria-hidden />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="med-dosage">{t("medDosageLabel")}</Label>
                  <Input
                    id="med-dosage"
                    value={dosage}
                    onChange={(e) => setDosage(e.target.value)}
                    placeholder={t("medDosagePlaceholder")}
                    dir="ltr"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("medFormLabel")}</Label>
                  <Select value={form} onValueChange={setForm}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["tablet", "capsule", "syrup", "injection", "drops", "inhaler"].map((f) => (
                        <SelectItem key={f} value={f}>
                          {t(f as "formTablet")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="med-name-ar" className="text-muted-foreground">
                  {t("medNameLabel")} — العربية ({t("optional")})
                </Label>
                <Input
                  id="med-name-ar"
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  placeholder="مثال: ميتفورمين"
                  dir="rtl"
                />
              </div>
              {liveWarning.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="size-4" aria-hidden />
                    {t("interactionWarningLive")}
                  </p>
                  {liveWarning.map((w, i) => (
                    <p key={i} className="text-xs leading-relaxed text-rose-700/90 dark:text-rose-200/90">
                      <bdi>{w.drugA}</bdi> {t("interactionWith")} <bdi>{w.drugB}</bdi> —{" "}
                      {locale === "ar" ? w.descriptionAr : w.descriptionEn}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t("pickDays")}</Label>
                <div className="grid grid-cols-7 gap-1.5">
                  {ALL_DAYS.map((d) => {
                    const on = days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setDays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
                        className={cn(
                          "flex h-11 items-center justify-center rounded-lg border text-xs font-semibold transition-colors",
                          on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
                        )}
                      >
                        {t(`weekdayShort_${d}` as Parameters<typeof t>[0])}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("pickTimes")}</Label>
                <div className="flex flex-col gap-2">
                  {times.map((time, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={time}
                        onChange={(e) =>
                          setTimes((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                        }
                        className="flex-1"
                        dir="ltr"
                      />
                      {times.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9 text-muted-foreground"
                          onClick={() => setTimes((prev) => prev.filter((_, j) => j !== i))}
                          aria-label={t("delete")}
                        >
                          <X className="size-4" aria-hidden />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => setTimes((prev) => [...prev, "20:00"])}
                >
                  <Plus className="size-4" aria-hidden />
                  {t("addTime")}
                </Button>
                {times.length === 0 && <p className="text-xs text-destructive">{t("timeHint")}</p>}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="med-instructions-ar">
                  {t("instructionsLabel")} — العربية ({t("optional")})
                </Label>
                <Textarea
                  id="med-instructions-ar"
                  value={instructionsAr}
                  onChange={(e) => setInstructionsAr(e.target.value)}
                  placeholder={t("instructionsPlaceholder")}
                  rows={3}
                  dir="rtl"
                />
                <Label htmlFor="med-instructions" className="text-muted-foreground">
                  {t("instructionsLabel")} — English ({t("optional")})
                </Label>
                <Textarea
                  id="med-instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Take with food…"
                  rows={3}
                  dir="ltr"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("colorLabel")}</Label>
                <div className="flex gap-2">
                  {COLOR_KEYS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      aria-pressed={color === c}
                      onClick={() => setColor(c)}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-full transition-transform",
                        MED_COLORS[c].dot,
                        color === c ? "ring-2 ring-ring ring-offset-2 ring-offset-background scale-110" : "opacity-70 hover:opacity-100"
                      )}
                    >
                      {color === c && <Check className="size-4 text-white" aria-hidden />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} className="gap-1.5">
              {locale === "ar" ? <ArrowRight className="size-4" aria-hidden /> : <ArrowLeft className="size-4" aria-hidden />}
              {t("back")}
            </Button>
          )}
          {step < 3 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="gap-1.5">
              {t("next")}
              {locale === "ar" ? <ArrowLeft className="size-4" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
            </Button>
          ) : (
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Check className="size-4" aria-hidden />}
              {t("save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MedicationsView() {
  const { t, locale } = useI18n();
  const setTab = useSettings((s) => s.setTab);
  const { medications, interactions, loading, deleteMedication } = useData();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MedicationDTO | null>(null);

  const askAssistant = (a: string, b: string) => {
    useSettings.setState({
      assistantSeed:
        locale === "ar"
          ? `اشرح لي بلغة بسيطة التفاعل الدوائي بين ${a} و${b}، وماذا يجب أن أفعل؟`
          : `Explain in simple language the drug interaction between ${a} and ${b} and what I should do.`,
    });
    setTab("assistant");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMedication(deleteTarget.id);
      toast.success(t("deleted"));
    } catch {
      toast.error(t("error"));
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-2xl font-bold tracking-tight">{t("medicationsTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {medications.length} {t("medicationsCount")}
          </p>
        </div>
        <Button onClick={() => setWizardOpen(true)} className="gap-1.5">
          <Plus className="size-4" aria-hidden />
          {t("addMedication")}
        </Button>
      </div>

      {loading && medications.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : medications.length === 0 ? (
        <EmptyState
          icon={Pill}
          title={t("medicationsEmpty")}
          hint={t("medicationsEmptyHint")}
          action={
            <Button className="mt-2" onClick={() => setWizardOpen(true)}>
              {t("addMedication")}
            </Button>
          }
        />
      ) : (
        <>
          {interactions.length > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-rose-600 dark:text-rose-400" aria-hidden />
                <p className="font-semibold text-rose-700 dark:text-rose-300">{t("interactionsFound")}</p>
              </div>
              <p className="text-xs text-muted-foreground">{t("interactionsHint")}</p>
              <div className="flex flex-col gap-3">
                {interactions.map((w, i) => (
                  <div key={i} className="rounded-lg border border-rose-500/30 bg-background/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <bdi className="font-semibold">{w.drugA}</bdi>
                      <span className="text-muted-foreground">+</span>
                      <bdi className="font-semibold">{w.drugB}</bdi>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-bold",
                          w.severity === "major" && "bg-rose-500/20 text-rose-700 dark:text-rose-300",
                          w.severity === "moderate" && "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                          w.severity === "minor" && "bg-muted text-muted-foreground"
                        )}
                      >
                        {t(`severity${w.severity[0].toUpperCase()}${w.severity.slice(1)}` as Parameters<typeof t>[0])}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {locale === "ar" ? w.descriptionAr : w.descriptionEn}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-8 gap-1.5 text-xs"
                      onClick={() => askAssistant(w.drugA, w.drugB)}
                    >
                      <BotMessageSquare className="size-3.5" aria-hidden />
                      {t("explainWithAssistant")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {medications.map((med) => (
              <MedCard key={med.id} med={med} onDelete={setDeleteTarget} />
            ))}
          </div>
        </>
      )}

      <AddWizard open={wizardOpen} onOpenChange={setWizardOpen} existing={medications} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteMedConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              <bdi className="font-semibold">{deleteTarget?.name}</bdi>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
