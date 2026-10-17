import { openDB } from "idb";

/**
 * MEDSYNC-002 offline persistence (plan §Phase 11).
 *
 * Two object stores:
 *  - "actions": the pending offline action queue (keyPath id). Write actions
 *    (medication add, dose status confirm) captured while offline are stored
 *    here and replayed FIFO by the sync engine.
 *  - "dead": dead-letter ledger for actions dropped after a PERMANENT 4xx
 *    (400/403/404/409/422…). The plan's rule: retry 401/408/429/5xx with
 *    backoff, drop permanent 4xx — but dropping silently is dishonest, so the
 *    dropped intent is recorded here (capped) and surfaced in the sync badge.
 *
 * Version 2 adds the "dead" store; v1 databases upgrade in place.
 */
export const dbPromise = openDB("medsync-db", 2, {
  upgrade(db, _oldVersion, _newVersion, tx) {
    if (!db.objectStoreNames.contains("actions")) {
      db.createObjectStore("actions", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("dead")) {
      db.createObjectStore("dead", { keyPath: "id" });
    }
    void tx;
  },
});
