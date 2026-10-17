import React, { useEffect, useState } from 'react';
import { CloudOff, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';
import { subscribeSyncState } from '../services/offline/syncEngine';

/**
 * Sync status indicator (plan §Phase 11: "a visible sync-status indicator").
 *
 * Fixed bottom-start pill — it must not shift page layout on any screen.
 * Rendered states:
 *   offline  → red,    "Offline — N queued"
 *   syncing  → emerald, spinner, "Syncing N actions…"
 *   retrying → amber,  "Waiting to retry — N queued"
 *   idle + pending>0 → amber (engine loaded with a stale queue)
 *   idle + pending=0 → quiet "Synced" chip that fades after ~6s of calm
 *
 * Bilingual (EN/AR) and RTL-aware via logical positioning classes.
 */
export default function SyncStatusBadge() {
  const { t, isRTL } = useLanguage();
  const [state, setState] = useState(null);
  const [quietVisible, setQuietVisible] = useState(false);

  useEffect(() => {
    let hideTimer = null;
    // Subscribe to the external sync store. State transitions arrive as
    // events (not during render), so scheduling the quiet-chip timer here is
    // safe: it only fires after a completed sync, then auto-hides.
    const unsubscribe = subscribeSyncState((s) => {
      setState(s);
      if (s.status === 'idle' && s.pending === 0 && s.lastSyncedAt) {
        setQuietVisible(true);
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => setQuietVisible(false), 6000);
      }
    });
    return () => {
      unsubscribe();
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  if (!state) return null;

  const { status, pending, lastError } = state;
  const offline = status === 'offline';
  const syncing = status === 'syncing';
  const retrying = status === 'retrying';
  const active = offline || syncing || retrying || pending > 0;
  if (!active && !quietVisible) return null;

  const label = offline
    ? t('Offline', 'غير متصل')
    : syncing
      ? t('Syncing', 'جارية المزامنة')
      : retrying
        ? t('Retrying', 'إعادة المحاولة')
        : t('Synced', 'تمت المزامنة');

  const detail = (offline || retrying) && pending > 0
    ? t(`· ${pending} queued`, `· ${pending} بانتظار المزامنة`)
    : syncing && pending > 0
      ? t(`· ${pending}`, `· ${pending}`)
      : '';

  const Icon = offline ? CloudOff : syncing ? RefreshCw : retrying ? AlertTriangle : CheckCircle2;

  const palette = offline
    ? 'bg-rose-50/95 border-rose-200 text-rose-700'
    : syncing
      ? 'bg-emerald-50/95 border-emerald-200 text-emerald-700'
      : retrying
        ? 'bg-amber-50/95 border-amber-200 text-amber-700'
        : 'bg-slate-50/95 border-slate-200 text-slate-600';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${label} ${detail}`}
      dir={isRTL ? 'rtl' : 'ltr'}
      title={lastError ? `${t('Last issue', 'آخر مشكلة')}: ${lastError}` : undefined}
      className={`fixed bottom-4 start-4 z-40 flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur ${palette}`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span>
        {label}
        {detail ? <span className="opacity-75"> {detail}</span> : null}
      </span>
    </div>
  );
}
