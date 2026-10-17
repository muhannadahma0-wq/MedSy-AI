import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  FlaskConical, ArrowLeft, RotateCw, Users, ShieldCheck, Pill, Activity,
  TrendingUp, AlertTriangle, AlertCircle, Info, Cpu, Timer,
  ThumbsUp, ThumbsDown, CheckCircle2, RefreshCw
} from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';
import { errorMessage } from '../lib/i18n';
import Button from '../components/Button';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

/**
 * Research Overview — the de-identified supervisor/researcher dashboard
 * (v5 review item 43).
 *
 * Standalone canvas page following the aiMonitoring.jsx pattern (bare
 * space-y-6 root, section-title header with back button, embedded-safe).
 * Renders the aggregates served by GET /api/research/overview:
 * participants + consent + study arms, 30-day dose mix, risk model
 * distribution, pre-ML data-quality checks and the per-agent AI operations
 * + feedback table.
 *
 * DE-IDENTIFICATION RED-LINE (mirrored from the API): only counts, rates,
 * versions and agent keys are displayed — never a user id, name, email or
 * message content.
 */

// Bilingual labels for the five agents that can appear in the AI table.
const AGENT_LABELS = {
  medical: ['Medical', 'طبي'],
  medicine: ['Medicine', 'أدوية'],
  'personal-health': ['Personal Health', 'الصحة الشخصية'],
  emergency: ['Emergency', 'طوارئ'],
  router: ['Smart Router', 'الموجّه الذكي'],
};

// null-safe number helpers (aiMonitoring convention)
const fmtInt = (v, locale) =>
  typeof v === 'number' && isFinite(v) ? v.toLocaleString(locale) : '—';
const fmtPct = (v, locale) =>
  typeof v === 'number' && isFinite(v)
    ? `${v.toLocaleString(locale, { maximumFractionDigits: 1 })}%`
    : '—';
// 1234 → "1.23 s" · 210 → "210 ms"
const fmtMs = (v, locale, secLabel = 's') => {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  return v >= 1000
    ? `${(v / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} ${secLabel}`
    : `${v.toLocaleString(locale)} ms`;
};

