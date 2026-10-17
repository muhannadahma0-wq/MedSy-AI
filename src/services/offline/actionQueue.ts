import { getOfflineDB } from "./offlineDB";

/**
 * Offline action queue (plan §Phase 11).
 *
 * An OfflineAction is a captured WRITE intent: the exact request the user
 * made while offline (url + method + body), plus replay bookkeeping
 * (attempts / backoff / last error). Reads are never queued.
 *
 * Conflict/dedup key: when a new action carries the same `dedupKey` as a
 * still-pending one, the OLD row is replaced by the NEW one — the user's
 * latest intent wins (last-write-wins, documented in docs/OFFLINE_SYNC.md).
 */
export type OfflineAction = {
  id: string;
  type: string; // ADD_MEDICATION | UPDATE_MEDICATION_STATUS
  url: string; // replay target (relative)
  method: string; // POST
  payload: unknown; // request body (no identity — auth derives the user)
  dedupKey: string; // type-scoped idempotency key (see client.ts)
  createdAt: number;
  attempts: number;
  nextAttemptAt: number; // earliest allowed replay (exponential backoff)
  lastError?: string;
  status: "pending" | "syncing" | "failed";
};

/** A dropped action, kept for transparency (capped by the engine). */
export interface DeadLetter {
  id: string;
  type: string;
  url: string;
  reason: string; // e.g. "HTTP 404"
  payloadPreview: string;
  droppedAt: number;
}

export async function enqueueAction(action: OfflineAction): Promise<void> {
  const db = await getOfflineDB();
  // Replace a pending action with the same dedupKey (latest intent wins).
  const existing = await findPendingByDedupKey(action.type, action.dedupKey);
  if (existing && existing.id !== action.id) {
    await db.delete("actions", existing.id);
  }
  await db.put("actions", action);
}

export async function getAllActions(): Promise<OfflineAction[]> {
  const db = await getOfflineDB();
  return db.getAll("actions");
}

export async function countPendingActions(): Promise<number> {
  const db = await getOfflineDB();
  return db.count("actions");
}

export async function updateAction(action: OfflineAction): Promise<void> {
  const db = await getOfflineDB();
  await db.put("actions", action);
}

export async function removeAction(id: string): Promise<void> {
  const db = await getOfflineDB();
  await db.delete("actions", id);
}

export async function findPendingByDedupKey(
  type: string,
  dedupKey: string
): Promise<OfflineAction | undefined> {
  const db = await getOfflineDB();
  const all = await db.getAll("actions");
  return all.find((a) => a.type === type && a.dedupKey === dedupKey);
}

export async function recordDeadLetter(letter: DeadLetter): Promise<void> {
  const db = await getOfflineDB();
  await db.put("dead", letter);
  // Cap the ledger — keep the most recent 20.
  const all = (await db.getAll("dead")) as DeadLetter[];
  if (all.length > 20) {
    const oldest = all.sort((a, b) => a.droppedAt - b.droppedAt).slice(0, all.length - 20);
    for (const o of oldest) await db.delete("dead", o.id);
  }
}

export async function getDeadLetters(): Promise<DeadLetter[]> {
  const db = await getOfflineDB();
  return db.getAll("dead");
}
