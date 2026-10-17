import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const users = await db.user.count();
  const meds = await db.medication.count();
  const events = await db.doseEvent.count();
  const predictions = await db.riskPrediction.count();
  const reminders = await db.smartReminder.count();
  const artifacts = await db.modelArtifact.count();
  const reports = await db.report.count();
  const profiles = await db.healthProfile.count();
  const assignments = await db.studyAssignment.count();
  const userList = await db.user.findMany({
    select: { id: true, email: true, name: true, preferredLanguage: true },
    orderBy: { createdAt: 'asc' }
  });
  console.log(JSON.stringify({ users, meds, events, predictions, reminders, artifacts, reports, profiles, assignments }, null, 2));
  console.log('USERS:', JSON.stringify(userList.map(u => `${u.email} (${u.fullName}, ${u.preferredLanguage})`), null, 2));
}
main().finally(() => db.$disconnect());
