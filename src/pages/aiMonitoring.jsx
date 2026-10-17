import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Gauge, ArrowLeft, RotateCw, Brain, Pill, Heart, Activity, Eye, FileText,
  ShieldCheck, ArrowLeftRight, Timer, Zap, Bot, CheckCircle, X, ArrowRight,
  AlertCircle, Cpu, Sparkles
} from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';
import Button from '../components/Button';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

/**
 * AI Monitoring — the AI Agent Dashboard (spec §45).
 *
 * Standalone canvas page following the intelligence.jsx pattern (bare
 * space-y-6 root, section-title header with back button, embedded-safe):
 * it renders the per-agent gateway operations feed served by
 * /api/ai-monitoring — provider chains, request/success/fallback KPIs,
 * latency, handoffs, safety interventions, the agent capabilities matrix
 * and the recent activity log.
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

// Analysis window presets — hours map 1:1 onto the API query param.
const WINDOWS = [
  { id: 24, label: ['24h', '24 ساعة'] },
  { id: 168, label: ['7d', '7 أيام'] },
  { id: 720, label: ['30d', '30 يوماً'] },
];

// Per-agent icon tiles (light tinted tiles inside the white cards).
const AGENT_ICONS = {
  medical: Brain,
  medicine: Pill,
  'personal-health': Heart,
  emergency: Activity,
  'vision-medication': Eye,
  'vision-report': FileText,
};
const AGENT_TILES = {
  medical: 'border border-emerald-100 bg-emerald-50 text-emerald-600',
  medicine: 'border border-cyan-100 bg-cyan-50 text-cyan-600',
  'personal-health': 'border border-rose-100 bg-rose-50 text-rose-600',
  emergency: 'border border-amber-100 bg-amber-50 text-amber-600',
  'vision-medication': 'border border-teal-100 bg-teal-50 text-teal-600',
  'vision-report': 'border border-slate-200 bg-slate-100 text-slate-600',
};
// Short bilingual chips for the recent-activity rows (system agent keys).
const AGENT_CHIP_LABELS = {
  medical: ['Medical', 'طبي'],
  medicine: ['Medicine', 'أدوية'],
  'personal-health': ['Personal Health', 'الصحة الشخصية'],
  emergency: ['Emergency', 'طوارئ'],
  'vision-medication': ['Vision · Med', 'رؤية · دواء'],
  'vision-report': ['Vision · Report', 'رؤية · تقرير'],
  router: ['Smart Router', 'الموجّه الذكي'],
};
const AGENT_CHIP_STYLES = {
  medical: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
  medicine: 'bg-cyan-50 text-cyan-700 border border-cyan-200/80',
  'personal-health': 'bg-rose-50 text-rose-700 border border-rose-200/80',
  emergency: 'bg-amber-50 text-amber-700 border border-amber-200/80',
  'vision-medication': 'bg-teal-50 text-teal-700 border border-teal-200/80',
  'vision-report': 'bg-slate-100 text-slate-600 border border-slate-200',
  router: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
};

// Provider-chain chip roles: primary (emerald) → secondary (slate) →
// fallback (amber). Brand names stay untranslated.
const PROVIDER_LABELS = {
  'groq': 'Groq',
  'gemini': 'Gemini',
  'zai-glm': 'Z.ai GLM',
};

// Capabilities-matrix column headers (system column keys → display).
const MATRIX_COLUMN_LABELS = {
  medical: ['Medical', 'طبي'],
  emergency: ['Emergency', 'طوارئ'],
  medicine: ['Medicine', 'أدوية'],
  'personal-health': ['Personal Health', 'الصحة الشخصية'],
};

// Capability row labels (system capability keys → bilingual display).
const CAPABILITY_LABELS = {
  general_medical_knowledge: ['General medical knowledge', 'معرفة طبية عامة'],
  medication_information: ['Medication information', 'معلومات الأدوية'],
  drug_interaction: ['Drug interactions', 'تفاعلات الأدوية'],
  dose_schedule: ['Dose schedule', 'جدول الجرعات'],
  adherence_history: ['Adherence history', 'سجل الالتزام'],
  user_health_profile: ['User health profile', 'الملف الصحي للمستخدم'],
  lab_report_explanation: ['Lab report explanation', 'شرح التقارير المخبرية'],
  emergency_triage: ['Emergency triage', 'فرز الطوارئ'],
  change_medication: ['Change medication', 'تغيير الدواء'],
  diagnose_disease: ['Diagnose disease', 'تشخيص المرض'],
};

// null-safe number helpers
const fmtInt = (v, locale) =>
  typeof v === 'number' && isFinite(v) ? v.toLocaleString(locale) : '—';
const fmtPct = (v, locale) =>
  typeof v === 'number' && isFinite(v)
    ? `${v.toLocaleString(locale, { maximumFractionDigits: 1 })}%`
    : '—';
// 1234 → "1.23 s" · 210 → "210 ms" (seconds unit is localized by the caller)
const fmtMs = (v, locale, secLabel = 's') => {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  return v >= 1000
    ? `${(v / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} ${secLabel}`
    : `${v.toLocaleString(locale)} ms`;
};

// Flat tinted stat-card tile (Rhythm v4 pattern shared with intelligence).
const StatCard = ({ title, value, subtitle, icon: Icon, color = 'emerald', accent = false, style }) => {
  const colorMap = {
    emerald: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
    cyan: 'bg-cyan-50 border border-cyan-100 text-cyan-600',
    teal: 'bg-teal-50 border border-teal-100 text-teal-600',
    amber: 'bg-amber-50 border border-amber-100 text-amber-600',
    rose: 'bg-rose-50 border border-rose-100 text-rose-600',
  };
  return (
    <div className="glass-card glass-card-hover p-5 sm:p-6 animate-fade-up" style={style}>
      <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${colorMap[color]}`}>
        <Icon className="h-6 w-6" />
      </div>
      <p className={`text-3xl font-bold tabular-nums ${accent ? 'text-gradient' : 'text-slate-900'}`}>{value}</p>
      <p className="mt-1 text-sm font-semibold text-slate-600">{title}</p>
      {subtitle && <p className="mt-0.5 text-xs font-medium text-slate-400">{subtitle}</p>}
    </div>
  );
};

export default function AIMonitoring() {
  const navigate = useNavigate();
  const { t, language, isRTL } = useLanguage();
  const locale = language === 'ar' ? 'ar' : 'en-US';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true); // first load → full skeleton
  const [refreshing, setRefreshing] = useState(false); // window change / manual refresh
  const [error, setError] = useState(null); // { status, message }
  const [windowHours, setWindowHours] = useState(168);

  // Locale-aware date formatting with Invalid-Date guards.
  const formatDateTime = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
  };
  // Compact relative time ("5m ago") for the activity feed.
  const formatRelative = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return t('just now', 'الآن');
    if (mins < 60) return t(`${mins}m ago`, `قبل ${mins} دقيقة`);
    if (mins < 1440) return t(`${Math.floor(mins / 60)}h ago`, `قبل ${Math.floor(mins / 60)} ساعة`);
    return formatDateTime(iso);
  };

  // Loader — authenticated fetch (Bearer); hours follows the window selector.
  const loadData = useCallback((hours, isRefresh = false) => {
    const uid = getUserId();
    if (!uid) {
      // No signed-in user → 401-style error state with a sign-in action.
      setTimeout(() => {
        setLoading(false);
        setRefreshing(false);
        setError({ status: 401, message: t('Session expired — please sign in again.', 'انتهت الجلسة — يرجى تسجيل الدخول مجدداً.') });
      }, 0);
      return;
    }
    if (isRefresh) setRefreshing(true);
    fetch(`/api/ai-monitoring?hours=${hours}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
      .then(async (res) => {
        if (res.status === 401) {
          throw Object.assign(new Error('unauthorized'), { status: 401 });
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((apiData) => {
        if (!apiData || apiData.success === false) {
          throw new Error(apiData?.error || 'Unexpected response');
        }
        setData(apiData);
        setError(null);
        setLoading(false);
        setRefreshing(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
        setRefreshing(false);
        setError({
          status: err?.status ?? 0,
          message:
            err?.status === 401
              ? t('Session expired — please sign in again.', 'انتهت الجلسة — يرجى تسجيل الدخول مجدداً.')
              : t(
                  `Could not load AI monitoring data (${err.message}).`,
                  `تعذّر تحميل بيانات مراقبة الذكاء الاصطناعي (${err.message}).`
                ),
        });
      });
  }, [t]);

  // Load on mount and whenever the analysis window changes. (The rule config
  // keeps exhaustive-deps off across this codebase — intelligence.jsx pattern.)
  useEffect(() => {
    loadData(windowHours, !loading && data !== null);
  }, [windowHours]);

  const changeWindow = (hours) => {
    if (hours === windowHours) return;
    setWindowHours(hours);
  };

  // ── Loading skeleton (mirrors the card layout) ──────────────────────────
  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <span className="sr-only">{t('Loading AI monitoring data...', 'جارٍ تحميل بيانات المراقبة...')}</span>
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 animate-pulse rounded-xl bg-white/10" />
          <div className="space-y-2">
            <div className="h-6 w-72 animate-pulse rounded-lg bg-white/10" />
            <div className="h-3 w-56 animate-pulse rounded bg-white/5" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-[20px] bg-white/5" />
          ))}
        </div>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-[20px] bg-white/5" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-[20px] bg-white/5" />
      </div>
    );
  }

  // ── Error state (401 → sign-in action; otherwise retry) ─────────────────
  if (error) {
    const isAuth = error.status === 401;
    return (
      <div className="flex items-center justify-center py-16">
        <div className="glass-card max-w-md p-8 text-center animate-fade-up">
          <AlertCircle className="mx-auto mb-4 h-14 w-14 text-rose-500" />
          <p className="text-lg font-semibold text-slate-900">
            {isAuth
              ? t('Session expired', 'انتهت الجلسة')
              : t('Something went wrong', 'حدث خطأ ما')}
          </p>
          <p className="mt-2 text-sm text-slate-500">{error.message}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {isAuth ? (
              <Button variant="primary" onClick={() => navigate('/login')}>
                <span>{t('Sign In', 'تسجيل الدخول')}</span>
              </Button>
            ) : (
              <Button variant="primary" onClick={() => loadData(windowHours, true)}>
                <RotateCw className="h-5 w-5" />
                <span>{t('Retry', 'إعادة المحاولة')}</span>
              </Button>
            )}
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

  // ── Derived data (null-safe) ─────────────────────────────────────────────
  const agents = Array.isArray(data.agents) ? data.agents : [];
  const totals = data.totals || {};
  const recent = Array.isArray(data.recent) ? data.recent : [];
  const matrix = data.capabilitiesMatrix || {};
  const matrixColumns = Array.isArray(matrix.columns) ? matrix.columns : [];
  const matrixRows = Array.isArray(matrix.rows) ? matrix.rows : [];
  const windowLabel =
    WINDOWS.find((w) => w.id === (data.windowHours || windowHours))?.label || ['', ''];
  const hasActivity = (totals.requests ?? 0) > 0 || recent.length > 0;

  // Display-name lookup for recent rows (agents array carries bilingual names).
  const displayByAgent = agents.reduce((acc, a) => {
    acc[a.agent] = a.display;
    return acc;
  }, {});
  const agentChipLabel = (key) => {
    const d = displayByAgent[key] || AGENT_CHIP_LABELS[key];
    if (d && d.en && d.ar) return language === 'ar' ? d.ar : d.en;
    const fallback = AGENT_CHIP_LABELS[key];
    return fallback ? t(fallback[0], fallback[1]) : key;
  };

  // Safety badge for an activity row: emergency_priority → rose,
  // tool_denied / anything else non-ok → amber, ok → emerald.
  const safetyBadge = (row) => {
    const s = row.safetyResult;
    if (!s) return null;
    if (s.startsWith('emergency_priority')) {
      return {
        cls: 'bg-rose-50 text-rose-700 border border-rose-200/80',
        label: t('emergency priority', 'أولوية طوارئ'),
      };
    }
    if (s === 'ok') {
      return { cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80', label: t('ok', 'سليم') };
    }
    return {
      cls: 'bg-amber-50 text-amber-700 border border-amber-200/80',
      label: s === 'tool_denied' ? t('tool denied', 'أداة مرفوضة') : s,
    };
  };

  // Capabilities-matrix cell renderer (bilingual-friendly, RTL-safe icons).
  const MatrixCell = ({ value }) => {
    if (value === 'full') {
      return <CheckCircle className="mx-auto h-4 w-4 text-emerald-600" aria-hidden="true" />;
    }
    if (value === 'limited') {
      return (
        <span className="block text-center text-base font-bold leading-none text-cyan-600" aria-hidden="true">~</span>
      );
    }
    if (value === 'none') {
      return <X className="mx-auto h-4 w-4 text-rose-500" aria-hidden="true" />;
    }
    if (value === 'handoff') {
      return (
        <ArrowRight
          className={`mx-auto h-4 w-4 text-amber-600 ${isRTL ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      );
    }
    if (value === 'owner_only') {
      return (
        <span className="flex items-center justify-center gap-0.5 text-cyan-600">
          <CheckCircle className="h-4 w-4" aria-hidden="true" />
          <span className="text-[10px] font-bold">*</span>
        </span>
      );
    }
    return <span className="block text-center text-slate-300">—</span>;
  };

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      {/* z-20 keeps the LanguageSwitcher dropdown above the animated cards
          below (animate-fade-up leaves a transform → stacking contexts). */}
      <div className="relative z-20 flex flex-col gap-4 animate-fade-up lg:flex-row lg:items-center lg:justify-between">
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
                <Gauge className="h-6 w-6 text-white" />
              </span>
              {t('AI Monitoring', 'مراقبة الذكاء الاصطناعي')}
            </h1>
            <p className="ms-eyebrow-canvas mt-2">
              {t('AI GATEWAY OPERATIONS', 'عمليات بوابة الذكاء الاصطناعي')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Analysis window selector — refetches with ?hours=24|168|720 */}
          <div
            className="ms-segmented"
            role="tablist"
            aria-label={t('Analysis window', 'نافذة التحليل')}
          >
            {WINDOWS.map((w) => {
              const active = windowHours === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => changeWindow(w.id)}
                  className={active ? 'ms-segmented-btn ms-segmented-active' : 'ms-segmented-btn'}
                >
                  {t(w.label[0], w.label[1])}
                </button>
              );
            })}
          </div>
          <LanguageSwitcher />
          <button
            onClick={() => loadData(windowHours, true)}
            disabled={refreshing}
            aria-label={t('Refresh AI monitoring data', 'تحديث بيانات المراقبة')}
            className="btn-ghost-dark px-4 py-3 text-sm"
          >
            <RotateCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{t('Refresh', 'تحديث')}</span>
          </button>
        </div>
      </div>

      {/* ── Totals row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-5">
        <StatCard
          title={t('Total Requests', 'إجمالي الطلبات')}
          value={fmtInt(totals.requests, locale)}
          subtitle={t(`last ${windowLabel[0]}`, `آخر ${windowLabel[1]}`)}
          icon={Zap}
          color="emerald"
          accent
          style={{ animationDelay: '60ms' }}
        />
        <StatCard
          title={t('Success Rate', 'معدل النجاح')}
          value={fmtPct(totals.successRate, locale)}
          subtitle={t('successful responses', 'استجابات ناجحة')}
          icon={CheckCircle}
          color="teal"
          style={{ animationDelay: '120ms' }}
        />
        <StatCard
          title={t('Fallback Rate', 'معدل التراجع')}
          value={fmtPct(totals.fallbackRate, locale)}
          subtitle={t('served by a backup provider', 'خُدمت عبر مزوّد احتياطي')}
          icon={ArrowLeftRight}
          color="amber"
          style={{ animationDelay: '180ms' }}
        />
        <StatCard
          title={t('Handoffs', 'التحويلات')}
          value={fmtInt(totals.handoffs, locale)}
          subtitle={t('redirected between agents', 'تحويلات بين الوكلاء')}
          icon={Bot}
          color="cyan"
          style={{ animationDelay: '240ms' }}
        />
        <StatCard
          title={t('Safety Interventions', 'تدخلات السلامة')}
          value={fmtInt(totals.safetyInterventions, locale)}
          subtitle={t('guardrails triggered', 'حواجز سلامة مُفعّلة')}
          icon={ShieldCheck}
          color="rose"
          style={{ animationDelay: '300ms' }}
        />
      </div>

      {!hasActivity ? (
        /* ── Empty state — no logged traffic yet ─────────────────────────── */
        <section className="glass-card p-8 text-center animate-fade-up" aria-labelledby="aimon-empty-title">
          <Sparkles className="mx-auto mb-4 h-14 w-14 text-emerald-600" />
          <h3 id="aimon-empty-title" className="ms-serif text-lg font-semibold text-slate-900">
            {t('Nothing to monitor yet', 'لا شيء للمراقبة بعد')}
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            {t(
              'No AI activity recorded yet — ask the Smart Router something.',
              'لا يوجد نشاط ذكاء اصطناعي مسجّل بعد — اطرح سؤالاً على الموجّه الذكي.'
            )}
          </p>
          <div className="mt-6">
            <Button variant="primary" onClick={() => navigate('/agents')}>
              <Bot className="h-5 w-5" />
              <span>{t('Open Smart Router', 'افتح الموجّه الذكي')}</span>
            </Button>
          </div>
        </section>
      ) : (
        <>
          {/* ── Per-agent grid ─────────────────────────────────────────────── */}
          <section aria-labelledby="aimon-agents-title" className="min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 id="aimon-agents-title" className="ms-serif text-lg font-semibold text-slate-100">
                  {t('Agent Operations', 'عمليات الوكلاء')}
                </h2>
                <p className="ms-eyebrow mt-1">
                  {t('Per-agent gateway statistics', 'إحصاءات البوابة لكل وكيل')}
                </p>
              </div>
              <span className="chip-modern shrink-0 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                {t(`${agents.length} agents`, `${agents.length} وكلاء`)}
              </span>
            </div>
            <div className="grid gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
              {agents.map((a, idx) => {
                const Icon = AGENT_ICONS[a.agent] || Bot;
                const name = language === 'ar' ? a.display?.ar : a.display?.en;
                const chain = Array.isArray(a.providerChain) ? a.providerChain : [];
                const successTone =
                  a.requests === 0
                    ? 'bg-slate-200'
                    : a.successRate >= 80
                      ? 'bg-emerald-500'
                      : a.successRate >= 50
                        ? 'bg-amber-500'
                        : 'bg-rose-500';
                return (
                  <article
                    key={a.agent}
                    className="glass-card glass-card-hover flex flex-col p-5 animate-fade-up"
                    style={{ animationDelay: `${80 + idx * 40}ms` }}
                    aria-labelledby={`aimon-agent-${a.agent}`}
                  >
                    {/* Card header */}
                    <div className="mb-4 flex items-start gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${AGENT_TILES[a.agent] || AGENT_TILES.router}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 id={`aimon-agent-${a.agent}`} className="truncate text-sm font-bold text-slate-900">
                          {name || a.agent}
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {a.lastUsed
                            ? t(`last used ${formatRelative(a.lastUsed)}`, `آخر استخدام ${formatRelative(a.lastUsed)}`)
                            : t('never used', 'لم يُستخدم')}
                        </p>
                      </div>
                    </div>

                    {/* Provider chain chips: primary → secondary → fallback */}
                    <div className="mb-4 flex flex-wrap items-center gap-1.5">
                      {chain.map((p, i) => {
                        const isLast = i === chain.length - 1;
                        const role =
                          i === 0
                            ? { cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80', tag: t('primary', 'أساسي') }
                            : chain.length > 1 && isLast
                              ? { cls: 'bg-amber-50 text-amber-700 border border-amber-200/80', tag: t('fallback', 'احتياطي') }
                              : { cls: 'bg-slate-100 text-slate-600 border border-slate-200', tag: t('secondary', 'ثانوي') };
                        return (
                          <span
                            key={`${a.agent}-p-${i}`}
                            className={`chip-modern ${role.cls}`}
                            title={t(`${role.tag} provider`, `مزوّد ${role.tag}`)}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                            {PROVIDER_LABELS[p] || p}
                          </span>
                        );
                      })}
                    </div>

                    {/* KPI rows */}
                    <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
                      <div className="surface-inset p-2.5">
                        <dt className="text-slate-500">{t('Requests', 'الطلبات')}</dt>
                        <dd className="mt-0.5 text-base font-bold tabular-nums text-slate-900">
                          {fmtInt(a.requests, locale)}
                        </dd>
                      </div>
                      <div className="surface-inset p-2.5">
                        <dt className="text-slate-500">{t('Success', 'النجاح')}</dt>
                        <dd className="mt-0.5 text-base font-bold tabular-nums text-slate-900">
                          {fmtPct(a.successRate, locale)}
                        </dd>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                          <div
                            className={`h-full rounded-full ${successTone}`}
                            style={{ width: `${Math.min(100, Math.max(0, a.successRate || 0))}%` }}
                          />
                        </div>
                      </div>
                      <div className="surface-inset p-2.5">
                        <dt className="text-slate-500">{t('Fallback', 'التراجع')}</dt>
                        <dd className="mt-0.5 text-base font-bold tabular-nums text-amber-600">
                          {fmtPct(a.fallbackRate, locale)}
                        </dd>
                      </div>
                      <div className="surface-inset p-2.5">
                        <dt className="text-slate-500">{t('Avg latency', 'متوسط الاستجابة')}</dt>
                        <dd className="mt-0.5 text-base font-bold tabular-nums text-slate-900">
                          {a.requests > 0 ? fmtMs(a.avgLatencyMs, locale, t('s', 'ث')) : '—'}
                        </dd>
                        {a.requests > 0 && (
                          <p className="text-[10px] text-slate-400">
                            {t('p95', 'p95')} {fmtMs(a.p95LatencyMs, locale, t('s', 'ث'))}
                          </p>
                        )}
                      </div>
                      <div className="surface-inset flex items-center justify-between gap-2 p-2.5">
                        <dt className="flex items-center gap-1.5 text-slate-500">
                          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('Handoffs', 'التحويلات')}
                        </dt>
                        <dd className="text-base font-bold tabular-nums text-cyan-600">{fmtInt(a.handoffs, locale)}</dd>
                      </div>
                      <div className="surface-inset flex items-center justify-between gap-2 p-2.5">
                        <dt className="flex items-center gap-1.5 text-slate-500">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('Safety blocks', 'حجوزات السلامة')}
                        </dt>
                        <dd className="text-base font-bold tabular-nums text-rose-500">{fmtInt(a.safetyBlocks, locale)}</dd>
                      </div>
                      {(a.agent === 'emergency' || (a.emergencyPriorities ?? 0) > 0) && (
                        <div className="surface-inset col-span-2 flex items-center justify-between gap-2 p-2.5">
                          <dt className="flex items-center gap-1.5 text-slate-500">
                            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                            {t('Emergency priorities', 'أولويات الطوارئ')}
                          </dt>
                          <dd className="text-base font-bold tabular-nums text-rose-500">
                            {fmtInt(a.emergencyPriorities, locale)}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {a.errors > 0 && (
                      <p className="mt-2.5 text-[11px] font-medium text-rose-500">
                        {t(`${a.errors} failed request(s)`, `${a.errors} طلب فاشل`)}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {/* ── Recent activity ────────────────────────────────────────────── */}
          <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '160ms' }} aria-labelledby="aimon-recent-title">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="aimon-recent-title" className="ms-serif text-lg font-semibold text-slate-900">
                  {t('Recent Activity', 'النشاط الأخير')}
                </h3>
                <p className="ms-eyebrow mt-1">
                  {t('Latest gateway requests', 'أحدث طلبات البوابة')}
                </p>
              </div>
              <Timer className="h-6 w-6 shrink-0 text-cyan-600" />
            </div>

            {recent.length === 0 ? (
              <p className="py-8 text-center text-sm font-medium text-slate-400">
                {t('No requests in this window.', 'لا طلبات في هذه النافذة.')}
              </p>
            ) : (
              <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto pe-1" role="list" aria-label={t('Recent AI gateway requests', 'أحدث طلبات البوابة')}>
                {recent.map((r, i) => {
                  const badge = safetyBadge(r);
                  return (
                    <div key={`recent-${i}`} role="listitem" className="flex items-center gap-3 py-2.5">
                      {/* Agent chip */}
                      <span className={`chip-modern shrink-0 ${AGENT_CHIP_STYLES[r.agent] || AGENT_CHIP_STYLES.router}`}>
                        {agentChipLabel(r.agent)}
                      </span>
                      {/* Intent + provider + latency */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-semibold uppercase tracking-wide text-slate-800">
                          {r.intent || t('request', 'طلب')}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          <span className="font-mono">{PROVIDER_LABELS[r.provider] || r.provider}</span>
                          {' · '}
                          <span className="tabular-nums">{fmtMs(r.latencyMs, locale, t('s', 'ث'))}</span>
                          {r.fallbackUsed && (
                            <span className="ms-1.5 font-medium text-amber-600">
                              · {t('fallback', 'تراجع')}
                            </span>
                          )}
                          {r.handoff && (
                            <span className="ms-1.5 font-medium text-cyan-600">
                              · {t('handoff', 'تحويل')}
                            </span>
                          )}
                        </p>
                      </div>
                      {/* Safety badge + time */}
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {badge ? (
                          <span className={`chip-modern ${badge.cls}`}>{badge.label}</span>
                        ) : (
                          <span className="chip-modern bg-slate-100 text-slate-500 border border-slate-200">
                            {r.success ? t('done', 'منجز') : t('failed', 'فاشل')}
                          </span>
                        )}
                        {!r.success && r.safetyResult === 'ok' && (
                          <span className="text-[10px] font-semibold uppercase text-rose-500">
                            {t('error', 'خطأ')}
                          </span>
                        )}
                        <span className="text-[11px] tabular-nums text-slate-400" title={formatDateTime(r.createdAt)}>
                          {formatRelative(r.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* ── Capabilities matrix ─────────────────────────────────────────────── */}
      <section className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '200ms' }} aria-labelledby="aimon-matrix-title">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="aimon-matrix-title" className="ms-serif text-lg font-semibold text-slate-900">
              {t('Agent Capabilities', 'قدرات الوكلاء')}
            </h3>
            <p className="ms-eyebrow mt-1">
              {t('What each agent can do — by design', 'ما يستطيع كل وكيل فعله — بحسب التصميم')}
            </p>
          </div>
          <Cpu className="h-6 w-6 shrink-0 text-emerald-600" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-xs">
            <thead>
              <tr className="text-start text-slate-400">
                <th scope="col" className="py-2 pe-3 text-start font-medium">
                  {t('Capability', 'القدرة')}
                </th>
                {matrixColumns.map((c) => {
                  const label = MATRIX_COLUMN_LABELS[c];
                  return (
                    <th scope="col" key={c} className="px-2 py-2 text-center font-medium">
                      {label ? t(label[0], label[1]) : c}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {matrixRows.map((row) => {
                const label = CAPABILITY_LABELS[row.capability];
                return (
                  <tr key={row.capability}>
                    <td className="py-2 pe-3 text-start font-medium text-slate-700">
                      {label ? t(label[0], label[1]) : row.capability}
                    </td>
                    {matrixColumns.map((c) => (
                      <td key={`${row.capability}-${c}`} className="px-2 py-2">
                        <MatrixCell value={row.values?.[c]} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            {t('full — owns the capability', 'كامل — يملك القدرة')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-sm font-bold leading-none text-cyan-600">~</span>
            {t('limited — partial support', 'محدود — دعم جزئي')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <X className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
            {t('none — out of scope', 'لا شيء — خارج النطاق')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ArrowRight className={`h-3.5 w-3.5 text-amber-600 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
            {t('handoff — redirects', 'تحويل — يوجّه لوكيل آخر')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />
            <span className="font-bold">*</span>
            {t('owner only', 'لمالك البيانات فقط')}
          </span>
        </div>
      </section>
    </div>
  );
}
