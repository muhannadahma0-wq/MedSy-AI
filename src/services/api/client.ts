import { isOnline } from "../network/network";
import { enqueueAction, type OfflineAction } from "../offline/actionQueue";
import { flushQueue } from "../offline/syncEngine";

/**
 * API client with offline capture (plan §Phase 11).
 *
 * Only WRITE intents are queued for replay — reads make no sense to replay.
 * The replayable set is explicit and closed:
 *   - ADD_MEDICATION            (dedup: medication content key → double-tap safe)
 *   - UPDATE_MEDICATION_STATUS  (dedup: medId + local day → latest intent wins)
 * Reads (FETCH_TODAY_MEDICATION, FETCH_STREAK, …) return {offline:true} and
 * keep whatever the caller already rendered.
 *
 * When the fetch itself fails at the network level while the browser claims
 * to be online (captive portal, dropped Wi-Fi), the write intent is captured
 * too — the same rule the upstream syncEngine tests encoded.
 */

const REPLAYABLE = new Set(["ADD_MEDICATION", "UPDATE_MEDICATION_STATUS"]);

function localDayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function buildDedupKey(actionType: string, body: unknown): string {
  if (actionType === "UPDATE_MEDICATION_STATUS") {
    const medId = (body as { medId?: string })?.medId ?? "unknown";
    return `status:${medId}:${localDayKey()}`;
  }
  if (actionType === "ADD_MEDICATION") {
    const med = (body as { medication?: Record<string, unknown> })?.medication ?? {};
    // Double-tap guard: same name + start date + slot list = same intent.
    const slots = JSON.stringify(med.dosageTimes ?? []);
    return `add:${String(med.pillName ?? "")}:${String(med.startDate ?? "")}:${slots}`;
  }
  return `misc:${JSON.stringify(body).slice(0, 80)}`;
}

async function queueForReplay(
  url: string,
  method: string,
  body: unknown,
  actionType: string
): Promise<{ offline: true; queued?: boolean }> {
  if (!REPLAYABLE.has(actionType)) {
    // Read (or unmapped write) while offline: nothing to replay — tell the
    // caller honestly and let it keep its current state.
    return { offline: true };
  }
  const action: OfflineAction = {
    id: crypto.randomUUID(),
    type: actionType,
    url,
    method,
    payload: body,
    dedupKey: buildDedupKey(actionType, body),
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    status: "pending",
  };
  // Dedup: an identical pending intent is replaced by this one (the user's
  // latest action wins — see docs/OFFLINE_SYNC.md conflict policy).
  await enqueueAction(action);
  // If we are actually reachable (network-level capture path), try a flush
  // right away so recovery does not wait for the 30s interval.
  void flushQueue();
  return { offline: true, queued: true };
}

interface ApiClientParams {
  url: string;
  method: string;
  body: unknown;
  actionType: string;
}

export async function apiClient({
  url,
  method,
  body,
  actionType,
}: ApiClientParams) {
  // OFFLINE → capture intent (writes only; reads return {offline:true}).
  if (!isOnline()) {
    return queueForReplay(url, method, body, actionType);
  }

  // ONLINE → normal API call. JWT from localStorage; the cookie session is
  // sent automatically for same-origin requests as well.
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const tokenValid =
    token && token !== "null" && token !== "undefined" && token.trim() !== "";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(tokenValid ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Network-level failure while "online" — capture replayable writes.
    return queueForReplay(url, method, body, actionType);
  }

  try {
    return await res.json();
  } catch {
    return { success: res.ok };
  }
}

/** Test/support helper — inspect the pending offline queue. */
export async function pendingOfflineActions(): Promise<number> {
  const { countPendingActions } = await import("../offline/actionQueue");
  return countPendingActions();
}

/** Test/support helper — is this actionType replayable offline? */
export function isReplayable(actionType: string): boolean {
  return REPLAYABLE.has(actionType);
}
