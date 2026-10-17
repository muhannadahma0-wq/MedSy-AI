import React from 'react';
import { Globe, Eye } from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';

export const TranslationBadge = ({
  originalLanguage = 'en',
  currentLanguage = 'en',
  onShowOriginal = null,
  className = '',
}) => {
  const { t } = useLanguage();
  const isTranslated = originalLanguage !== currentLanguage;

  const getLanguageLabel = (code) => {
    const labels = {
      en: 'English',
      ar: 'العربية',
    };
    return labels[code] || code.toUpperCase();
  };

  if (!isTranslated) {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-50 text-cyan-700 text-xs font-medium border border-cyan-200 ${className}`}
      role="status"
      aria-label={t(
        `Translated from ${getLanguageLabel(originalLanguage)} to ${getLanguageLabel(currentLanguage)}`,
        `مترجم من ${getLanguageLabel(originalLanguage)} إلى ${getLanguageLabel(currentLanguage)}`
      )}
    >
      <Globe size={14} className="flex-shrink-0" />
      <span>
        {t('Originally', 'الأصل:')} <span className="font-semibold">{getLanguageLabel(originalLanguage)}</span>
      </span>
      {onShowOriginal && (
        <button
          onClick={onShowOriginal}
          className="ms-1 p-1 rounded-full hover:bg-cyan-100 transition-colors"
          title={t(
            `View original ${getLanguageLabel(originalLanguage)} text`,
            `عرض النص الأصلي باللغة ${getLanguageLabel(originalLanguage)}`
          )}
          aria-label={t(
            `Show original ${getLanguageLabel(originalLanguage)} version`,
            `إظهار النسخة الأصلية باللغة ${getLanguageLabel(originalLanguage)}`
          )}
        >
          <Eye size={14} />
        </button>
      )}
    </div>
  );
};
