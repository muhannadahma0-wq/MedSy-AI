-- Initial PostgreSQL schema for MedSync-AI, generated from prisma/schema.prisma.

-- Applied to Supabase project wyaxwyucknjbghaqppls as initial_medsync_ai_schema on 2026-10-17.

-- All tables use server-side Prisma. Public Data API roles are denied direct table access.

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "password" TEXT,
  "googleId" TEXT UNIQUE,
  "googleTokens" JSONB,
  "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  "lastCalendarSync" TIMESTAMP(3),
  "calendarSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  "otpCode" TEXT,
  "otpExpiresAt" TIMESTAMP(3),
  "otpRetryCount" INTEGER NOT NULL DEFAULT 0,
  "otpResendAt" TIMESTAMP(3),
  "backupCodes" JSONB,
  "preferredLanguage" TEXT,
  "autoTranslateAll" BOOLEAN,
  "showReadabilityScores" BOOLEAN,
  "targetReadingLevel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "Medication" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "pillName" TEXT NOT NULL DEFAULT '',
  "pillDescription" TEXT,
  "dosageDays" JSONB,
  "dosageTimes" JSONB,
  "dosageAmount" TEXT,
  "frequency" TEXT,
  "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endDate" TIMESTAMP(3),
  "originalInstructions" TEXT,
  "translatedAr" TEXT,
  "adherenceHistory" JSONB,
  "doctorName" TEXT,
  "prescriptionId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "nameAr" TEXT,
  "dosage" TEXT,
  "form" TEXT NOT NULL DEFAULT 'tablet',
  "times" TEXT NOT NULL DEFAULT '[]',
  "days" TEXT NOT NULL DEFAULT '[]',
  "instructions" TEXT,
  "instructionsAr" TEXT,
  "color" TEXT NOT NULL DEFAULT 'teal',
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS "Medication_userId_idx" ON "Medication" ("userId");

CREATE TABLE IF NOT EXISTS "Report" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "filename" TEXT NOT NULL DEFAULT '',
  "reportText" TEXT NOT NULL DEFAULT '',
  "analysis" TEXT NOT NULL,
  "translatedAnalysis" JSONB,
  "originalLanguage" TEXT NOT NULL DEFAULT 'en',
  "readabilityScore" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS "Report_userId_idx" ON "Report" ("userId");

CREATE TABLE IF NOT EXISTS "Conversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "agent" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "messages" TEXT NOT NULL DEFAULT '[]',
  "input" TEXT NOT NULL DEFAULT '',
  "output" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL DEFAULT '',
  "language" TEXT NOT NULL DEFAULT 'en',
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "promptVersion" TEXT NOT NULL DEFAULT '',
  "modelVersion" TEXT NOT NULL DEFAULT '',
  "provider" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "Conversation_userId_agent_active_idx" ON "Conversation" ("userId", "agent", "active");

CREATE INDEX IF NOT EXISTS "Conversation_userId_updatedAt_idx" ON "Conversation" ("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "AiFeedback" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "agent" TEXT NOT NULL,
  "rating" TEXT NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "aiLogId" TEXT,
  "conversationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AiFeedback_userId_createdAt_idx" ON "AiFeedback" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "AiFeedback_agent_rating_createdAt_idx" ON "AiFeedback" ("agent", "rating", "createdAt");

CREATE TABLE IF NOT EXISTS "StudyConsent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "version" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "StudyConsent_userId_idx" ON "StudyConsent" ("userId");

CREATE TABLE IF NOT EXISTS "DailyNotification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "dayName" TEXT,
  "notifications" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyNotification_userId_date_key" UNIQUE ("userId", "date")
);

