import React, { useState, useEffect, useRef } from 'react';
import { Settings, Check } from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation.js';
import axios from 'axios';

export default function LanguageSettings() {
  const { supportedLanguages, language: currentLanguage, setLanguage, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLanguageChange = async (langCode) => {
    if (langCode === currentLanguage) {
      setIsOpen(false);
      return;
    }

    setIsSaving(true);
    try {
      const token = localStorage.getItem('token');
      
      // Update backend
      if (token) {
        await axios.put(
          `/api/languages/user`,
          { preferredLanguage: langCode },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      // Update frontend state
      setLanguage(langCode);

      // Update localStorage
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        user.preferredLanguage = langCode;
        localStorage.setItem('user', JSON.stringify(user));
      }

      setIsOpen(false);
    } catch (error) {
      console.error('Error updating language preference:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const currentLanguageName = supportedLanguages.find(l => l.code === currentLanguage);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2.5 hover:bg-white/10 rounded-xl transition-all flex items-center gap-2 text-slate-400 hover:text-white"
        title={t('Language settings', 'إعدادات اللغة')}
        aria-label={t('Language settings', 'إعدادات اللغة')}
      >
        <Settings className="w-5 h-5" />
      </button>

      {isOpen && (
        <div className="glass-card absolute top-full end-0 mt-2 w-56 z-50 animate-fade-in overflow-hidden">
          <div className="p-3.5 border-b border-slate-200">
            <p className="ms-eyebrow">{t('Language', 'اللغة')}</p>
          </div>
          
          <div className="py-2">
            {supportedLanguages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                disabled={isSaving}
                className={`w-full px-4 py-3 text-start text-sm flex items-center justify-between transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  currentLanguage === lang.code ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div>
                  <div className="font-medium text-slate-800">{lang.nativeName}</div>
                  <div className="text-xs text-slate-400">{lang.name}</div>
                </div>
                {currentLanguage === lang.code && (
                  <Check className="w-4 h-4 text-emerald-600" />
                )}
              </button>
            ))}
          </div>

          <div className="px-4 py-3 border-t border-slate-200 text-xs text-slate-400">
            {t('Current:', 'الحالية:')} {currentLanguageName?.nativeName}
          </div>
        </div>
      )}
    </div>
  );
}
