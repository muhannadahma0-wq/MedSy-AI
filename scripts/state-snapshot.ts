/** Quick state snapshot for session planning. Read-only. */
import { db } from '../src/lib/db';

async function main() {
  const counts = {
    users: await db.user.count(),
    medications: await db.medication.count(),
    doseEvents: await db.doseEvent.count(),
    riskPredictions: await db.riskPrediction.count(),
    smartReminders: await db.smartReminder.count(),
    modelArtifacts: await db.modelArtifact.count(),
    studyAssignments: await db.studyAssignment.count(),
    reports: await db.report.count(),
    healthProfiles: await db.healthProfile.count(),
  };
  console.log('COUNTS', JSON.stringify(counts));

  const active = await db.modelArtifact.findMany({
    where: { isActive: true },
    select: { version: true, modelType: true, metrics: true },
  });
  for (const a of active) {
    const m = typeof a.metrics === 'string' ? a.metrics : JSON.stringify(a.metrics ?? {});
    console.log('ACTIVE', a.version, a.modelType, m.slice(0, 300));
  }

  const byStatus = await db.doseEvent.groupBy({ by: ['status'], _count: { status: true } });
  console.log('BY_STATUS', JSON.stringify(byStatus.map((b) => [b.status, b._count.status])));

  const arms = await db.studyAssignment.groupBy({ by: ['arm'], _count: { arm: true } });
  console.log('ARMS', JSON.stringify(arms.map((b) => [b.arm, b._count.arm])));

  const skipReasons = await db.doseEvent.groupBy({ by: ['skipReason'], _count: { skipReason: true } });
  console.log('SKIP_REASONS', JSON.stringify(skipReasons.map((b) => [b.skipReason, b._count.skipReason])));

  const snoozed = await db.smartReminder.count({ where: { type: 'snooze' } });
  console.log('SNOOZE_REMINDERS', snoozed);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED', e.message);
    process.exit(1);
  });