CREATE TABLE IF NOT EXISTS "HealthProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user" TEXT NOT NULL UNIQUE,
  "age" INTEGER,
  "gender" TEXT,
  "height" DOUBLE PRECISION,
  "weight" DOUBLE PRECISION,
  "bloodGroup" TEXT,
  "medicalConditions" JSONB,
  "allergies" JSONB,
  "medications" JSONB,
  "emergencyContact" JSONB,
  "lastCheckup" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DoseEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "medicationId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "actualAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'pending',
  "delayMinutes" INTEGER,
  "skipReason" TEXT,
  "riskScore" DOUBLE PRECISION,
  "riskLevel" TEXT,
  "modelVersion" TEXT,
  "source" TEXT NOT NULL DEFAULT 'scheduler',
  "slotTime" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DoseEvent_medicationId_scheduledAt_key" UNIQUE ("medicationId", "scheduledAt"),
  CONSTRAINT "DoseEvent_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "Medication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DoseEvent_userId_scheduledAt_idx" ON "DoseEvent" ("userId", "scheduledAt");

CREATE INDEX IF NOT EXISTS "DoseEvent_userId_status_idx" ON "DoseEvent" ("userId", "status");

CREATE TABLE IF NOT EXISTS "SmartReminder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "doseEventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'logged',
  "mode" TEXT NOT NULL DEFAULT 'shadow',
  "riskScore" DOUBLE PRECISION,
  "riskLevel" TEXT,
  "payload" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartReminder_doseEventId_type_scheduledAt_key" UNIQUE ("doseEventId", "type", "scheduledAt")
);

CREATE INDEX IF NOT EXISTS "SmartReminder_userId_scheduledAt_idx" ON "SmartReminder" ("userId", "scheduledAt");

CREATE INDEX IF NOT EXISTS "SmartReminder_status_scheduledAt_idx" ON "SmartReminder" ("status", "scheduledAt");

CREATE TABLE IF NOT EXISTS "RiskPrediction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "doseEventId" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "riskScore" DOUBLE PRECISION NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "features" TEXT,
  "explanation" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'shadow',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "RiskPrediction_userId_createdAt_idx" ON "RiskPrediction" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "RiskPrediction_doseEventId_createdAt_idx" ON "RiskPrediction" ("doseEventId", "createdAt");

CREATE TABLE IF NOT EXISTS "StudyAssignment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "arm" TEXT NOT NULL,
  "reason" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "ModelArtifact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "modelType" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "weights" TEXT,
  "metrics" TEXT,
  "trainRows" INTEGER,
  "testRows" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelArtifact_modelType_version_key" UNIQUE ("modelType", "version")
);

CREATE INDEX IF NOT EXISTS "ModelArtifact_modelType_isActive_idx" ON "ModelArtifact" ("modelType", "isActive");

CREATE TABLE IF NOT EXISTS "AiLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "user" TEXT,
  "agent" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "intent" TEXT,
  "severity" TEXT,
  "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "handoff" BOOLEAN NOT NULL DEFAULT false,
  "handoffFrom" TEXT,
  "safetyResult" TEXT,
  "toolCalls" TEXT,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "inputPreview" TEXT,
  "answerLength" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AiLog_agent_createdAt_idx" ON "AiLog" ("agent", "createdAt");

CREATE INDEX IF NOT EXISTS "AiLog_user_createdAt_idx" ON "AiLog" ("user", "createdAt");

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "User" FROM anon, authenticated;

ALTER TABLE "Medication" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "Medication" FROM anon, authenticated;

ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "Report" FROM anon, authenticated;

ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "Conversation" FROM anon, authenticated;

ALTER TABLE "AiFeedback" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "AiFeedback" FROM anon, authenticated;

ALTER TABLE "StudyConsent" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "StudyConsent" FROM anon, authenticated;

ALTER TABLE "DailyNotification" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "DailyNotification" FROM anon, authenticated;

ALTER TABLE "HealthProfile" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "HealthProfile" FROM anon, authenticated;

ALTER TABLE "DoseEvent" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "DoseEvent" FROM anon, authenticated;

ALTER TABLE "SmartReminder" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "SmartReminder" FROM anon, authenticated;

ALTER TABLE "RiskPrediction" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "RiskPrediction" FROM anon, authenticated;

ALTER TABLE "StudyAssignment" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "StudyAssignment" FROM anon, authenticated;

ALTER TABLE "ModelArtifact" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "ModelArtifact" FROM anon, authenticated;

ALTER TABLE "AiLog" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "AiLog" FROM anon, authenticated;
