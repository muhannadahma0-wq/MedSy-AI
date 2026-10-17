/**
 * Next.js instrumentation hook — MEDSYNC-004 boot entry point.
 *
 * Starts the unified reminder engine loop when the Node.js server boots.
 * Because all engine state lives in the database (SmartReminder rows with a
 * unique doseEventId+type+scheduledAt key), a restart simply resumes: the boot
 * tick re-plans idempotently and delivers only what is still on time.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const g = globalThis as unknown as { __medsyncEngineStarted?: boolean };
    if (g.__medsyncEngineStarted) return;
    g.__medsyncEngineStarted = true;

    const { startReminderEngineLoop } = await import("@/lib/server/reminder-engine");
    startReminderEngineLoop();
  }
}
