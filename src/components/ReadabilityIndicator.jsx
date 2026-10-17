import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Info } from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';

export const ReadabilityIndicator = ({
  score,
  readingLevel,
  showDetails = false,
  showRecommendations = false,
  recommendations = [],
  className = '',
}) => {
  const { t } = useLanguage();
  const [showTooltip, setShowTooltip] = useState(false);

  // Determine color based on reading level
  // "Rhythm" v4 palette: good = emerald, moderate = amber, difficult = rose
  const getColorClasses = () => {
    if (!readingLevel) {
      return { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', badge: 'bg-slate-100 text-slate-600 border-slate-200' };
    }

    const key = readingLevel.toLowerCase();
    if (key.includes('elementary') || key === 'easy' || key.includes('fairly_easy')) {
      return { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if (key.includes('standard') || key.includes('high')) {
      return { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', badge: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    return { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200', badge: 'bg-rose-50 text-rose-700 border-rose-200' };
  };

  const getIcon = () => {
    if (!readingLevel) return null;
    const key = readingLevel.toLowerCase();
    if (key.includes('elementary') || key === 'easy' || key.includes('fairly_easy')) {
      return <CheckCircle size={16} className="text-emerald-600" />;
    }
    if (key.includes('standard') || key.includes('high')) {
      return <AlertCircle size={16} className="text-amber-600" />;
    }
    return <AlertCircle size={16} className="text-rose-600" />;
  };

  // Localized tier label (Good / Average / Needs Attention) — raw API value
  // stays untouched in aria/data, only the visible label is bilingualized.
  const getTierLabel = () => {
    if (!readingLevel) return t('Unknown', 'غير معروف');
    const key = readingLevel.toLowerCase();
    if (key.includes('elementary') || key === 'easy' || key.includes('fairly_easy')) {
      return t('Good', 'جيد');
    }
    if (key.includes('standard') || key.includes('high')) {
      return t('Average', 'متوسط');
    }
    return t('Needs Attention', 'يحتاج انتباهاً');
  };

  const colors = getColorClasses();

  if (!score && score !== 0) {
    return null;
  }

  return (
    <div className={`relative ${className}`}>
      {/* Main Indicator Badge — modern chip */}
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${colors.badge} cursor-help transition-all duration-200 hover:shadow-md`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        role="status"
        aria-label={t(
          `Readability level: ${readingLevel} (Grade ${Math.round(score)})`,
          `مستوى قابلية القراءة: ${readingLevel} (الصف ${Math.round(score)})`
        )}
      >
        {getIcon()}
        <span className="text-xs font-semibold">{t('Grade', 'الصف')} {Math.round(score)}</span>
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full mb-2 start-1/2 ltr:-translate-x-1/2 rtl:translate-x-1/2 z-50 w-64 p-3.5 rounded-xl bg-white border border-slate-200 shadow-lg shadow-slate-900/10 animate-fade-in">
          <div className={`text-sm font-semibold ${colors.text}`}>{getTierLabel()}</div>
          <div className="text-xs text-slate-500 mt-1">
            {t('Flesch-Kincaid Grade Level', 'مستوى فليش-كينكيد للصفوف')}: {score.toFixed(1)}
          </div>
          {showDetails && (
            <div className="text-xs text-slate-500 mt-2 space-y-1">
              <div>• {t(`Suitable for grades ${Math.floor(score)}-${Math.ceil(score)}`, `مناسب للصفوف ${Math.floor(score)}-${Math.ceil(score)}`)}</div>
              <div>• {t('Adjust vocabulary and sentence length if too complex', 'عدّل المفردات وطول الجمل إذا كان النص معقداً للغاية')}</div>
            </div>
          )}
        </div>
      )}

      {/* Detailed View */}
      {showDetails && (
        <div className={`mt-3 p-3.5 rounded-xl border ${colors.bg} ${colors.border}`}>
          <div className="flex items-center gap-2 mb-2">
            {getIcon()}
            <span className={`font-semibold text-sm ${colors.text}`}>{getTierLabel()}</span>
          </div>
          <div className="text-xs text-slate-500 space-y-1">
            <div>{t('Grade Level', 'مستوى الصف')}: {Math.round(score)}</div>
            <div>{t('Flesch Score', 'درجة فليش')}: {score.toFixed(1)}</div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {showRecommendations && recommendations.length > 0 && (
        <div className="mt-3 p-3.5 rounded-xl bg-cyan-50 border border-cyan-200">
          <div className="flex items-start gap-2">
            <Info size={16} className="text-cyan-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-cyan-700 space-y-1">
              <div className="font-semibold text-cyan-700">{t('Readability Suggestions:', 'توصيات قابلية القراءة:')}</div>
              <ul className="list-disc list-inside space-y-1">
                {recommendations.slice(0, 3).map((rec, idx) => (
                  <li key={idx}>{rec}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
