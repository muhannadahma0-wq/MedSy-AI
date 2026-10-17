export type DoseStatus = "pending" | "taken" | "missed" | "snoozed" | "skipped";
export type RiskLevel = "low" | "medium" | "high";
export type MedForm = "tablet" | "capsule" | "syrup" | "injection" | "drops" | "inhaler";

export interface MedicationDTO {
  id: string;
  name: string;
  nameAr: string | null;
  dosage: string | null;
  form: string;
  times: string[]; // "HH:MM"
  days: number[]; // 0=Sunday
  instructions: string | null;
  instructionsAr: string | null;
  color: string;
  startDate: string;
  active: boolean;
}

export interface DoseDTO {
  id: string;
  medicationId: string;
  medicationName: string;
  medicationNameAr: string | null;
  dosage: string | null;
  color: string;
  scheduledAt: string;
  status: DoseStatus;
  respondedAt: string | null;
  risk: number; // 0..1 heuristic miss-risk
  riskLevel: RiskLevel;
}

export interface TodaySummaryDTO {
  date: string;
  doses: DoseDTO[];
  taken: number;
  total: number;
  adherenceRate: number; // 0..1
  streak: number;
  nextDose: DoseDTO | null;
  overallRisk: RiskLevel;
}

export interface InsightsDTO {
  hasData: boolean;
  totalDoses: number;
  overallAdherence: number; // 0..1
  streak: number;
  bestDay: { weekday: number; rate: number } | null;
  hardestDay: { weekday: number; rate: number } | null;
  heatmap: { date: string; rate: number; total: number }[];
  weekly: { weekday: number; taken: number; missed: number }[];
  riskForecast: { date: string; risk: number }[];
  byHourBucket: { bucket: "morning" | "afternoon" | "evening" | "night"; taken: number; total: number }[];
  week: { taken: number; missed: number; prevTaken: number; prevMissed: number };
}

export interface InteractionWarning {
  drugA: string;
  drugB: string;
  severity: "major" | "moderate" | "minor";
  descriptionEn: string;
  descriptionAr: string;
}

export interface ChatCitation {
  index: number;
  passage: string;
}

export interface AssistantApiResponse {
  reply: string;
  emergency: boolean;
  grounded: boolean;
  citations: ChatCitation[];
}

/** WP3 — report analysis JSON contract */
export interface ReportAnalysis {
  summary: string;
  keyFindings: { finding: string; source: string }[];
  warnings: string[];
  readability: { level: "easy" | "medium" | "hard"; note: string };
}