// Flat tinted stat-card tile (shared Rhythm v4 pattern).
const StatCard = ({ title, value, subtitle, icon: Icon, color = 'emerald', style }) => {
  const colorMap = {
    emerald: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
    teal: 'bg-teal-50 border border-teal-100 text-teal-600',
    amber: 'bg-amber-50 border border-amber-100 text-amber-600',
    rose: 'bg-rose-50 border border-rose-100 text-rose-600',
    slate: 'bg-slate-100 border border-slate-200 text-slate-500',
  };
  return (
    <div className="glass-card glass-card-hover p-5 animate-fade-up" style={style}>
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${colorMap[color]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-2xl font-bold tabular-nums text-slate-900 sm:text-3xl">{value}</p>
      <p className="mt-1 text-sm font-semibold text-slate-600">{title}</p>
      {subtitle && <p className="mt-0.5 text-xs font-medium text-slate-400">{subtitle}</p>}
    </div>
  );
};

// One labelled horizontal bar (pure CSS/flex — no chart library).
// `fill` is 0–100; the bar grows from the inline-start edge so RTL works.
const BarRow = ({ label, count, total, barClass, textClass }) => (
  <div className="flex items-center gap-3">
    <span className="w-20 shrink-0 text-xs font-semibold text-slate-600 sm:w-24">{label}</span>
    <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <span
        className={`absolute inset-y-0 start-0 rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${barClass}`}
        style={{ width: `${total > 0 ? Math.max((count / total) * 100, count > 0 ? 1.5 : 0) : 0}%` }}
      />
    </span>
    <span className={`w-14 shrink-0 text-end text-xs font-bold tabular-nums ${textClass}`}>
      {count}
    </span>
  </div>
);

export default function ResearchOverview() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const locale = language === 'ar' ? 'ar' : 'en-US';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null); // { status, code, message }
  const [authFailed, setAuthFailed] = useState(false);

  const formatDateTime = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  };

  // Loader — authenticated fetch (Bearer, same JWT pattern as the sibling
  // dashboard pages). 401 → redirect to /login (ProtectedRoute semantics).
  // NOTE: no synchronous setState in this function's body (the refresh
  // spinner is set by the refresh button handler) so the effect below stays
  // clean under react-hooks/set-state-in-effect.
  const loadData = useCallback((isRefresh = false) => {
    fetch('/api/research/overview', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
      .then(async (res) => {
        if (res.status === 401) {
          throw Object.assign(new Error('unauthorized'), { status: 401 });
        }
        if (!res.ok) {
          // Error body is optional here — degrade to a status-only error.
          let code = null;
          let message = null;
          try {
            const body = await res.clone().json();
            code = body?.error?.code || null;
            message = body?.error?.message || body?.message || null;
          } catch {
            /* non-JSON body */
          }
          throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, code, message });
        }
        return res.json();
      })
      .then((apiData) => {
        if (!apiData || apiData.success === false) {
          throw Object.assign(new Error('Unexpected response'), { code: apiData?.error?.code });
        }
        setData(apiData);
        setError(null);
        setLoading(false);
        setRefreshing(false);
      })
      .catch((err) => {
        console.error('[research] overview failed:', err?.message);
        if (err?.status === 401) {
          setAuthFailed(true);
          setRefreshing(false);
          return;
        }
        setLoading(false);
        setRefreshing(false);
        setError({
          status: err?.status ?? 0,
          code: err?.code ?? null,
          message: errorMessage(
            err?.code,
            err?.message || t('Could not load the research overview.', 'تعذّر تحميل نظرة البحث.'),
            language
          ),
        });
      });
  }, [t, language]);

  // Manual refresh — sets the spinner HERE (outside loadData) so the mount
  // effect never triggers a synchronous state update.
  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    loadData(true);
  };

  // Load on mount. (The rule config keeps exhaustive-deps off across this
  // codebase — aiMonitoring.jsx pattern; loadData is stable per mount.)
  useEffect(() => {
    loadData();
  }, []);

  // ── Loading skeleton (mirrors the section layout) ──────────────────────
  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <span className="sr-only">{t('Loading research overview...', 'جارٍ تحميل نظرة البحث...')}</span>
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 animate-pulse rounded-xl bg-white/10" />
          <div className="space-y-2">
            <div className="h-6 w-72 animate-pulse rounded-lg bg-white/10" />
            <div className="h-3 w-56 animate-pulse rounded bg-white/5" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-[20px] bg-white/5" />
          ))}
        </div>
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-[20px] bg-white/5" />
          <div className="h-64 animate-pulse rounded-[20px] bg-white/5" />
        </div>
        <div className="h-56 animate-pulse rounded-[20px] bg-white/5" />
        <div className="h-72 animate-pulse rounded-[20px] bg-white/5" />
      </div>
    );
  }

  // ── 401 → login (ProtectedRoute semantics; the API aggregates are
  //     authenticated — anonymous visitors have nothing to see here) ──────
  if (authFailed) {
    return <Navigate to="/login" replace />;
  }

  // ── Error state (retry) ─────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="glass-card max-w-md p-8 text-center animate-fade-up">
          <AlertCircle className="mx-auto mb-4 h-14 w-14 text-rose-500" />
          <p className="text-lg font-semibold text-slate-900">
            {t('Something went wrong', 'حدث خطأ ما')}
          </p>
          <p className="mt-2 text-sm text-slate-500">{error.message}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" onClick={() => loadData(true)}>
              <RotateCw className="h-5 w-5" />
              <span>{t('Retry', 'إعادة المحاولة')}</span>
            </Button>
            <Button variant="outline" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
              <span>{t('Back to Dashboard', 'العودة للوحة التحكم')}</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // ── Derived data (null-safe) ────────────────────────────────────────────
  const ov = data.overview || data; // contract: {success, overview}; tolerate flat
  const participants = ov.participants || {};
  const doses = ov.doses || {};
  const risk = ov.risk || {};
  const dataQuality = ov.dataQuality || {};
  const ai = ov.ai || {};
  const perAgent = Array.isArray(ai.perAgent) ? ai.perAgent : [];
  const byStatus = doses.byStatus || {};
  const riskBuckets = risk.riskBuckets || {};
  const modelVersion = risk.modelVersion || {};

  const doseTotal = doses.total ?? 0;
  const statusRows = [
    { key: 'taken', bar: 'bg-emerald-500', text: 'text-emerald-700' },
    { key: 'delayed', bar: 'bg-amber-500', text: 'text-amber-700' },
    { key: 'missed', bar: 'bg-red-500', text: 'text-red-700' },
    { key: 'skipped', bar: 'bg-slate-400', text: 'text-slate-600' },
    { key: 'pending', bar: 'bg-slate-300', text: 'text-slate-500' },
  ];
  const bucketMeta = [
    { key: '0-0.2', bar: 'bg-emerald-500', text: 'text-emerald-700' },
    { key: '0.2-0.4', bar: 'bg-teal-500', text: 'text-teal-700' },
    { key: '0.4-0.6', bar: 'bg-amber-500', text: 'text-amber-700' },
    { key: '0.6-0.8', bar: 'bg-orange-500', text: 'text-orange-700' },
    { key: '0.8-1.0', bar: 'bg-red-500', text: 'text-red-700' },
  ];
  const bucketTotal = bucketMeta.reduce((sum, b) => sum + (Number(riskBuckets[b.key]) || 0), 0);

  const qualityChecks = [
    { key: 'missingTimestamps' },
    { key: 'duplicateDoses' },
    { key: 'invalidRiskScores' },
    { key: 'unknownModelVersion' },
    { key: 'timezoneMismatch' },
    { key: 'missingArm' },
  ];
  const qualityLabels = {
    missingTimestamps: t('Dose events with missing timestamps', 'أحداث جرعات بلا طابع زمني'),
    duplicateDoses: t('Duplicate taken doses', 'جرعات مؤكَّدة مكررة'),
    invalidRiskScores: t('Invalid risk scores', 'درجات خطورة غير صالحة'),
    unknownModelVersion: t('Predictions from an unknown model version', 'تنبؤات من إصدار نموذج غير معروف'),
    timezoneMismatch: t('Timezone mismatches', 'تعارضات المنطقة الزمنية'),
    missingArm: t('Dose data without a study arm', 'بيانات جرعات بلا ذراع دراسي'),
  };

  const agentLabel = (key) => {
    const pair = AGENT_LABELS[key];
    return pair ? t(pair[0], pair[1]) : key;
  };

  const secLabel = t('s', 'ث');

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="relative z-20 flex flex-col gap-4 animate-fade-up lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            aria-label={t('Go back', 'الرجوع')}
            className="group rounded-xl p-3 text-slate-300 transition-all hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-6 w-6 transition-transform rtl:rotate-180 ltr:group-hover:-translate-x-1 rtl:group-hover:translate-x-1" />
          </button>
          <div>
            <p className="ms-eyebrow-canvas">{t('Supervisor view', 'عرض المشرف')}</p>
            <h1 className="section-title flex flex-wrap items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 shadow-sm">
                <FlaskConical className="h-6 w-6 text-white" />
              </span>
              {t('Research overview', 'نظرة البحث')}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {/* De-identification notice — the red-line of this page */}
              <span className="chip-modern border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {t(
                    'De-identified aggregate data only — no personal identifiers',
                    'بيانات مجمّعة مجهّلة الهوية فقط — دون أي معرّفات شخصية'
                  )}
                </span>
              </span>
              <span className="chip-modern border border-white/10 bg-white/5 text-slate-300">
                <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('Last 30 days', 'آخر 30 يوماً')}</span>
              </span>
              <span className="chip-modern border border-white/10 bg-white/5 text-slate-400">
                {t('Generated', 'مُولَّد')}: {formatDateTime(ov.generatedAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-ghost-dark min-h-[44px] px-3 text-sm disabled:opacity-60"
            aria-label={t('Refresh research data', 'تحديث بيانات البحث')}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="hidden sm:inline">{refreshing ? t('Refreshing…', 'جارٍ التحديث…') : t('Refresh', 'تحديث')}</span>
          </button>
          <LanguageSwitcher />
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={Users}
          color="emerald"
          title={t('Participants', 'المشاركون')}
          value={fmtInt(participants.total, locale)}
          subtitle={t('assignment + consent records', 'سجلات الإسناد والموافقة')}
          style={{ animationDelay: '40ms' }}
        />
        <StatCard
          icon={ShieldCheck}
          color="teal"
          title={t('Active consent', 'موافقة سارية')}
          value={fmtInt(participants.consented, locale)}
          subtitle={
            (participants.revokedConsent ?? 0) > 0
              ? t(`${participants.revokedConsent} revoked`, `${participants.revokedConsent} موافقة ملغاة`)
              : t('none revoked', 'لا إلغاءات')
          }
          style={{ animationDelay: '80ms' }}
        />
        <StatCard
          icon={Activity}
          color="amber"
          title={t('Effective arms (C / S)', 'الأذرع الفعّالة (ض / ذ)')}
          value={`${fmtInt(participants.effectiveByArm?.control, locale)} / ${fmtInt(participants.effectiveByArm?.smart, locale)}`}
          subtitle={t('consent-gated: control · smart', 'ببوابة الموافقة: ضابط · ذكي')}
          style={{ animationDelay: '120ms' }}
        />
        <StatCard
          icon={Pill}
          color="rose"
          title={t('Doses (30d)', 'الجرعات (30 يوماً)')}
          value={fmtInt(doseTotal, locale)}
          subtitle={t('scheduled dose events', 'أحداث جرعات مجدولة')}
          style={{ animationDelay: '160ms' }}
        />
        <StatCard
          icon={TrendingUp}
          color="emerald"
          title={t('Confirmation rate', 'نسبة التأكيد')}
          value={
            doses.confirmationRate === null || doses.confirmationRate === undefined
              ? '—'
              : `${(doses.confirmationRate * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`
          }
          subtitle={t('taken ÷ final outcomes', 'المأخوذة ÷ النتائج النهائية')}
          style={{ animationDelay: '200ms' }}
        />
        <StatCard
          icon={Cpu}
          color={risk.mlAvailability ? 'emerald' : 'slate'}
          title={t('ML availability', 'توفر التعلّم الآلي')}
          value={risk.mlAvailability ? t('Active', 'نشط') : t('Unavailable', 'غير متاح')}
          subtitle={
            risk.mlAvailability
              ? t('risk model serving predictions', 'نموذج الخطورة يصدر تنبؤات')
              : t('no active model artifact', 'لا يوجد نموذج نشط')
          }
          style={{ animationDelay: '240ms' }}
        />
      </div>

      {/* ── Doses + Risk (two columns ≥lg) ─────────────────────────────────── */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        {/* Dose status mix — labelled horizontal CSS bars */}
        <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '120ms' }} aria-labelledby="research-doses-title">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
              <Pill className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div>
              <h2 id="research-doses-title" className="ms-serif text-base font-semibold text-slate-900">
                {t('Dose outcomes', 'نتائج الجرعات')}
              </h2>
              <p className="text-xs text-slate-400">
                {t(`${fmtInt(doseTotal, locale)} scheduled doses in the last 30 days`, `${fmtInt(doseTotal, locale)} جرعة مجدولة خلال آخر 30 يوماً`)}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {statusRows.map((row) => (
              <BarRow
                key={row.key}
                label={t(
                  { taken: 'Taken', delayed: 'Delayed', missed: 'Missed', skipped: 'Skipped', pending: 'Pending' }[row.key],
                  { taken: 'مأخوذة', delayed: 'مؤجَّلة', missed: 'فائتة', skipped: 'متروكة', pending: 'قيد الانتظار' }[row.key]
                )}
                count={Number(byStatus[row.key]) || 0}
                total={doseTotal}
                barClass={row.bar}
                textClass={row.text}
              />
            ))}
          </div>
        </section>

        {/* Risk distribution — 5 severity buckets + model chips */}
        <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '160ms' }} aria-labelledby="research-risk-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600">
                <TrendingUp className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <div>
                <h2 id="research-risk-title" className="ms-serif text-base font-semibold text-slate-900">
                  {t('Risk score distribution', 'توزيع درجات الخطورة')}
                </h2>
                <p className="text-xs text-slate-400">
                  {t(
                    `${fmtInt(risk.predictionsLast30d, locale)} predictions in the last 30 days`,
                    `${fmtInt(risk.predictionsLast30d, locale)} تنبؤاً خلال آخر 30 يوماً`
                  )}
                </p>
              </div>
            </div>
            <span
              className={`chip-modern border ${
                (risk.highRiskShare ?? 0) >= 0.2
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {t('High risk', 'خطورة عالية')}:{' '}
                {risk.highRiskShare === null || risk.highRiskShare === undefined
                  ? '—'
                  : `${(risk.highRiskShare * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`}
              </span>
            </span>
          </div>
          <div className="space-y-3">
            {bucketMeta.map((b) => (
              <BarRow
                key={b.key}
                label={b.key.replace('-', '–')}
                count={Number(riskBuckets[b.key]) || 0}
                total={bucketTotal}
                barClass={b.bar}
                textClass={b.text}
              />
            ))}
          </div>
          {(modelVersion.version || modelVersion.modelType) && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {t('Active model', 'النموذج النشط')}:
              </span>
              {modelVersion.version && (
                <span className="chip-modern border border-slate-200 bg-slate-50 text-slate-600" dir="ltr">
                  v{modelVersion.version}
                </span>
              )}
              {modelVersion.modelType && (
                <span className="chip-modern border border-slate-200 bg-slate-50 text-slate-600" dir="ltr">
                  {modelVersion.modelType}
                </span>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Data quality (v5 item 44) — pre-ML checklist ───────────────────── */}
      <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '200ms' }} aria-labelledby="research-quality-title">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-teal-100 bg-teal-50 text-teal-600">
            <ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div>
            <h2 id="research-quality-title" className="ms-serif text-base font-semibold text-slate-900">
              {t('Data quality checks', 'فحوص جودة البيانات')}
            </h2>
            <p className="text-xs text-slate-400">
              {t('Pre-processing integrity checks over the study dataset', 'فحوص سلامة قبل المعالجة على بيانات الدراسة')}
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {qualityChecks.map((check) => {
            const count = Number(dataQuality[check.key]) || 0;
            const pass = count === 0;
            return (
              <div
                key={check.key}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                  pass ? 'border-emerald-200/70 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/70'
                }`}
              >
                {pass ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 text-xs font-medium text-slate-700">{qualityLabels[check.key]}</span>
                <span
                  className={`chip-modern shrink-0 ${
                    pass
                      ? 'border border-emerald-200 bg-white text-emerald-700'
                      : 'border border-amber-300 bg-white text-amber-700'
                  }`}
                >
                  {pass ? t('Pass', 'سليم') : t(`${count} found`, `${count} حالة`)}
                </span>
                <span className="sr-only">
                  {pass ? t('Check passed', 'الفحص ناجح') : t('Check failed', 'الفحص راسب')}
                </span>
              </div>
            );
          })}
        </div>
        {dataQuality.timezoneNote && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('Timezone note', 'ملاحظة المنطقة الزمنية')}: {dataQuality.timezoneNote}</span>
          </p>
        )}
      </section>

      {/* ── AI operations + feedback (30d) ─────────────────────────────────── */}
      <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '240ms' }} aria-labelledby="research-ai-title">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
            <FlaskConical className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div>
            <h2 id="research-ai-title" className="ms-serif text-base font-semibold text-slate-900">
              {t('AI agents & feedback', 'وكلاء الذكاء والملاحظات')}
            </h2>
            <p className="text-xs text-slate-400">
              {t('Requests, safety interventions and the 👍/👎/⚠️ feedback mix (30d)', 'الطلبات والتدخلات الأمنية وتوزيع الملاحظات 👍/👎/⚠️ (30 يوماً)')}
            </p>
          </div>
        </div>
        {perAgent.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            {t('No AI activity recorded in this window yet.', 'لا يوجد نشاط ذكاء اصطناعي مسجَّل في هذه الفترة بعد.')}
          </p>
        ) : (
          <>
            {/* Mobile: stacked per-agent cards (RTL-safe — a wide table in an
                RTL page propagates its left overflow to the document scroll
                area even inside overflow-x-auto, so small screens get cards). */}
            <ul className="space-y-3 md:hidden">
              {perAgent.map((row) => (
                <li key={row.agent} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="chip-modern border border-emerald-200/80 bg-emerald-50 text-emerald-700">
                      {agentLabel(row.agent)}
                    </span>
                    <span className="text-xs tabular-nums text-slate-500">{fmtMs(row.avgLatencyMs, locale, secLabel)}</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500">{t('Requests', 'الطلبات')}</dt>
                      <dd className="font-semibold tabular-nums text-slate-800">{fmtInt(row.requests30d, locale)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500">{t('Success', 'النجاح')}</dt>
                      <dd className="font-semibold tabular-nums text-emerald-700">{fmtPct(row.successRate, locale)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500">{t('Fallback', 'الاحتياط')}</dt>
                      <dd className="font-semibold tabular-nums text-amber-700">{fmtPct(row.fallbackRate, locale)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500">{t('Handoffs', 'التحويلات')}</dt>
                      <dd className="font-semibold tabular-nums text-slate-600">{fmtInt(row.handoffCount, locale)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500">{t('Safety blocks', 'حظر أمني')}</dt>
                      <dd className="font-semibold tabular-nums text-rose-700">{fmtInt(row.safetyBlocks, locale)}</dd>
                    </div>
                    <div className="col-span-2 flex items-center justify-between gap-2 border-t border-slate-200 pt-1.5">
                      <dt className="text-slate-500">{t('Feedback', 'الملاحظات')}</dt>
                      <dd className="flex items-center gap-3 font-bold tabular-nums">
                        <span className="inline-flex items-center gap-1 text-emerald-700"><ThumbsUp className="h-3 w-3" aria-hidden="true" />{fmtInt(row.feedback?.helpful, locale)}</span>
                        <span className="inline-flex items-center gap-1 text-amber-700"><ThumbsDown className="h-3 w-3" aria-hidden="true" />{fmtInt(row.feedback?.unhelpful, locale)}</span>
                        <span className="inline-flex items-center gap-1 text-rose-700"><AlertTriangle className="h-3 w-3" aria-hidden="true" />{fmtInt(row.feedback?.unsafe, locale)}</span>
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            {/* Desktop (md+): the full table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
              <caption className="sr-only">
                {t('Per-agent AI operations and feedback in the last 30 days', 'عمليات الوكلاء وملاحظاتهم خلال آخر 30 يوماً')}
              </caption>
              <thead>
                <tr className="border-b border-slate-200 text-start text-xs uppercase tracking-wide text-slate-400">
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">{t('Agent', 'الوكيل')}</th>
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">{t('Requests', 'الطلبات')}</th>
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">{t('Success', 'النجاح')}</th>
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">{t('Fallback', 'الاحتياط')}</th>
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">{t('Handoffs', 'التحويلات')}</th>
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">{t('Safety blocks', 'حظر أمني')}</th>
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">{t('Avg latency', 'متوسط الاستجابة')}</th>
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">
                    <span className="sr-only">{t('Helpful feedback', 'ملاحظات مفيدة')}</span>
                    <span aria-hidden="true">👍</span>
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">
                    <span className="sr-only">{t('Unhelpful feedback', 'ملاحظات غير مفيدة')}</span>
                    <span aria-hidden="true">👎</span>
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-start font-semibold">
                    <span className="sr-only">{t('Unsafe feedback', 'ملاحظات غير آمنة')}</span>
                    <span aria-hidden="true">⚠️</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {perAgent.map((row) => (
                  <tr key={row.agent} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="px-2 py-3 text-start">
                      <span className="chip-modern border border-emerald-200/80 bg-emerald-50 text-emerald-700">
                        {agentLabel(row.agent)}
                      </span>
                    </th>
                    <td className="px-2 py-3 font-semibold tabular-nums text-slate-800">{fmtInt(row.requests30d, locale)}</td>
                    <td className="px-2 py-3 tabular-nums text-emerald-700">{fmtPct(row.successRate, locale)}</td>
                    <td className="px-2 py-3 tabular-nums text-amber-700">{fmtPct(row.fallbackRate, locale)}</td>
                    <td className="px-2 py-3 tabular-nums text-slate-600">{fmtInt(row.handoffCount, locale)}</td>
                    <td className="px-2 py-3 tabular-nums text-rose-700">{fmtInt(row.safetyBlocks, locale)}</td>
                    <td className="px-2 py-3 tabular-nums text-slate-600">{fmtMs(row.avgLatencyMs, locale, secLabel)}</td>
                    <td className="px-2 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-emerald-700">
                        <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                        {fmtInt(row.feedback?.helpful, locale)}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-amber-700">
                        <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                        {fmtInt(row.feedback?.unhelpful, locale)}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-rose-700">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        {fmtInt(row.feedback?.unsafe, locale)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>
  );
}
