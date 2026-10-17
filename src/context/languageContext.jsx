import React, { createContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export const LanguageContext = createContext();

const STORAGE_KEY = 'medsync-language';
const RTL_LANGUAGES = ['ar'];

/** Apply the language to the root <html> element (lang + dir attributes). */
function applyDocumentLanguage(lang) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr';
}

function isSupported(lang) {
  return lang === 'en' || lang === 'ar';
}

export const LanguageProvider = ({ children }) => {
  // Bilingual app: 'en' (default, LTR) or 'ar' (RTL).
  // The device-local choice (localStorage) is restored instantly on mount so
  // the RTL layout never flashes, then reconciled with the account preference.
  const [language, setLanguageState] = useState(() => {
    if (typeof window === 'undefined') return 'en';
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isSupported(saved) ? saved : 'en';
  });
  const [supportedLanguages, setSupportedLanguages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const API_BASE_URL = '';

  // Keep <html lang/dir> in sync with the selected language
  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  // Fetch user's preferred language on mount
  useEffect(() => {
    const fetchUserLanguage = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/languages/user`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        });
        const preferred = response.data.preferredLanguage;
        // Server (account) preference applies only when this device has no
        // local selection; a local selection is always the newest intent here.
        const saved = localStorage.getItem(STORAGE_KEY);
        if (isSupported(preferred) && !isSupported(saved)) {
          setLanguageState(preferred);
        }
        setSupportedLanguages(response.data.supportedLanguages || []);
      } catch (err) {
        // Fallback to default if fetch fails
        console.warn('Could not fetch user language preference:', err.message);
        // Try to fetch just the supported languages list
        try {
          const langResponse = await axios.get(`${API_BASE_URL}/api/languages/supported`);
          setSupportedLanguages(langResponse.data.languages || []);
        } catch (langErr) {
          console.warn('Could not fetch supported languages:', langErr.message);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchUserLanguage();
  }, []);

  // Update language preference (UI + this device + backend account)
  const updateLanguage = useCallback(async (newLanguage) => {
    if (!isSupported(newLanguage)) return;
    try {
      setLanguageState(newLanguage);
      try {
        localStorage.setItem(STORAGE_KEY, newLanguage);
      } catch (storageErr) {
        console.warn('Could not persist language locally:', storageErr);
      }
      await axios.put(
        `${API_BASE_URL}/api/languages/user`,
        { language: newLanguage },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );
    } catch (err) {
      console.error('Failed to update language preference:', err.message);
      setError(err.message);
      // Still keep the local state updated
    }
  }, []);

  // UI translation helper: t('English text', 'النص العربي')
  const t = useCallback(
    (enText, arText) => (language === 'ar' ? (arText ?? enText) : enText),
    [language]
  );

  // Translate text (content translation via the backend service)
  const translateText = useCallback(async (text, targetLanguage = null, context = 'medical') => {
    const targetLang = targetLanguage || language;
    if (!text || text.trim().length === 0) {
      return text;
    }

    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/translate`,
        {
          text,
          targetLanguage: targetLang,
          context,
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );
      return response.data.translatedText || text;
    } catch (err) {
      console.error('Translation failed:', err.message);
      return text; // Fallback to original text
    }
  }, [language]);

  // Batch translate texts
  const translateBatch = useCallback(async (texts = [], targetLanguage = null, context = 'medical') => {
    const targetLang = targetLanguage || language;
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/translate/batch`,
        {
          texts,
          targetLanguage: targetLang,
          context,
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );
      return response.data.translatedTexts || texts;
    } catch (err) {
      console.error('Batch translation failed:', err.message);
      return texts; // Fallback to original texts
    }
  }, [language]);

  const isRTL = RTL_LANGUAGES.includes(language);

  const value = {
    language,
    setLanguage: updateLanguage,
    supportedLanguages,
    loading,
    error,
    translateText,
    translateBatch,
    // UI i18n helpers (bilingual build)
    t,
    isRTL,
    dir: isRTL ? 'rtl' : 'ltr',
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};
