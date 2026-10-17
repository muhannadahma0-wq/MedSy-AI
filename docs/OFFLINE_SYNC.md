# Offline Sync — Design & Conflict Policy

> Plan reference: MASTER_PLAN Phase 11 (Offline sync). This port ships the
> upstream's tested core loop plus the two items the plan listed as missing:
> an explicit conflict policy and a visible sync-status indicator.

## What is queued

Only **write intents** are captured while offline (`src/services/api/client.ts`):

| actionType | endpoint | dedup key |
|---|---|---|
| `UPDATE_MEDICATION_STATUS` | `POST /api/medicine/status` | `status:{medId}:{local YYYY-MM-DD}` |
| `ADD_MEDICATION` | `POST /api/medicine/add` | `add:{pillName}:{startDate}:{dosageTimes JSON}` |

Reads (`FETCH_TODAY_MEDICATION`, `FETCH_STREAK`, …) are never queued: replaying
a read makes no sense. When offline they return `{ offline: true }` and the UI
keeps whatever it already rendered.

`Skip` (`POST /api/dose-events/skip`) and `Snooze` are deliberately **not**
queued: both require a fresh pending `DoseEvent` id resolved from the server,
and replaying a stale id hours later would be dishonest about which dose the
user meant. Offline, these actions surface their network error to the user.

## Replay contract

`src/services/offline/syncEngine.ts` — replay runs:

- when the browser fires `online`,
- every 30 s while online,
- when the tab becomes visible,
- immediately after a new action is captured while reachable.

Per action, FIFO by capture time:

| outcome | policy |
|---|---|
| 2xx | success → removed from queue |
| 401 / 408 / 429 / 5xx | retryable → kept, exponential backoff (15 s · 2ⁿ, cap 10 min), **never dropped** |
| other 4xx (400/403/404/409/422…) | permanent → dropped to the dead-letter ledger with its HTTP reason (never silently) |
| network error mid-flush | treated as offline → round stops, interval/online-event retries |

The JWT is re-read from localStorage on every replay, so a re-login unblocks a
queue stuck on 401. The dead-letter ledger (IndexedDB `dead` store, capped at
20) is surfaced through the sync badge tooltip ("last issue").

## Conflict policy (decided, per plan)

**Last-write-wins on the replay key.** Rationale:

1. `UPDATE_MEDICATION_STATUS` targets *today's* `(medication, slot)`. The
   server upserts the `DoseEvent` row by `@@unique([medicationId, scheduledAt])`
   and mirrors the slot in `Medication.dosageTimes`. Whichever confirmation
   reaches the server last — online or replayed — is the state that persists,
   and `updatedAt` records when.
2. Client-side dedup goes further: a second offline confirmation for the same
   `(medId, local day)` **replaces** the queued action rather than stacking a
   second one, so the user's latest intent (e.g. `taken` after `delayed`) is
   what replays.
3. `ADD_MEDICATION` is append-only and has no server-side unique constraint;
   the content dedup key only guards double-taps, not "same medication added
   twice on purpose a week apart" (those differ by `startDate` or slots).

**Honest consequences of this policy** (kept visible rather than hidden):

- If device A confirms a dose online and device B later replays an offline
  confirmation of the same slot, B wins. For a single-user, single-device
  graduation-project deployment this is the right simplicity/robustness
  trade-off; multi-device CRDT-style merge is future work.
- Optimistic UI marks the slot `taken` locally; if the replay later dead-letters
  (e.g. the medication was deleted server-side → 404), the post-sync refetch
  re-renders the server truth. The badge tooltip shows the dropped reason.

## Visible indicator

`src/components/SyncStatusBadge.jsx` — fixed bottom-start pill (no layout
shift), bilingual EN/AR, RTL-aware, `role="status"` + `aria-live="polite"`:

- `offline` → red, "Offline · N queued"
- `syncing` → emerald, spinner
- `retrying` (backoff) → amber
- idle after a successful sync → quiet "Synced" chip that fades after 6 s

`Dashboard` listens for `medsync-sync-complete` and refetches medications +
streak so optimistically-marked cards converge to server truth.

## Honest limitations

- Replay happens only while an app tab is open. No service-worker background
  sync in this build.
- `navigator.onLine` is advisory; a captive portal can read "online". The
  engine treats the resulting fetch failure as offline and retries on the next
  interval, so the failure mode is delayed sync, not data loss.
- First page load while offline shows an empty medication list — there is no
  persistent read cache, only the write queue.
- The queue is per-browser (IndexedDB `medsync-db`), not per-user. A shared
  computer replaying user A's queue while user B is logged in would fail the
  server's auth (JWT of B ≠ A's actions target A's data — they are keyed to
  the authenticated caller, so B's replay of A's action would 403/404 into the
  dead-letter ledger rather than corrupt anything). Clearing site data clears
  the queue.
