/**
 * Port of server/src/utils/medicineParser.js — parses free-text bulk
 * medication entries ("Paracetamol 500mg morning and night for 5 days").
 */

const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DEFAULT_REMINDER = {
  remindBefore: "15m",
  remindAfter: "30m",
  status: "pending" as const,
  takenAt: null,
};

export interface ParsedDosageTime {
  time: string;
  remindBefore: string;
  remindAfter: string;
  status: "pending" | "taken" | "missed" | "delayed";
  takenAt: null;
}

export interface ParsedMedicine {
  pillName: string;
  pillDescription: string;
  dosageAmount: string;
  dosageDays: string[];
  dosageTimes: ParsedDosageTime[];
  frequency: string;
  startDate: Date;
  endDate: Date;
}

export interface ParseBulkResult {
  success: ParsedMedicine[];
  failed: { line: string; error: string }[];
}

export function parseBulkText(text: string): ParseBulkResult {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ParsedMedicine[] = [];
  const failed: { line: string; error: string }[] = [];

  lines.forEach((line) => {
    const pillName = extractPillName(line);
    const dosageTimes = extractTimes(line);

    if (!pillName) {
      failed.push({ line, error: "Pill name not found" });
      return;
    }

    if (!dosageTimes || dosageTimes.length === 0) {
      failed.push({ line, error: "No dosage time detected" });
      return;
    }

    const startDate = new Date();
    const endDate = extractEndDate(line, startDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      failed.push({ line, error: "Invalid date detected" });
      return;
    }

    results.push({
      pillName,
      pillDescription: line,
      dosageAmount: extractDosage(line),
      dosageDays: ALL_DAYS,
      dosageTimes,
      frequency: buildFrequency(dosageTimes.length),
      startDate,
      endDate,
    });
  });

  return { success: results, failed };
}

function extractPillName(line: string): string {
  return line
    .replace(/(\d+\s?(mg|ml|mcg|iu|g))/i, "")
    .split(" ")
    .slice(0, 2)
    .join(" ")
    .trim();
}

function extractDosage(line: string): string {
  const match = line.match(/(\d+\s?(mg|ml|mcg))/i);
  return match ? match[0] : "1 dose";
}

function extractTimes(line: string): ParsedDosageTime[] {
  const times: ParsedDosageTime[] = [];
  const lower = line.toLowerCase();

  if (lower.includes("morning")) times.push({ time: "08:00", ...DEFAULT_REMINDER });
  if (lower.includes("afternoon")) times.push({ time: "13:00", ...DEFAULT_REMINDER });
  if (lower.includes("evening")) times.push({ time: "18:00", ...DEFAULT_REMINDER });
  if (lower.includes("night")) times.push({ time: "20:00", ...DEFAULT_REMINDER });

  if (times.length === 0) {
    return [{ time: "09:00", ...DEFAULT_REMINDER }];
  }

  return times;
}

function buildFrequency(timesCount: number): string {
  if (timesCount === 1) return "1 time a day";
  return `${timesCount} times a day`;
}

function extractEndDate(line: string, startDate: Date): Date {
  const lower = line.toLowerCase();

  const dayMatch = lower.match(/for (\d+) day/);
  if (dayMatch) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + Number(dayMatch[1]));
    return d;
  }

  const weekMatch = lower.match(/for (\d+) week/);
  if (weekMatch) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + Number(weekMatch[1]) * 7);
    return d;
  }

  const monthMatch = lower.match(/for (\d+) month/);
  if (monthMatch) {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + Number(monthMatch[1]));
    return d;
  }

  const d = new Date(startDate);
  d.setDate(d.getDate() + 30);
  return d;
}
