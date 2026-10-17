import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Globe, Check } from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';

export const LanguageSwitcher = ({ className = '' }) => {
  const { language, supportedLanguages, setLanguage, loading, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);


  const getNativeLanguageName = (code) => {
    const lang = supportedLanguages.find(l => l.code === code);
    return lang?.nativeName || code.toUpperCase();
  };

  const handleLanguageSelect = (newLanguage) => {
    setLanguage(newLanguage);
    setIsOpen(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 ${className}`}>
        <Globe size={18} className="text-emerald-400 animate-pulse-soft" />
        <span className="text-sm text-slate-400">{t('Loading...', 'جارٍ التحميل...')}</span>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={`relative inline-block ${className}`}>
      {/* Button — dark-canvas pill (renders in the dark Navbar) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-slate-200 font-medium text-sm transition-all duration-200"
        aria-label={t('Change language', 'تغيير اللغة')}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Globe size={18} className="text-emerald-400" />
        <span>{getNativeLanguageName(language)}</span>
        <ChevronDown
          size={16}
          className={`text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu — frosted dark panel floating over the canvas */}
      {isOpen && (
        <div
          className="absolute end-0 mt-2 w-52 rounded-2xl border border-white/10 bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-black/50 z-50 animate-fade-in overflow-hidden"
          role="listbox"
        >
          <div className="p-2">
            {supportedLanguages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageSelect(lang.code)}
                className={`w-full text-start px-3 py-2.5 rounded-xl text-sm transition-colors duration-150 ${
                  language === lang.code
                    ? 'bg-emerald-400/10 text-emerald-400'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
                role="option"
                aria-selected={language === lang.code}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{lang.nativeName}</span>
                  {language === lang.code && (
                    <Check className="w-4 h-4 text-emerald-400" />
                  )}
                </div>
                <div className="text-xs text-slate-500">{lang.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
