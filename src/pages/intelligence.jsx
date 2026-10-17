import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Radar, ArrowLeft, RotateCw, Pill, ChevronDown, Bell, AlarmClock, BellRing, Zap,
  Target, Timer, Flame, Clock, Cpu, Gauge, Brain, Activity, X, AlertCircle,
  FlaskConical, Download, Scale
} from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';
import Button from '../components/Button';

/**
 * Adherence Intelligence — the ML risk-prediction layer (Task 9-ui).
 *
 * Standalone canvas page following the Analytics.jsx pattern (bare
 * space-y-6 root, section-title header, embedded-safe): it renders the
 * per-dose risk forecast, model status/calibration, the reminder-engine
 * ledger, dose history and adherence patterns served by
 * /api/intelligence/overview.
 */

// Read the signed-in user id defensively (localStorage "user" payload has
// been seen as { id }, { user: { id } } and { _id } across environments).
const getUserId = () => {
  try {
    const stored = localStorage.getItem('user');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed?.user?.id ?? parsed?.id ?? parsed?._id ?? null;
  } catch (err) {
    console.error('Failed to parse stored user', err);
    return null;
  }
};

// 0.5049 → "50%" (null-safe)
const pct = (v) =>
  typeof v === 'number' && isFinite(v) ? `${Math.round(v * 100)}%` : '—';

// Metric numbers keep 3 decimals ("0.500"); null-safe.
const fmtMetric = (v) =>
  typeof v === 'number' && isFinite(v) ? v.toFixed(3) : '—';

// Confidence-interval display — accepts {lo,hi} objects or [lo,hi] arrays.
const fmtCi = (ci) => {
  const lo = Array.isArray(ci) ? ci[0] : ci?.lo;
  const hi = Array.isArray(ci) ? ci[1] : ci?.hi;
  if (typeof lo !== 'number' || typeof hi !== 'number') return '—';
  return `${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}`;
};

// Display-only Arabic weekday names (raw API values stay untouched).
const WEEKDAYS_AR = {
  Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء',
  Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت',
};

// Risk badges (on white cards) — high per spec, medium/low in the same shape.
const RISK_BADGE = {
  high: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  low: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
};

const RISK_DOT = {
  high: 'bg-rose-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
};

// Reminder-type icon tiles.
const REMINDER_ICONS = { before: Bell, onTime: AlarmClock, after: BellRing, extra: Zap, snooze: Clock };
const REMINDER_TILES = {
  before: 'bg-slate-100 border border-slate-200 text-slate-500',
  onTime: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
  after: 'bg-amber-50 border border-amber-100 text-amber-600',
  extra: 'bg-cyan-50 border border-cyan-100 text-cyan-600',
  snooze: 'bg-amber-50 border border-amber-100 text-amber-600',
};

// Four-candidate comparison labels (plan §16) — bilingual.
const MODEL_TYPE_LABELS = {
  baseline: { en: 'Rule Baseline', ar: 'خط أساس بالقواعد' },
  'logistic-regression': { en: 'Logistic Regression', ar: 'الانحدار اللوجستي' },
  'gradient-boosting': { en: 'Gradient Boosting', ar: 'التعزيز التدرّجي' },
  'random-forest': { en: 'Random Forest', ar: 'الغابة العشوائية' },
};
const modelTypeLabel = (type, t) => {
  const m = MODEL_TYPE_LABELS[type];
  return m ? t(m.en, m.ar) : type;
};

