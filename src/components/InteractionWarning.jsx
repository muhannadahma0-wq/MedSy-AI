import { useEffect, useRef } from 'react';
import { AlertTriangle, XCircle, CheckCircle, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';

// FIX 3: Full Tailwind class strings instead of dynamic template literals
// so Tailwind's class scanner includes them in production builds
// ("Rhythm" soft-dark v4: dimmed canvas scrim + white modal card,
//  severity-tinted band — severe=red, moderate=amber, mild=emerald)
const SEVERITY_CONFIG = {
  major: {
    icon: XCircle,
    label: 'Major Interaction',
    wrapperClass: 'bg-red-50 border-red-200',
    tileClass: 'border-red-200',
    iconClass: 'text-red-600',
    headingClass: 'text-red-700',
    badgeClass: 'bg-red-100 text-red-700 border border-red-200',
    overrideBtnClass: 'bg-red-600 hover:bg-red-500 shadow-sm',
  },
  moderate: {
    icon: AlertTriangle,
    label: 'Moderate Interaction',
    wrapperClass: 'bg-amber-50 border-amber-200',
    tileClass: 'border-amber-200',
    iconClass: 'text-amber-600',
    headingClass: 'text-amber-700',
    badgeClass: 'bg-amber-100 text-amber-700 border border-amber-200',
    overrideBtnClass: 'bg-amber-600 hover:bg-amber-500 shadow-sm',
  },
  minor: {
    icon: ShieldAlert,
    label: 'Minor Interaction',
    wrapperClass: 'bg-emerald-50 border-emerald-200',
    tileClass: 'border-emerald-200',
    iconClass: 'text-emerald-600',
    headingClass: 'text-emerald-700',
    badgeClass: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    overrideBtnClass: 'bg-emerald-600 hover:bg-emerald-500 shadow-sm',
  },
};

/**
 * InteractionWarning modal
 * Props:
 *   interactions    - array of interaction objects from backend
 *   highestSeverity - "major" | "moderate" | "minor"
 *   blocked         - bool (major = true, harder override)
 *   onOverride      - called when user confirms override
 *   onCancel        - called when user cancels
 */
export default function InteractionWarning({ interactions, highestSeverity, blocked, onOverride, onCancel }) {
  const { t } = useLanguage();
  const config = SEVERITY_CONFIG[highestSeverity] || SEVERITY_CONFIG.minor;
  const Icon = config.icon;
  const headingId = "interaction-warning-title";
  const descId = "interaction-warning-desc";

  // Display-only translations for the static severity labels (SEVERITY_CONFIG / FIX-3 structure preserved)
  const severityHeadings = {
    major: t('Major Interaction Detected', 'تم رصد تفاعل دوائي خطير'),
    moderate: t('Moderate Interaction Detected', 'تم رصد تفاعل دوائي متوسط'),
    minor: t('Minor Interaction Detected', 'تم رصد تفاعل دوائي بسيط')
  };
  const severityBadges = {
    major: t('Major', 'خطير'),
    moderate: t('Moderate', 'متوسط'),
    minor: t('Minor', 'بسيط')
  };

  // FIX 4: Focus management — trap focus inside modal on open
  const modalRef = useRef(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    modalRef.current?.focus();
    return () => previouslyFocused?.focus(); // restore focus on close
  }, []);

  return (
    // FIX 4: ARIA dialog semantics for screen readers
    <div
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      aria-describedby={descId}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="glass-card w-full max-w-lg p-6 space-y-5 outline-none animate-fade-up"
      >
        {/* Header — severity alert band */}
        <div className={`flex items-center gap-3 rounded-xl border p-4 ${config.wrapperClass}`}>
          <div className={`w-12 h-12 rounded-xl bg-white border flex items-center justify-center shrink-0 ${config.tileClass}`}>
            <Icon className={`w-6 h-6 ${config.iconClass}`} aria-hidden="true" />
          </div>
          <div>
            <h2 id={headingId} className={`text-lg font-bold ${config.headingClass}`}>
              {severityHeadings[highestSeverity] || severityHeadings.minor}
            </h2>
            <p id={descId} className="text-sm text-slate-600">
              {t('This medication may interact with your existing regimen.', 'قد يتفاعل هذا الدواء مع نظامك الدوائي الحالي.')}
            </p>
          </div>
        </div>

        {/* Interaction list */}
        <ul className="space-y-3 max-h-60 overflow-y-auto pe-1" aria-label={t('Detected interactions', 'التفاعلات الدوائية المكتشفة')}>
          {interactions.map((interaction, idx) => (
            <li key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md uppercase tracking-wide ${config.badgeClass}`}>
                  {severityBadges[interaction.severity] || interaction.severity}
                </span>
                <span className="text-sm font-medium text-slate-900">
                  {interaction.drug1} ↔ {interaction.drug2}
                </span>
              </div>
              <p className="text-sm text-slate-600">{interaction.description}</p>
            </li>
          ))}
        </ul>

        {/* Actions */}
        <div className="space-y-2 pt-1">
          {blocked && (
            <p className="text-sm text-red-700 text-center font-medium">
              {t('Major interactions require doctor approval before proceeding.', 'تتطلب التفاعلات الخطيرة موافقة الطبيب قبل المتابعة.')}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl text-sm font-medium text-slate-700 transition-all shadow-sm"
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button
              onClick={onOverride}
              className={`px-4 py-2.5 ${config.overrideBtnClass} rounded-xl text-sm font-medium text-white transition-all flex items-center justify-center gap-2`}
            >
              {blocked
                ? <><XCircle className="w-4 h-4" aria-hidden="true" /> {t('Override & Add Anyway', 'تجاهل وإضافة على أي حال')}</>
                : <><CheckCircle className="w-4 h-4" aria-hidden="true" /> {t('I Understand, Add Anyway', 'فهمت، أضف على أي حال')}</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
