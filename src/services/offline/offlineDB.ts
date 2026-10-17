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
// Do not open IndexedDB at module evaluation: Next.js imports client modules
// during server rendering/build, where the browser IndexedDB global is absent.
// The database is initialized lazily only when a browser-side queue operation
// actually needs it.
let dbPromise: ReturnType<typeof openDB> | null = null;

export function getOfflineDB() {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error("Offline storage is only available in a browser.");
  }
  if (!dbPromise) {
    dbPromise = openDB("medsync-db", 2, {
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
  }
  return dbPromise;
}