// Flat tinted stat-card tile (Rhythm v4 pattern from Analytics StatCard).
const StatCard = ({ title, value, subtitle, icon: Icon, color = 'emerald', accent = false, style }) => {
  const colorMap = {
    emerald: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
    cyan: 'bg-cyan-50 border border-cyan-100 text-cyan-600',
    amber: 'bg-amber-50 border border-amber-100 text-amber-600',
    rose: 'bg-rose-50 border border-rose-100 text-rose-600',
  };
  return (
    <div className="glass-card glass-card-hover p-5 sm:p-6 animate-fade-up" style={style}>
      <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${colorMap[color]}`}>
        <Icon className="h-6 w-6" />
      </div>
      <p className={`text-3xl font-bold ${accent ? 'text-gradient' : 'text-slate-900'}`}>{value}</p>
      <p className="mt-1 text-sm font-semibold text-slate-600">{title}</p>
      {subtitle && <p className="mt-0.5 text-xs font-medium text-slate-400">{subtitle}</p>}
    </div>
  );
};

export default function Intelligence() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const locale = language === 'ar' ? 'ar' : undefined;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [actionBusy, setActionBusy] = useState(null); // 'tick' | 'train' | null
  const [actionResult, setActionResult] = useState(null); // { type, text }
  const [studyOutcomes, setStudyOutcomes] = useState(null); // /api/study/outcomes (non-fatal)
  const [studyBusy, setStudyBusy] = useState(null); // 'export' | null

  // Locale-aware date/time formatting with Invalid-Date guards.
  const formatSchedule = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleString(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  };
  const formatDateTime = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  };
  const formatTime = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  };

  // Reusable loader — also called after engine actions to refresh the page.
  const loadData = (isRefresh = false) => {
    const uid = getUserId();
    if (!uid) {
      console.warn('No user ID found');
      // Defer the state update so a synchronous effect body stays synchronous.
      setTimeout(() => setLoading(false), 0);
      return;
    }
    if (isRefresh) setRefreshing(true);
    // Phase 12 — authenticated raw fetches (Bearer + HttpOnly cookie).
    const authHeaders = { Authorization: `Bearer ${localStorage.getItem('token') || ''}` };
    fetch(`/api/intelligence/overview?userId=${uid}`, { headers: authHeaders })
      .then((res) => res.json())
      .then((apiData) => {
        setData(apiData);
        setLoading(false);
        setRefreshing(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
        setRefreshing(false);
      });
    // Study outcomes (plan §30–31) — separate, non-fatal feed.
    fetch(`/api/study/outcomes?userId=${uid}`, { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((o) => setStudyOutcomes(o && o.success ? o : null))
      .catch(() => setStudyOutcomes(null));
  };

  useEffect(() => {
    loadData();
  }, []);

  // Manual engine runs: reminder tick + model retraining.
  const runAction = async (kind) => {
    const uid = getUserId();
    if (!uid || actionBusy) return;
    setActionBusy(kind);
    setActionResult(null);
    try {
      const res = await fetch(kind === 'tick' ? '/api/reminder-engine/tick' : '/api/ml/train', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        },
        body: JSON.stringify({ userId: uid }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      if (kind === 'tick') {
        const s = json.summary || {};
        setActionResult({
          type: 'success',
          text: t(
            `Engine tick complete — scored ${s.scored ?? 0} · planned ${s.planned ?? 0}.`,
            `اكتملت دورة المحرك — تم تقييم ${s.scored ?? 0} والتخطيط لإرسال ${s.planned ?? 0}.`
          ),
        });
      } else {
        const version = json.report?.promoted?.version || json.report?.logisticRegression?.version || '—';
        const roc = json.report?.logisticRegression?.metrics?.rocAuc;
        const rocTxt = typeof roc === 'number' ? roc.toFixed(3) : '—';
        setActionResult({
          type: 'success',
          text: t(
            `Model retrained — promoted ${version} (ROC-AUC ${rocTxt}).`,
            `أعيد تدريب النموذج — تمت الترقية إلى ${version} (ROC-AUC ${rocTxt}).`
          ),
        });
      }
      loadData(true);
    } catch (err) {
      console.error(err);
      setActionResult({
        type: 'error',
        text: t(`Action failed: ${err.message}`, `فشل الإجراء: ${err.message}`),
      });
    } finally {
      setActionBusy(null);
    }
  };

  // Pseudonymized study-dataset export (plan §24/§32) — downloads the CSV.
  const exportStudyCsv = async () => {
    const uid = getUserId();
    if (!uid || studyBusy) return;
    setStudyBusy('export');
    try {
      const res = await fetch(`/api/study/export?userId=${uid}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `medsync-study-export-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setStudyBusy(null);
    }
  };

  // ── Loading skeleton (matches the card layout) ──────────────────────────
  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <span className="sr-only">{t('Loading intelligence data...', 'جارٍ تحميل بيانات الذكاء...')}</span>
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 animate-pulse rounded-xl bg-white/10" />
          <div className="space-y-2">
            <div className="h-6 w-72 animate-pulse rounded-lg bg-white/10" />
            <div className="h-3 w-56 animate-pulse rounded bg-white/5" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-[20px] bg-white/5" />
          ))}
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
          <div className="h-[28rem] animate-pulse rounded-[20px] bg-white/5 md:col-span-2" />
          <div className="h-[28rem] animate-pulse rounded-[20px] bg-white/5" />
        </div>
        <div className="h-36 animate-pulse rounded-[20px] bg-white/5" />
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <div className="h-64 animate-pulse rounded-[20px] bg-white/5" />
          <div className="h-64 animate-pulse rounded-[20px] bg-white/5" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 h-16 w-16 text-slate-500" />
          <p className="text-lg font-medium text-slate-300">
            {t('No intelligence data available', 'لا توجد بيانات ذكاء متاحة')}
          </p>
        </div>
      </div>
    );
  }

  // ── Derived data (null-safe) ─────────────────────────────────────────────
  const adh = data.adherence || {};
  const forecast = Array.isArray(data.forecast) ? data.forecast : [];
  const history = Array.isArray(data.history) ? data.history : [];
  const model = data.model || null;
  const metrics = model?.metrics || {};
  const calibration = Array.isArray(metrics.calibration) ? metrics.calibration : [];
  const modelCandidates = Array.isArray(data.modelCandidates) ? data.modelCandidates : [];
  const study = data.study || null;
  const reminders = data.reminders || {};
  const reminderCounts = reminders.counts || {};
  const reminderRecent = Array.isArray(reminders.recent) ? reminders.recent : [];
  const byWeekday = Array.isArray(adh.byWeekday) ? adh.byWeekday : [];
  const bySlot = Array.isArray(adh.bySlot) ? adh.bySlot : [];
  const disclaimer = language === 'ar' ? data.disclaimers?.ar : data.disclaimers?.en;
  const windowDays = adh.windowDays ?? 30;
  const isLive = data.engineMode === 'live';

  const doseChip = {
    taken: 'chip-modern chip-taken',
    delayed: 'chip-modern chip-delayed',
    missed: 'chip-modern bg-rose-50 text-rose-700 border border-rose-200/80',
    skipped: 'chip-modern bg-slate-100 text-slate-600 border border-slate-200',
  };
  const doseLabel = (status) => ({
    taken: t('Taken', 'مؤكدة'),
    delayed: t('Delayed', 'متأخرة'),
    missed: t('Not confirmed', 'غير مؤكدة'),
    skipped: t('Skipped', 'تم تجاوزها'),
  }[status] || t('Pending', 'قيد الانتظار'));

  const reminderStatusChip = {
    logged: 'bg-amber-50 text-amber-700 border border-amber-200/80',
    sent: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
    skipped: 'bg-rose-50 text-rose-700 border border-rose-200/80',
  };
  const reminderStatusLabel = (status) => ({
    logged: t('logged', 'مسجّلة'),
    sent: t('sent', 'مُرسلة'),
    skipped: t('skipped', 'متجاوزة'),
  }[status] || status);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 animate-fade-up lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            aria-label={t('Go back', 'الرجوع')}
            className="group rounded-xl p-3 text-slate-300 transition-all hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-6 w-6 transition-transform rtl:rotate-180 ltr:group-hover:-translate-x-1 rtl:group-hover:translate-x-1" />
          </button>
          <div>
            <h1 className="section-title flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 shadow-sm">
                <Radar className="h-6 w-6 text-white" />
              </span>
              {t('Adherence Intelligence', 'ذكاء الالتزام الدوائي')}
            </h1>
            <p className="ms-eyebrow-canvas mt-2">
              {t('Per-dose risk predictions from your adherence model', 'توقعات مخاطر لكل جرعة من نموذج الالتزام الخاص بك')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              isLive
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}
            role="status"
          >
            <span className={`h-2 w-2 rounded-full bg-current ${isLive ? 'animate-pulse-soft' : ''}`} />
            {isLive
              ? t('Live — delivering', 'مباشر — يرسل التذكيرات')
              : t('Shadow Mode — logging only', 'الوضع الظلي — تسجيل دون إرسال')}
          </span>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            aria-label={t('Refresh intelligence data', 'تحديث بيانات الذكاء')}
            className="btn-ghost-dark px-4 py-3 text-sm"
          >
            <RotateCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{t('Refresh', 'تحديث')}</span>
          </button>
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────────── */}
      <div>
        <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
          <StatCard
            title={t('Adherence Rate', 'معدل الالتزام')}
            value={pct(adh.adherenceRate)}
            subtitle={t('confirmed of resolved doses', 'مؤكدة من الجرعات المحسومة')}
            icon={Target}
            color="emerald"
            accent
            style={{ animationDelay: '60ms' }}
          />
          <StatCard
            title={t('On-time Rate', 'الالتزام بالتوقيت')}
            value={pct(adh.onTimeRate)}
            subtitle={t('of confirmed doses', 'من الجرعات المؤكدة')}
            icon={Timer}
            color="cyan"
            style={{ animationDelay: '120ms' }}
          />
          <StatCard
            title={t('Current Streak', 'سلسلة الالتزام الحالية')}
            value={`${(adh.streakDays ?? 0).toLocaleString(locale)} ${t('day(s)', 'يوم/أيام')}`}
            subtitle={t('consecutive days on track', 'أيام متتالية على المسار')}
            icon={Flame}
            color="amber"
            style={{ animationDelay: '180ms' }}
          />
          <StatCard
            title={t('Average Delay', 'متوسط التأخير')}
            value={typeof adh.avgDelayMinutes === 'number' ? `${adh.avgDelayMinutes.toLocaleString(locale)} ${t('min', 'دقيقة')}` : '—'}
            subtitle={t('across delayed doses', 'عبر الجرعات المتأخرة')}
            icon={Clock}
            color="rose"
            style={{ animationDelay: '240ms' }}
          />
        </div>
        <p className="mt-3 text-xs text-slate-400">
          {t(`Window: last ${windowDays} days`, `النافذة: آخر ${windowDays} يوماً`)}
        </p>
      </div>

      {/* ── Risk Forecast + Model Status ────────────────────────────────────── */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
        {/* Risk Forecast */}
        <section className="glass-card p-5 sm:p-6 md:col-span-2 min-w-0 animate-fade-up" style={{ animationDelay: '80ms' }} aria-labelledby="intel-forecast-title">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 id="intel-forecast-title" className="ms-serif text-lg font-semibold text-slate-900">
                {t('Risk Forecast', 'توقّع المخاطر — 48 ساعة قادمة')}
              </h3>
              <p className="ms-eyebrow mt-1">
                {t('Each upcoming dose is scored individually', 'كل جرعة قادمة تُقيَّم على حدة')}
              </p>
            </div>
            <Radar className="h-6 w-6 shrink-0 text-emerald-600" />
          </div>

          {forecast.length === 0 ? (
            <p className="py-10 text-center text-sm font-medium text-slate-400">
              {t('No upcoming doses in the next 48 hours.', 'لا توجد جرعات قادمة خلال الـ 48 ساعة القادمة.')}
            </p>
          ) : (
            <div className="max-h-[26rem] space-y-2.5 overflow-y-auto pe-1" role="list" aria-label={t('Upcoming doses with risk scores', 'الجرعات القادمة مع درجات الخطر')}>
              {forecast.map((f) => {
                const isOpen = expandedId === f.id;
                const explanation = Array.isArray(f.explanation) ? f.explanation : [];
                // Bar scale per spec: |contribution| × 250 (⇔ |c| / 0.4), capped
                // at 100%. The promoted LR model emits raw contributions well
                // above 0.4, so when the set's largest magnitude exceeds that
                // ceiling we rescale relative to it — bars stay comparable
                // within a dose and identical to the spec for small values.
                const maxAbs = explanation.reduce((m, e) => Math.max(m, Math.abs(e.contribution || 0)), 0.4);
                return (
                  <div key={f.id} role="listitem" className="surface-inset p-3 sm:p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
                        <Pill className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {f.medicationName}
                          {f.dosageAmount && <span className="font-medium text-slate-400"> · {f.dosageAmount}</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">{formatSchedule(f.scheduledAt)}</p>
                      </div>
                      <span
                        className={`chip-modern shrink-0 border font-bold tabular-nums ${RISK_BADGE[f.riskLevel] || RISK_BADGE.low}`}
                        title={t(`${f.riskLevel || 'low'} miss risk`, `خطر ${f.riskLevel === 'high' ? 'مرتفع' : f.riskLevel === 'medium' ? 'متوسط' : 'منخفض'} للتفويت`)}
                      >
                        {typeof f.riskScore === 'number' ? `${Math.round(f.riskScore * 100)}%` : '—'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpandedId(isOpen ? null : f.id)}
                        aria-expanded={isOpen}
                        aria-label={t(`Toggle risk explanation for ${f.medicationName}`, `إظهار أو إخفاء تفسير الخطر لـ ${f.medicationName}`)}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      >
                        <ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                    </div>

                    {isOpen && (
                      <div className="surface-inset mt-3 animate-fade-in rounded-xl p-3">
                        <p className="mb-2.5 text-xs font-semibold text-slate-700">
                          {f.explanationKind === 'global-importance'
                            ? t('Model feature importance (applies to all doses)', 'أهمية الخصائص لدى النموذج (تنطبق على كل الجرعات)')
                            : t('Why this risk?', 'لماذا هذا الخطر؟')}
                        </p>
                        <div className="space-y-2.5">
                          {explanation.length === 0 && (
                            <p className="text-xs text-slate-400">{t('No explanation available.', 'لا يوجد تفسير متاح.')}</p>
                          )}
                          {explanation.map((e, i) => {
                            const label = language === 'ar' ? (e.labelAr ?? e.labelEn) : (e.labelEn ?? e.labelAr);
                            const value = language === 'ar' ? (e.valueAr ?? e.valueEn) : (e.valueEn ?? e.valueAr);
                            const c = typeof e.contribution === 'number' ? e.contribution : 0;
                            const globalKind = f.explanationKind === 'global-importance';
                            const width = globalKind
                              ? Math.min(100, Math.max(2, (c / Math.max(...explanation.map((x) => Math.abs(x.contribution || 0)), 0.001)) * 100))
                              : Math.min(100, (Math.abs(c) / maxAbs) * 100);
                            return (
                              <div key={`${f.id}-exp-${i}`}>
                                <div className="flex items-baseline justify-between gap-3">
                                  <span className="truncate text-xs font-medium text-slate-600">{label}</span>
                                  <span className="shrink-0 tabular-nums text-xs text-slate-500">{value}</span>
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200/70">
                                    <div
                                      className={`h-full rounded-full ${!globalKind && c < 0 ? 'bg-emerald-500' : globalKind ? 'bg-cyan-500' : 'bg-rose-500'}`}
                                      style={{ width: `${width}%` }}
                                    />
                                  </div>
                                  <span className={`w-12 shrink-0 text-end text-xs font-semibold tabular-nums ${globalKind ? 'text-cyan-600' : c >= 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                                    {globalKind ? `${Math.round(c * 100)}%` : `${c >= 0 ? '+' : ''}${c.toFixed(2)}`}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {disclaimer && <p className="pt-2 text-xs italic text-slate-400">{disclaimer}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Model Status */}
        <section className="glass-card p-5 sm:p-6 min-w-0 animate-fade-up" style={{ animationDelay: '140ms' }} aria-labelledby="intel-model-title">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 id="intel-model-title" className="ms-serif text-lg font-semibold text-slate-900">
                {t('Model Status', 'حالة النموذج')}
              </h3>
              <p className="ms-eyebrow mt-1">{t('Active predictor', 'المتنبئ النشط')}</p>
            </div>
            <Gauge className="h-6 w-6 shrink-0 text-cyan-600" />
          </div>

          {!model ? (
            <div className="py-8 text-center">
              <Cpu className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm font-semibold text-slate-700">{t('No trained model yet', 'لا يوجد نموذج مدرّب بعد')}</p>
              <p className="mt-1 text-xs text-slate-400">
                {t('Predictions currently use the built-in rule baseline.', 'تستخدم التوقعات حالياً خط الأساس بالقواعد المدمج.')}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    model.modelType === 'logistic-regression'
                      ? 'border border-cyan-100 bg-cyan-50 text-cyan-600'
                      : model.modelType === 'random-forest'
                        ? 'border border-emerald-100 bg-emerald-50 text-emerald-600'
                        : model.modelType === 'gradient-boosting'
                          ? 'border border-teal-100 bg-teal-50 text-teal-600'
                          : 'border border-emerald-100 bg-emerald-50 text-emerald-600'
                  }`}
                >
                  <Cpu className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-slate-900">{modelTypeLabel(model.modelType, t)}</p>
              </div>

              <dl className="mb-5 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">{t('Version', 'الإصدار')}</dt>
                  <dd className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">{model.version}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">{t('Trained', 'تاريخ التدريب')}</dt>
                  <dd className="text-xs text-slate-700">{formatDateTime(model.trainedAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">{t('Rows (train / test)', 'الصفوف (تدريب / اختبار)')}</dt>
                  <dd className="tabular-nums text-xs text-slate-700">
                    {(model.trainRows ?? 0).toLocaleString(locale)} / {(model.testRows ?? 0).toLocaleString(locale)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">{t('Predictions logged', 'توقعات مسجّلة')}</dt>
                  <dd className="tabular-nums text-xs text-slate-700">{(data.predictionsLogged ?? 0).toLocaleString(locale)}</dd>
                </div>
              </dl>

              <div className="mb-5 grid grid-cols-2 gap-2.5">
                <div className="surface-inset p-3">
                  <p className="text-xl font-bold tabular-nums text-cyan-600">{fmtMetric(metrics.rocAuc)}</p>
                  <p className="text-xs font-medium text-slate-500">ROC-AUC</p>
                </div>
                <div className="surface-inset p-3">
                  <p className="text-xl font-bold tabular-nums text-cyan-600">{fmtMetric(metrics.prAuc)}</p>
                  <p className="text-xs font-medium text-slate-500">PR-AUC</p>
                </div>
                <div className="surface-inset p-3">
                  <p className="text-xl font-bold tabular-nums text-amber-600">{fmtMetric(metrics.brier)}</p>
                  <p className="text-xs font-medium text-slate-500">{t('Brier score', 'درجة برير')}</p>
                </div>
                <div className="surface-inset p-3">
                  <p className="text-xl font-bold tabular-nums text-slate-900">{fmtMetric(metrics.accuracy)}</p>
                  <p className="text-xs font-medium text-slate-500">{t('Accuracy', 'الدقة')}</p>
                  <p className="text-[10px] text-slate-400">{t('secondary metric', 'مقياس ثانوي')}</p>
                </div>
              </div>

              {/* Four-candidate comparison (plan §16) — same temporal test split. */}
              {modelCandidates.length > 1 && (
                <div className="mb-4">
                  <p className="mb-2 text-xs font-semibold text-slate-700">
                    {t('Candidates — same temporal test split', 'المترشحون — على نفس شريحة الاختبار الزمنية')}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-start text-slate-400">
                          <th className="py-1 pe-2 text-start font-medium">{t('Model', 'النموذج')}</th>
                          <th className="py-1 px-2 text-end font-medium">ROC-AUC</th>
                          <th className="py-1 px-2 text-end font-medium">PR-AUC</th>
                          <th className="py-1 ps-2 text-end font-medium">{t('Brier', 'برير')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modelCandidates.map((c) => (
                          <tr key={c.modelType} className={c.isActive ? 'rounded-lg bg-emerald-50/70 font-semibold' : ''}>
                            <td className="py-1.5 pe-2 text-start text-slate-700">
                              <span className="inline-flex items-center gap-1.5">
                                {modelTypeLabel(c.modelType, t)}
                                {c.isActive && (
                                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600">
                                    {t('active', 'نشط')}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="py-1.5 px-2 text-end tabular-nums text-slate-700">{fmtMetric(c.metrics?.rocAuc)}</td>
                            <td className="py-1.5 px-2 text-end tabular-nums text-slate-700">{fmtMetric(c.metrics?.prAuc)}</td>
                            <td className="py-1.5 ps-2 text-end tabular-nums text-slate-700">{fmtMetric(c.metrics?.brier)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {calibration.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700">{t('Calibration', 'المعايرة')}</p>
                    <div className="flex items-center gap-2.5 text-[10px] text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-cyan-500" />
                        {t('predicted', 'المتوقع')}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                        {t('observed', 'الملحوظ')}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {calibration.map((b, i) => (
                      <div
                        key={`cal-${i}`}
                        className="flex items-center gap-2"
                        title={t(
                          `predicted ${fmtMetric(b.meanPredicted)} · observed ${fmtMetric(b.observedRate)} · ${(b.count || 0).toLocaleString(locale)} doses`,
                          `المتوقع ${fmtMetric(b.meanPredicted)} · الملحوظ ${fmtMetric(b.observedRate)} · ${(b.count || 0).toLocaleString(locale)} جرعة`
                        )}
                      >
                        <span className="w-11 shrink-0 text-[10px] tabular-nums text-slate-400">
                          {b.binStart.toFixed(1)}–{b.binEnd.toFixed(1)}
                        </span>
                        <div className="relative h-2 flex-1 rounded bg-slate-200/70">
                          <div
                            className="absolute inset-y-0 start-0 rounded-s bg-emerald-500"
                            style={{ width: `${Math.round((b.observedRate || 0) * 100)}%` }}
                          />
                          <div
                            className="absolute -inset-y-[3px] w-0.5 bg-cyan-600"
                            style={{ insetInlineStart: `${Math.round((b.meanPredicted || 0) * 100)}%` }}
                          />
                        </div>
                        <span className="w-6 shrink-0 text-end text-[10px] tabular-nums text-slate-400">
                          {(b.count || 0).toLocaleString(locale)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-400">
                {t(
                  'Temporal split — trained on the earlier 70%, evaluated on the later 30%.',
                  'تقسيم زمني — التدريب على أول 70% والتقييم على آخر 30%.'
                )}
              </p>
            </>
          )}
        </section>
      </div>

      {/* ── Engine actions ──────────────────────────────────────────────────── */}
      <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '180ms' }} aria-labelledby="intel-actions-title">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-3 me-auto">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h3 id="intel-actions-title" className="ms-serif text-lg font-semibold text-slate-900">
                {t('Engine Actions', 'إجراءات المحرك')}
              </h3>
              <p className="ms-eyebrow mt-1">{t('Run the pipeline on demand', 'شغّل خط المعالجة عند الطلب')}</p>
            </div>
          </div>
          <Button
            variant="primary"
            isLoading={actionBusy === 'tick'}
            disabled={actionBusy !== null}
            onClick={() => runAction('tick')}
            aria-label={t('Run engine tick', 'تشغيل دورة المحرك')}
          >
            <RotateCw className="h-5 w-5" />
            <span>{t('Run Engine Tick', 'تشغيل دورة المحرك')}</span>
          </Button>
          <Button
            variant="outline"
            isLoading={actionBusy === 'train'}
            disabled={actionBusy !== null}
            onClick={() => runAction('train')}
            aria-label={t('Retrain model', 'إعادة تدريب النموذج')}
          >
            <Brain className="h-5 w-5" />
            <span>{t('Retrain Model', 'إعادة تدريب النموذج')}</span>
          </Button>
        </div>

        {actionResult && (
          <div
            className={`mt-4 flex animate-fade-in items-start gap-2 rounded-xl border p-3 ${
              actionResult.type === 'success' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
            }`}
            role="status"
          >
            <p className={`flex-1 text-sm font-medium ${actionResult.type === 'success' ? 'text-emerald-700' : 'text-rose-600'}`}>
              {actionResult.text}
            </p>
            <button
              type="button"
              onClick={() => setActionResult(null)}
              aria-label={t('Dismiss message', 'إخفاء الرسالة')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white/60 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </section>

      {/* ── Controlled Study (plan §27–32) ─────────────────────────────────── */}
      <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '200ms' }} aria-labelledby="intel-study-title">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal-100 bg-teal-50 text-teal-600">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <h3 id="intel-study-title" className="ms-serif text-lg font-semibold text-slate-900">
                {t('Controlled Study', 'الدراسة المحكمة')}
              </h3>
              <p className="ms-eyebrow mt-1">{t('Control vs Smart — plan §27', 'ذراع الضبط مقابل التدخل')}</p>
            </div>
          </div>
          <Button
            variant="outline"
            isLoading={studyBusy === 'export'}
            disabled={studyBusy !== null}
            onClick={() => exportStudyCsv()}
            aria-label={t('Export pseudonymized study dataset (CSV)', 'تصدير مجموعة بيانات الدراسة المجهولة (CSV)')}
          >
            <Download className="h-5 w-5" />
            <span>{t('Export Dataset (CSV)', 'تصدير البيانات (CSV)')}</span>
          </Button>
        </div>

        {!study ? (
          <p className="py-6 text-center text-sm font-medium text-slate-400">
            {t('Study data unavailable.', 'بيانات الدراسة غير متاحة.')}
          </p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {/* Arm assignment */}
              <div className="surface-inset p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-700">{t('Your arm', 'ذراعك في الدراسة')}</p>
                  <span
                    className={`chip-modern border font-bold ${
                      study.arm === 'smart'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
                    }`}
                  >
                    {study.arm === 'smart' ? t('Smart — extra reminders', 'التدخل — تذكير إضافي') : t('Control — standard reminders', 'الضبط — تذكيرات قياسية')}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  {language === 'ar' ? study.description?.ar : study.description?.en}
                </p>
                <p className="mt-2 text-[11px] text-slate-400">
                  {t(
                    `Assigned ${formatDateTime(study.assignedAt)} · participants: ${study.participants?.total ?? 0} (control ${study.participants?.control ?? 0} · smart ${study.participants?.smart ?? 0})`,
                    `التخصيص ${formatDateTime(study.assignedAt)} · المشاركون: ${study.participants?.total ?? 0} (ضبط ${study.participants?.control ?? 0} · تدخل ${study.participants?.smart ?? 0})`
                  )}
                </p>
              </div>

              {/* Primary outcome */}
              <div className="surface-inset p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-700">
                    {t('Primary outcome — high-risk unconfirmed rate', 'المحصلة الأساسية — نسبة عدم تأكيد الجرعات عالية المخاطر')}
                  </p>
                  <Scale className="h-4 w-4 shrink-0 text-teal-600" />
                </div>
                {!studyOutcomes?.primaryOutcome ? (
                  <p className="mt-2 text-xs text-slate-400">
                    {t('Outcome analysis unavailable.', 'تحليل المحصلات غير متاح.')}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {['control', 'smart'].map((arm) => {
                      const o = studyOutcomes.primaryOutcome[arm];
                      const label = arm === 'control' ? t('Control', 'الضبط') : t('Smart', 'التدخل');
                      return (
                        <div key={arm} className="flex items-center justify-between gap-3">
                          <span className="text-xs font-medium text-slate-600">{label}</span>
                          <span className="text-xs tabular-nums text-slate-500">
                            {o?.n > 0
                              ? `${(o.unconfirmedRate * 100).toFixed(1)}% (n=${o.n}) · 95% CI [${fmtCi(o.wilson95)}]`
                              : t('no resolved high-risk doses yet', 'لا جرعات عالية المخاطر محسومة بعد')}
                          </span>
                        </div>
                      );
                    })}
                    {(() => {
                      const d = studyOutcomes.primaryOutcome.difference;
                      return (
                        <div className="flex items-center justify-between gap-3 border-t border-slate-200/70 pt-2">
                          <span className="text-xs font-semibold text-slate-700">{t('Difference (Smart − Control)', 'الفرق (التدخل − الضبط)')}</span>
                          <span className="text-xs tabular-nums text-slate-600">
                            {d?.estimable
                              ? `${(d.value * 100).toFixed(1)}% · 95% CI [${fmtCi(d.ci95)}]`
                              : t('not estimable yet', 'غير قابل للتقدير بعد')}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Integrity + disclaimers */}
            <div className="mt-4 space-y-1.5">
              {studyOutcomes?.integrity && (
                <p className="text-[11px] font-medium text-emerald-600">
                  {t(
                    `Integrity check — EXTRA reminders delivered to the control arm: ${studyOutcomes.integrity.controlExtraSent ?? 0} (must be 0).`,
                    `فحص السلامة — تذكيرات إضافية سُلّمت لذراع الضبط: ${studyOutcomes.integrity.controlExtraSent ?? 0} (يجب أن تكون 0).`
                  )}
                </p>
              )}
              {(studyOutcomes?.disclaimer?.[language === 'ar' ? 'ar' : 'en'] ||
                t(
                  'Demo behavioural data — pipeline validation only, not clinical evidence.',
                  'بيانات سلوكية تجريبية — للتحقق من خط المعالجة فقط، وليست دليلاً سريرياً.'
                )) && (
                <p className="text-[11px] italic text-slate-400">
                  {studyOutcomes?.disclaimer?.[language === 'ar' ? 'ar' : 'en'] ??
                    t(
                      'Demo behavioural data — pipeline validation only, not clinical evidence.',
                      'بيانات سلوكية تجريبية — للتحقق من خط المعالجة فقط، وليست دليلاً سريرياً.'
                    )}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Reminder Ledger ─────────────────────────────────────────────────── */}
      <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '220ms' }} aria-labelledby="intel-ledger-title">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id="intel-ledger-title" className="ms-serif text-lg font-semibold text-slate-900">
              {t('Reminder Ledger', 'سجل التذكيرات')}
            </h3>
            <p className="ms-eyebrow mt-1">{t('Every engine decision, logged', 'كل قرار للمحرك، مسجّل')}</p>
          </div>
          <BellRing className="h-6 w-6 shrink-0 text-teal-600" />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="chip-modern border border-cyan-200/80 bg-cyan-50 text-cyan-700">
            {t('Logged', 'مسجّلة')}: {(reminderCounts.logged ?? 0).toLocaleString(locale)}
          </span>
          <span className="chip-modern chip-taken">
            {t('Sent', 'مُرسلة')}: {(reminderCounts.sent ?? 0).toLocaleString(locale)}
          </span>
          <span className="chip-modern bg-rose-50 text-rose-700 border border-rose-200/80">
            {t('Skipped', 'متجاوزة')}: {(reminderCounts.skipped ?? 0).toLocaleString(locale)}
          </span>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          {isLive
            ? t('The engine delivers reminders to your devices.', 'يرسل المحرك التذكيرات إلى أجهزتك.')
            : t(
                'In shadow mode the engine logs every decision without sending anything to the user.',
                'في الوضع الظلي يسجّل المحرك كل قرار دون إرسال أي شيء للمستخدم.'
              )}
        </p>

        {reminderRecent.length === 0 ? (
          <p className="py-8 text-center text-sm font-medium text-slate-400">
            {t('No reminder decisions logged yet.', 'لم تُسجّل أي قرارات تذكير بعد.')}
          </p>
        ) : (
          <div className="max-h-72 space-y-2.5 overflow-y-auto pe-1" role="list" aria-label={t('Recent reminder decisions', 'قرارات التذكير الأخيرة')}>
            {reminderRecent.map((r) => {
              const Icon = REMINDER_ICONS[r.type] || Bell;
              return (
                <div key={r.id} role="listitem" className="surface-inset flex items-start gap-3 p-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${REMINDER_TILES[r.type] || REMINDER_TILES.before}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {r.payload?.title || t('Reminder', 'تذكير')}
                    </p>
                    <p className="text-xs text-slate-500 line-clamp-2">{r.payload?.message}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="tabular-nums text-xs text-slate-500">{formatTime(r.scheduledAt)}</span>
                    <span className={`chip-modern border ${reminderStatusChip[r.status] || reminderStatusChip.logged}`}>
                      {reminderStatusLabel(r.status)}
                    </span>
                    {r.riskLevel && (
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${RISK_DOT[r.riskLevel] || RISK_DOT.low}`}
                        title={t(`${r.riskLevel} risk dose`, `جرعة بخطر ${r.riskLevel === 'high' ? 'مرتفع' : r.riskLevel === 'medium' ? 'متوسط' : 'منخفض'}`)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Dose Event History ──────────────────────────────────────────────── */}
      <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '260ms' }} aria-labelledby="intel-history-title">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h3 id="intel-history-title" className="ms-serif text-lg font-semibold text-slate-900">
              {t('Dose Event History', 'سجل أحداث الجرعات')}
            </h3>
            <p className="ms-eyebrow mt-1">{t('Most recent dose events', 'أحدث أحداث الجرعات')}</p>
          </div>
          <Activity className="h-6 w-6 shrink-0 text-cyan-600" />
        </div>

        {history.length === 0 ? (
          <p className="py-8 text-center text-sm font-medium text-slate-400">
            {t('No dose events recorded yet.', 'لم تُسجّل أي أحداث جرعات بعد.')}
          </p>
        ) : (
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto pe-1" role="list" aria-label={t('Dose event history', 'سجل أحداث الجرعات')}>
            {history.map((h) => (
              <div key={h.id} role="listitem" className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{h.medicationName}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(h.scheduledAt)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 sm:contents">
                  <span className={`justify-self-end ${doseChip[h.status] || 'chip-modern chip-pending'}`}>
                    {doseLabel(h.status)}
                  </span>
                  {h.delayMinutes > 0 && (
                    <span className="justify-self-end text-xs font-medium tabular-nums text-amber-600">
                      {t(`${h.delayMinutes}m late`, `متأخرة ${h.delayMinutes} دقيقة`)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Patterns ────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        {/* By Weekday */}
        <section className="glass-card p-5 sm:p-6 min-w-0 animate-fade-up" style={{ animationDelay: '300ms' }} aria-labelledby="intel-weekday-title">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 id="intel-weekday-title" className="ms-serif text-lg font-semibold text-slate-900">
                {t('By Weekday', 'حسب أيام الأسبوع')}
              </h3>
              <p className="ms-eyebrow mt-1">
                {t(`Confirmed vs missed · last ${windowDays} days`, `المؤكدة مقابل الفائتة · آخر ${windowDays} يوماً`)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2.5 text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                {t('Confirmed', 'مؤكدة')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                {t('Missed', 'فائتة')}
              </span>
            </div>
          </div>
          <div className="space-y-3">
            {byWeekday.length === 0 && (
              <p className="py-6 text-center text-sm font-medium text-slate-400">
                {t('No weekday patterns yet.', 'لا توجد أنماط أسبوعية بعد.')}
              </p>
            )}
            {byWeekday.map((d) => {
              const total = d.total || 0;
              const confPct = total > 0 ? (d.confirmed / total) * 100 : 0;
              const missPct = total > 0 ? (d.missed / total) * 100 : 0;
              return (
                <div key={d.day} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-xs font-medium text-slate-500">
                    {language === 'ar' ? (WEEKDAYS_AR[d.day] || d.day) : String(d.day || '').slice(0, 3)}
                  </span>
                  <div
                    className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200/70"
                    role="img"
                    aria-label={t(
                      `${d.day}: ${(d.confirmed || 0).toLocaleString(locale)} of ${total.toLocaleString(locale)} confirmed, ${(d.missed || 0).toLocaleString(locale)} missed`,
                      `${d.day}: ${(d.confirmed || 0).toLocaleString(locale)} من ${total.toLocaleString(locale)} مؤكدة، ${(d.missed || 0).toLocaleString(locale)} فائتة`
                    )}
                  >
                    <div className="h-full bg-emerald-500" style={{ width: `${confPct}%` }} />
                    <div className="h-full bg-rose-500" style={{ width: `${missPct}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-end text-xs tabular-nums text-slate-500">
                    {(d.confirmed || 0).toLocaleString(locale)}/{total.toLocaleString(locale)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* By Time Slot */}
        <section className="glass-card p-5 sm:p-6 min-w-0 animate-fade-up" style={{ animationDelay: '340ms' }} aria-labelledby="intel-slot-title">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 id="intel-slot-title" className="ms-serif text-lg font-semibold text-slate-900">
                {t('By Time Slot', 'حسب موعد الجرعة')}
              </h3>
              <p className="ms-eyebrow mt-1">
                {t(`Confirmed vs missed per daily slot`, `المؤكدة مقابل الفائتة لكل موعد يومي`)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2.5 text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                {t('Confirmed', 'مؤكدة')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                {t('Missed', 'فائتة')}
              </span>
            </div>
          </div>
          <div className="space-y-3">
            {bySlot.length === 0 && (
              <p className="py-6 text-center text-sm font-medium text-slate-400">
                {t('No time-slot patterns yet.', 'لا توجد أنماط مواعيد بعد.')}
              </p>
            )}
            {bySlot.map((s) => {
              const total = s.total || 0;
              const confPct = total > 0 ? (s.confirmed / total) * 100 : 0;
              const missPct = total > 0 ? (s.missed / total) * 100 : 0;
              return (
                <div key={s.slotTime} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-xs font-medium tabular-nums text-slate-500">{s.slotTime}</span>
                  <div
                    className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200/70"
                    role="img"
                    aria-label={t(
                      `${s.slotTime}: ${(s.confirmed || 0).toLocaleString(locale)} of ${total.toLocaleString(locale)} confirmed, ${(s.missed || 0).toLocaleString(locale)} missed`,
                      `${s.slotTime}: ${(s.confirmed || 0).toLocaleString(locale)} من ${total.toLocaleString(locale)} مؤكدة، ${(s.missed || 0).toLocaleString(locale)} فائتة`
                    )}
                  >
                    <div className="h-full bg-emerald-500" style={{ width: `${confPct}%` }} />
                    <div className="h-full bg-rose-500" style={{ width: `${missPct}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-end">
                    <span className="block text-xs tabular-nums text-slate-500">
                      {(s.confirmed || 0).toLocaleString(locale)}/{total.toLocaleString(locale)}
                    </span>
                    {typeof s.avgDelay === 'number' && s.avgDelay > 0 && (
                      <span className="block text-[10px] tabular-nums text-slate-400">
                        {t(`avg ${s.avgDelay.toLocaleString(locale)}m`, `متوسط ${s.avgDelay.toLocaleString(locale)} د`)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
