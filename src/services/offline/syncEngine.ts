/**
 * MEDSYNC offline sync engine (plan §Phase 11) — the piece that was missing.
 *
 * Contract (mirrors the upstream React app's tested design):
 *  - Queued write actions are replayed FIFO (by createdAt) whenever the
 *    browser reports "online", every 30s while online, and on tab focus.
 *  - Replay outcome policy:
 *      2xx                       → success, action removed
 *      401 / 408 / 429 / 5xx     → RETRYABLE — kept, exponential backoff
 *                                  (15s·2^n, capped at 10 min), never dropped
 *      any other 4xx             → PERMANENT — dropped to the dead-letter
 *                                  ledger with its reason (never silent)
 *      network error             → treat as offline: stop this flush round
 *  - Backoff is per-action; an action whose nextAttemptAt is in the future is
 *    skipped this round without touching its counters.
 *  - Identity: the JWT is re-read from localStorage on every replay, so a
 *    re-login unblocks a queue that was failing with 401.
 *
 * Honest limitations (documented in docs/OFFLINE_SYNC.md):
 *  - Replay happens only while an app tab is open (no service-worker
 *    background sync in this build).
 *  - Conflict policy is last-write-wins on the replay key: a dose-status
 *    confirmation upserts today's (medication, slot) on the server, so the
 *    latest intent — offline or online — is the one that persists.
 */
import {
  getAllActions,
  removeAction,
  updateAction,
  countPendingActions,
  recordDeadLetter,
  type OfflineAction,
} from "./actionQueue";
import { subscribeToNetwork } from "../network/networkListener";
import { isOnline } from "../network/network";

export type SyncStatus = "idle" | "syncing" | "offline" | "retrying";

export interface SyncState {
  status: SyncStatus;
  pending: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

const RETRYABLE = new Set([401, 408, 429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const FLUSH_INTERVAL_MS = 30_000;

export const SYNC_COMPLETE_EVENT = "medsync-sync-complete";
export const SYNC_STATE_EVENT = "medsync-sync-state";

let state: SyncState = { status: "idle", pending: 0, lastSyncedAt: null, lastError: null };
let started = false;
let flushing = false;
let snapshotListeners = new Set<(s: SyncState) => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SYNC_STATE_EVENT, { detail: state }));
  }
  for (const cb of snapshotListeners) cb(state);
}

export function getSyncState(): SyncState {
  return state;
}

/** React-friendly subscription; returns an unsubscribe function. */
export function subscribeSyncState(cb: (s: SyncState) => void): () => void {
  snapshotListeners.add(cb);
  cb(state);
  return () => snapshotListeners.delete(cb);
}

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token && token !== "null" && token !== "undefined" && token.trim() !== "") {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return headers;
}

/** Replay the queue once. Safe to call concurrently (re-entrant guard). */
export async function flushQueue(): Promise<void> {
  if (flushing || typeof window === "undefined") return;
  flushing = true;
  try {
    if (!isOnline()) {
      setState({ status: "offline", pending: await countPendingActions() });
      return;
    }

    const actions = (await getAllActions()).sort((a, b) => a.createdAt - b.createdAt);
    if (actions.length === 0) {
      if (state.status !== "idle") setState({ status: "idle", pending: 0 });
      return;
    }

    setState({ status: "syncing", pending: actions.length });
    let syncedAny = false;
    let retrying = false;
    let wentOffline = false;

    for (const action of actions) {
      if (action.nextAttemptAt > Date.now()) {
        retrying = true; // waiting on backoff — stays queued
        continue;
      }
      try {
        const res = await fetch(action.url, {
          method: action.method,
          headers: authHeaders(),
          body: JSON.stringify(action.payload),
        });

        if (res.ok) {
          await removeAction(action.id);
          syncedAny = true;
          continue;
        }

        if (RETRYABLE.has(res.status)) {
          action.attempts += 1;
          action.lastError = `HTTP ${res.status}`;
          action.nextAttemptAt = Date.now() + backoffMs(action.attempts);
          await updateAction(action);
          retrying = true;
        } else {
          // Permanent 4xx — drop, but record it (never silently).
          await removeAction(action.id);
          await recordDeadLetter({
            id: action.id,
            type: action.type,
            url: action.url,
            reason: `HTTP ${res.status}`,
            payloadPreview: JSON.stringify(action.payload).slice(0, 200),
            droppedAt: Date.now(),
          });
          setState({ lastError: `${action.type}: HTTP ${res.status}` });
        }
      } catch {
        // Network-level failure mid-flush → offline again. Stop this round;
        // the interval / online-listener will retry.
        wentOffline = true;
        break;
      }
    }

    const remaining = await countPendingActions();
    setState({
      status: wentOffline ? "offline" : remaining > 0 ? (retrying ? "retrying" : "idle") : "idle",
      pending: remaining,
      lastSyncedAt: syncedAny ? Date.now() : state.lastSyncedAt,
    });

    if (syncedAny) {
      // Pages (e.g. Dashboard) refetch their data after a sync completes.
      window.dispatchEvent(new CustomEvent(SYNC_COMPLETE_EVENT, { detail: { synced: true } }));
    }
  } finally {
    flushing = false;
  }
}

/** Start the engine once per page load (idempotent). */
export function startSyncEngine(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  // Initial state from whatever is already queued.
  countPendingActions().then((pending) => {
    setState(
      isOnline()
        ? { status: pending > 0 ? "retrying" : "idle", pending }
        : { status: "offline", pending }
    );
  });

  subscribeToNetwork((online) => {
    if (online) {
      void flushQueue();
    } else {
      countPendingActions().then((pending) => setState({ status: "offline", pending }));
    }
  });

  window.setInterval(() => {
    if (isOnline()) void flushQueue();
  }, FLUSH_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isOnline()) void flushQueue();
  });

  // Kick an initial flush in case actions were queued in a previous session.
  void flushQueue();
}
