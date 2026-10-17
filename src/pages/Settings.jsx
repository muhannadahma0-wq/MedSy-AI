import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Globe,
  Volume2,
  Eye,
  RotateCcw,
  Save,
  ArrowLeft,
  Check,
  AlertCircle,
  Clock,
  Type,
  FlaskConical,
  ShieldCheck,
  Loader
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../hooks/useTranslation';
import { errorMessage } from '../lib/i18n';
import Button from '../components/Button';
import axios from 'axios';

const READING_LEVELS = [
  { value: 'all', label: 'All levels (Expert content)' },
  { value: 'college', label: 'College/University' },
  { value: 'highschool', label: 'High School' },
  { value: 'middle', label: 'Middle School' },
  { value: 'elementary', label: 'Elementary' }
];

export default function Settings() {
  const navigate = useNavigate();
  const { supportedLanguages, setLanguage, t, language } = useLanguage();
  
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  
  const [settings, setSettings] = useState({
    preferredLanguage: 'en',
    autoTranslateAll: false,
    showReadabilityScores: true,
    targetReadingLevel: 'highschool'
  });

  const [originalSettings, setOriginalSettings] = useState({});
  const [hasChanges, setHasChanges] = useState(false);

  // Phase 3 — timezone preferences (server-side, affects dose scheduling).
  const [timeZone, setTimeZone] = useState('UTC');
  const [tzOptions, setTzOptions] = useState([]);
  const [tzSaving, setTzSaving] = useState(false);
  const [tzMessage, setTzMessage] = useState(null);

  // v5 item 42 — research participation consent (GET/POST/DELETE
  // /api/study/consent). `consent` is {version, grantedAt, revokedAt}|null;
  // `consentSaving` is 'grant' | 'revoke' | null for the button spinners.
  const [consent, setConsent] = useState(undefined); // undefined = loading
  const [consentSaving, setConsentSaving] = useState(null);
  const [consentMsg, setConsentMsg] = useState(null); // { ok, text }
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const consentFetch = (url, options = {}) =>
    fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
      },
    });

  const loadConsent = async () => {
    try {
      const res = await consentFetch('/api/study/consent');
      const data = await res.json().catch(() => ({}));
      setConsent(res.ok && data?.success ? data.consent : null);
    } catch {
      setConsent(null);
    }
  };

  // Localized long date for grantedAt / revokedAt.
  const formatConsentDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString(language === 'ar' ? 'ar' : 'en-US', { dateStyle: 'long' });
  };

  const handleGrantConsent = async () => {
    if (consentSaving) return;
    setConsentSaving('grant');
    setConsentMsg(null);
    try {
      const res = await consentFetch('/api/study/consent', {
        method: 'POST',
        body: JSON.stringify({ accept: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw Object.assign(new Error('grant failed'), { code: data?.error?.code });
      }
      setConsent(data.consent);
      setConfirmRevoke(false);
      setConsentMsg({ ok: true, text: t('Thank you — your participation is recorded.', 'شكراً لك — تم تسجيل مشاركتك.') });
    } catch (err) {
      setConsentMsg({
        ok: false,
        text: errorMessage(err?.code, t('Could not update your consent. Please try again.', 'تعذّر تحديث موافقتك. حاول مرة أخرى.'), language),
      });
    } finally {
      setConsentSaving(null);
      setTimeout(() => setConsentMsg(null), 6000);
    }
  };

  const handleRevokeConsent = async () => {
    if (consentSaving) return;
    setConsentSaving('revoke');
    try {
      const res = await consentFetch('/api/study/consent', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw Object.assign(new Error('revoke failed'), { code: data?.error?.code });
      }
      setConsent(data.consent);
      setConfirmRevoke(false);
      setConsentMsg({ ok: true, text: t('Your research participation has been revoked.', 'تم إلغاء مشاركتك في البحث.') });
    } catch (err) {
      setConsentMsg({
        ok: false,
        text: errorMessage(err?.code, t('Could not update your consent. Please try again.', 'تعذّر تحديث موافقتك. حاول مرة أخرى.'), language),
      });
    } finally {
      setConsentSaving(null);
      setTimeout(() => setConsentMsg(null), 6000);
    }
  };

  // Load the consent state on mount.
  useEffect(() => {
    loadConsent();
  }, []);

  // Phase 13 — accessibility: text size (root font-size %, local-only
  // preference). Applied instantly + persisted in localStorage; the app
  // re-applies it on boot (App.jsx). Reduced-motion is honoured via CSS
  // (globals.css prefers-reduced-motion) — nothing to configure there.
  const TEXT_SIZES = [
    { value: '100', labelEn: 'Default', labelAr: 'افتراضي' },
    { value: '110', labelEn: 'Large', labelAr: 'كبير' },
    { value: '125', labelEn: 'Larger', labelAr: 'أكبر' },
  ];
  const [textSize, setTextSize] = useState(() => {
    if (typeof window === 'undefined') return '100';
    const saved = localStorage.getItem('medsync-text-size');
    return ['100', '110', '125'].includes(saved) ? saved : '100';
  });

  const applyTextSize = (value) => {
    setTextSize(value);
    localStorage.setItem('medsync-text-size', value);
    document.documentElement.style.fontSize = `${value}%`;
  };

  // Curated common zones (the full IANA list is ~400 entries — too heavy for
  // a select; the detected zone is always added if missing).
  const COMMON_ZONES = [
    'UTC',
    'Asia/Hebron', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Amman', 'Asia/Cairo', 'Asia/Qatar',
    'Asia/Kuwait', 'Asia/Baghdad', 'Asia/Beirut', 'Asia/Tehran', 'Asia/Istanbul',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Europe/Athens',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Sao_Paulo',
    'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg',
    'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Singapore',
    'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
  ];

  // Bilingual labels for the reading-level options (stored values stay as-is)
  const readingLevelLabels = {
    all: t('All levels (Expert content)', 'كل المستويات (محتوى الخبراء)'),
    college: t('College/University', 'جامعي'),
    highschool: t('High School', 'ثانوي'),
    middle: t('Middle School', 'متوسط'),
    elementary: t('Elementary', 'ابتدائي')
  };

  // Load user settings on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setCurrentUser(parsedUser);
        
        // Initialize settings from user profile
        setSettings(prev => ({
          ...prev,
          preferredLanguage: parsedUser.preferredLanguage || 'en'
        }));
        
        // Load additional settings from localStorage
        const savedSettings = localStorage.getItem('userSettings');
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          setSettings(prev => ({ ...prev, ...parsed }));
          setOriginalSettings({ ...parsed });
        } else {
          setOriginalSettings({
            preferredLanguage: parsedUser.preferredLanguage || 'en',
            autoTranslateAll: false,
            showReadabilityScores: true,
            targetReadingLevel: 'highschool'
          });
        }
      } catch (error) {
        console.error('Error loading user:', error);
      }
    }
    setLoading(false);
  }, []);

  // Check if settings have changed
  useEffect(() => {
    const changed = JSON.stringify(settings) !== JSON.stringify(originalSettings);
    setHasChanges(changed);
  }, [settings, originalSettings]);

  // Phase 3 — load the current server-side timezone + build the option list.
  useEffect(() => {
    const detected = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
    const options = [...COMMON_ZONES];
    if (!options.includes(detected)) options.unshift(detected);
    setTzOptions(options);

    const token = localStorage.getItem('token');
    axios
      .get('/api/preferences/timezone', { headers: { Authorization: `Bearer ${token || ''}` } })
      .then((res) => {
        if (res.data?.success && res.data.timeZone) setTimeZone(res.data.timeZone);
      })
      .catch(() => {/* keep the UTC default */ });
  }, []);

  // Phase 3 — apply the timezone server-side (rebuilds upcoming doses).
  const handleApplyTimeZone = async () => {
    setTzSaving(true);
    setTzMessage(null);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.put(
        '/api/preferences/timezone',
        { timeZone },
        { headers: { Authorization: `Bearer ${token || ''}` } }
      );
      if (res.data?.success) {
        setTimeZone(res.data.timeZone);
        setTzMessage({ ok: true, text: res.data.message });
      } else {
        setTzMessage({ ok: false, text: res.data?.message || t('Failed to update timezone', 'فشل تحديث المنطقة الزمنية') });
      }
    } catch (err) {
      setTzMessage({ ok: false, text: t('Failed to update timezone', 'فشل تحديث المنطقة الزمنية') });
    } finally {
      setTzSaving(false);
      setTimeout(() => setTzMessage(null), 6000);
    }
  };

  const handleSettingChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setMessage('');
    
    try {
      // Update language preference in backend
      if (settings.preferredLanguage !== originalSettings.preferredLanguage && currentUser) {
        const token = localStorage.getItem('token');
        await axios.put(
          `/api/languages/user`,
          { preferredLanguage: settings.preferredLanguage },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      // Save other settings to localStorage
      localStorage.setItem('userSettings', JSON.stringify({
        autoTranslateAll: settings.autoTranslateAll,
        showReadabilityScores: settings.showReadabilityScores,
        targetReadingLevel: settings.targetReadingLevel,
        preferredLanguage: settings.preferredLanguage
      }));

      // Update localStorage user if language changed
      if (currentUser && settings.preferredLanguage !== currentUser.preferredLanguage) {
        const updatedUser = { ...currentUser, preferredLanguage: settings.preferredLanguage };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        setCurrentUser(updatedUser);
      }

      setOriginalSettings({ ...settings });
      setMessage(`✅ ${t('Settings saved successfully!', 'تم حفظ الإعدادات بنجاح!')}`);
      
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage(`❌ ${t('Error saving settings. Please try again.', 'حدث خطأ أثناء حفظ الإعدادات. حاول مرة أخرى.')}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    const defaults = {
      preferredLanguage: currentUser?.preferredLanguage || 'en',
      autoTranslateAll: false,
      showReadabilityScores: true,
      targetReadingLevel: 'highschool'
    };
    setSettings(defaults);
    setHasChanges(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
        
        {/* Header */}
        <header className="flex items-center gap-4 pt-4 sm:pt-6 animate-fade-up">
          <button 
            onClick={() => navigate("/dashboard")}
            className="p-2.5 hover:bg-white/10 rounded-xl transition-all group text-slate-300 hover:text-white"
            aria-label={t('Back to dashboard', 'العودة إلى لوحة التحكم')}
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180 ltr:group-hover:-translate-x-1 rtl:group-hover:translate-x-1 transition-transform" />
          </button>
          <div>
            <h1 className="section-title">
              {t('Settings', 'الإعدادات')}
            </h1>
            <p className="ms-eyebrow-canvas mt-2">{t('Customize your MedSync experience', 'خصّص تجربتك مع MedSync')}</p>
          </div>
        </header>

        {/* Message Alert */}
        {message && (
          <div className={`px-4 py-3 rounded-xl flex items-center gap-2 border animate-fade-up ${
            message.includes('✅') 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {message.includes('✅') ? (
              <Check className="w-5 h-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <span className="text-sm font-medium">{message}</span>
          </div>
        )}

        {/* Language Preferences Section */}
        <section className="glass-card p-6 sm:p-8 space-y-6 animate-fade-up" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center flex-shrink-0">
              <Globe className="w-5 h-5 text-cyan-600" />
            </div>
            <div>
              <h2 className="ms-serif text-slate-900 font-semibold text-lg">{t('Language Preferences', 'اللغة والترجمة')}</h2>
              <p className="text-slate-500 text-sm mt-0.5">{t('Set your preferred language and translation behaviour', 'اضبط لغتك المفضلة وسلوك الترجمة')}</p>
            </div>
          </div>

          {/* Preferred Language — segmented pill options */}
          <div>
            <label className="label-modern">
              {t('Preferred Language', 'اللغة المفضلة')}
            </label>
            <div className="flex flex-wrap gap-2">
              {supportedLanguages.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => {
                    handleSettingChange('preferredLanguage', lang.code);
                    // Apply immediately so the whole app flips EN↔AR live
                    // (context persists to localStorage + PUT /api/languages/user)
                    setLanguage(lang.code);
                  }}
                  className={`px-4 py-2.5 rounded-full text-sm font-medium border transition-all duration-200 ${
                    settings.preferredLanguage === lang.code
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {lang.nativeName}
                </button>
              ))}
            </div>
            <p className="text-slate-500 text-xs mt-2.5">
              {t('Display medication instructions and reports in this language', 'عرض تعليمات الدواء والتقارير بهذه اللغة')}
            </p>
          </div>

          {/* Auto-Translate Toggle */}
          <div className="surface-inset p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Volume2 className="w-5 h-5 text-cyan-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-sm text-slate-900">{t('Auto-translate all content', 'الترجمة التلقائية لكل المحتوى')}</p>
                <p className="text-slate-500 text-xs mt-0.5">{t('Automatically translate AI responses and analysis', 'ترجمة ردود الذكاء الاصطناعي والتحليلات تلقائياً')}</p>
              </div>
            </div>
            <button
              onClick={() => handleSettingChange('autoTranslateAll', !settings.autoTranslateAll)}
              className={`relative w-14 h-8 rounded-full transition-all duration-300 flex-shrink-0 border ${
                settings.autoTranslateAll 
                  ? 'bg-emerald-600 border-emerald-500' 
                  : 'bg-slate-200 border-slate-300'
              }`}
              aria-pressed={settings.autoTranslateAll}
              aria-label={t('Toggle auto-translate', 'تبديل الترجمة التلقائية')}
            >
              <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-all duration-300 ${
                settings.autoTranslateAll ? 'start-[1.75rem]' : 'start-1'
              }`} />
            </button>
          </div>
        </section>

        {/* Time Zone Section (Phase 3) */}
        <section className="glass-card p-6 sm:p-8 space-y-6 animate-fade-up" style={{ animationDelay: '90ms' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center flex-shrink-0">
              <Clock className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="ms-serif text-slate-900 font-semibold text-lg">{t('Time Zone', 'المنطقة الزمنية')}</h2>
              <p className="text-slate-500 text-sm mt-0.5">{t('Your dose times and reminders follow this clock', 'أوقات جرعاتك وتذكيراتك تتبع هذه الساعة')}</p>
            </div>
          </div>

          <div className="surface-inset p-4 space-y-4">
            <div>
              <label className="label-modern" htmlFor="timezone-select">
                {t('Dose schedule time zone', 'منطقة الجدول الزمني للجرعات')}
              </label>
              <select
                id="timezone-select"
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                className="select-modern w-full"
              >
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p className="text-slate-500 text-xs mt-2.5">
                {t(
                  'A slot like "08:00" means 8 AM on this clock. Changing it reschedules only upcoming doses — your history is never rewritten.',
                  'الوقت "08:00" يعني الثامنة صباحاً بهذه الساعة. تغييرها يعيد جدولة الجرعات القادمة فقط — سجلّك التاريخي لا يُعاد كتابته أبداً.'
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleApplyTimeZone}
                disabled={tzSaving}
                className="btn-primary-modern px-4 py-2.5 text-sm disabled:opacity-60"
              >
                <Clock className="w-4 h-4" />
                <span>{tzSaving ? t('Applying…', 'جارٍ التطبيق…') : t('Apply time zone', 'تطبيق المنطقة الزمنية')}</span>
              </button>
              {tzMessage && (
                <span className={`text-sm font-medium ${tzMessage.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {tzMessage.text}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Research Participation Section (v5 item 42 — study consent) */}
        <section className="glass-card p-6 sm:p-8 space-y-6 animate-fade-up" style={{ animationDelay: '100ms' }} aria-labelledby="study-consent-title">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
              <FlaskConical className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 id="study-consent-title" className="ms-serif text-slate-900 font-semibold text-lg">{t('Research Participation', 'المشاركة في البحث')}</h2>
              <p className="text-slate-500 text-sm mt-0.5">{t('Choose whether your de-identified data is included in study exports', 'اختر ما إذا كانت بياناتك مجهّلة الهوية تُدرَج في تصديرات الدراسة')}</p>
            </div>
          </div>

          <div className="surface-inset p-4 space-y-4">
            {/* Current consent state */}
            {consent === undefined ? (
              <div className="flex items-center gap-3" aria-busy="true">
                <Loader className="w-5 h-5 animate-spin text-emerald-600 flex-shrink-0" aria-hidden="true" />
                <span className="text-sm text-slate-500">{t('Loading your consent state…', 'جارٍ تحميل حالة موافقتك…')}</span>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {consent && !consent.revokedAt ? (
                    <span className="chip-modern border border-emerald-200 bg-emerald-50 text-emerald-700">
                      <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t('Participating in the study', 'مشارك في الدراسة')}</span>
                    </span>
                  ) : consent && consent.revokedAt ? (
                    <span className="chip-modern border border-amber-200 bg-amber-50 text-amber-700">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t('Participation revoked', 'المشاركة ملغاة')}</span>
                    </span>
                  ) : (
                    <span className="chip-modern border border-slate-200 bg-slate-100 text-slate-600">
                      <span>{t('Not participating', 'غير مشارك')}</span>
                    </span>
                  )}
                  {consent?.version && (
                    <span className="chip-modern border border-slate-200 bg-white text-slate-500" dir="ltr">
                      v{consent.version}
                    </span>
                  )}
                </div>

                <ul className="text-sm text-slate-600 space-y-1.5">
                  {consent?.grantedAt && (
                    <li>• <strong>{t('Consent granted:', 'تاريخ الموافقة:')}</strong> {formatConsentDate(consent.grantedAt)}</li>
                  )}
                  {consent?.revokedAt && (
                    <li>• <strong>{t('Consent revoked:', 'تاريخ الإلغاء:')}</strong> {formatConsentDate(consent.revokedAt)}</li>
                  )}
                </ul>

                {/* Honest scope note — what consent covers and what
                    revocation does NOT do. */}
                <p className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-500">
                  {t(
                    'Study data is de-identified (no names, emails or identifiers). Revoking stops your data from being included in future exports — it does not delete already-collected de-identified study data, which remains in prior exports.',
                    'بيانات الدراسة مجهّلة الهوية (بلا أسماء أو بريد أو معرّفات). إلغاء المشاركة يوقف تضمين بياناتك في التصديرات المستقبلية — ولا يحذف بيانات الدراسة مجهّلة الهوية التي جُمعت سابقاً، وتبقى في التصديرات السابقة.'
                  )}
                </p>

                {/* Inline bilingual confirm for revoke */}
                {confirmRevoke && consent && !consent.revokedAt && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-2.5" role="alertdialog" aria-label={t('Confirm revocation', 'تأكيد الإلغاء')}>
                    <p className="text-sm leading-relaxed text-amber-800">
                      {t(
                        'Your data stops being included in study exports; existing exported research data remains in prior exports.',
                        'تتوقف بياناتك عن الظهور في تصديرات الدراسة؛ وتبقى بيانات البحث المُصدَّرة سابقاً في التصديرات السابقة.'
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleRevokeConsent}
                        disabled={consentSaving !== null}
                        className="min-h-[44px] px-4 rounded-xl border border-amber-300 bg-amber-100 text-sm font-semibold text-amber-800 transition-all hover:bg-amber-200 disabled:opacity-60"
                      >
                        {consentSaving === 'revoke' ? t('Revoking…', 'جارٍ الإلغاء…') : t('Yes, revoke participation', 'نعم، ألغِ المشاركة')}
                      </button>
                      <button
                        onClick={() => setConfirmRevoke(false)}
                        disabled={consentSaving !== null}
                        className="min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-60"
                      >
                        {t('Cancel', 'إلغاء')}
                      </button>
                    </div>
                  </div>
                )}

                {consentMsg && (
                  <p className={`flex items-center gap-2 text-sm font-medium ${consentMsg.ok ? 'text-emerald-700' : 'text-rose-700'}`} role="status">
                    {consentMsg.ok ? <Check className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />}
                    {consentMsg.text}
                  </p>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {consent && !consent.revokedAt ? (
                    <button
                      onClick={() => setConfirmRevoke(true)}
                      disabled={consentSaving !== null}
                      className="min-h-[44px] px-4 rounded-xl border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-800 transition-all hover:bg-amber-100 disabled:opacity-60"
                    >
                      {t('Revoke participation', 'إلغاء المشاركة')}
                    </button>
                  ) : (
                    <button
                      onClick={handleGrantConsent}
                      disabled={consentSaving !== null}
                      className="min-h-[44px] px-4 rounded-xl bg-emerald-700 text-sm font-semibold text-white shadow-[0_6px_18px_-4px_rgba(4,120,87,0.5)] transition-all hover:bg-emerald-600 disabled:opacity-60"
                    >
                      {consentSaving === 'grant' ? t('Saving…', 'جارٍ الحفظ…') : consent?.revokedAt ? t('Participate again', 'المشاركة مجدداً') : t('Join the study', 'انضم إلى الدراسة')}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {/* Text Size Section (Phase 13 — accessibility) */}
        <section className="glass-card p-6 sm:p-8 space-y-6 animate-fade-up" style={{ animationDelay: '105ms' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center flex-shrink-0">
              <Type className="w-5 h-5 text-cyan-700" />
            </div>
            <div>
              <h2 className="ms-serif text-slate-900 font-semibold text-lg">{t('Text Size', 'حجم النص')}</h2>
              <p className="text-slate-500 text-sm mt-0.5">{t('Make the whole interface easier to read', 'اجعل الواجهة كلها أسهل في القراءة')}</p>
            </div>
          </div>

          <div className="surface-inset p-4 space-y-4">
            <div role="radiogroup" aria-label={t('Text size', 'حجم النص')} className="grid grid-cols-3 gap-2">
              {TEXT_SIZES.map((size) => (
                <button
                  key={size.value}
                  role="radio"
                  aria-checked={textSize === size.value}
                  onClick={() => applyTextSize(size.value)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                    textSize === size.value
                      ? 'border-cyan-300 bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span style={{ fontSize: `${Math.round(Number(size.value) * 0.875 * 100) / 100}px` }}>
                    {t(size.labelEn, size.labelAr)}
                  </span>
                  <span className="block text-xs opacity-60 mt-0.5">{size.value}%</span>
                </button>
              ))}
            </div>
            <p className="text-slate-500 text-xs">
              {t(
                'Scales text across the app (stored on this device). Animations are already reduced automatically when your system requests it.',
                'يكبّر النصوص في كل التطبيق (يُحفظ على هذا الجهاز). تُقلَّل الحركات تلقائيًا عندما يطلب نظامك ذلك.'
              )}
            </p>
          </div>
        </section>
        <section className="glass-card p-6 sm:p-8 space-y-6 animate-fade-up" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
              <Eye className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="ms-serif text-slate-900 font-semibold text-lg">{t('Readability Settings', 'تفضيلات القراءة')}</h2>
              <p className="text-slate-500 text-sm mt-0.5">{t('Control how simple medical text should be', 'تحكم في بساطة النصوص الطبية')}</p>
            </div>
          </div>

          {/* Show Readability Scores Toggle */}
          <div className="surface-inset p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Eye className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-sm text-slate-900">{t('Show readability scores', 'إظهار درجات قابلية القراءة')}</p>
                <p className="text-slate-500 text-xs mt-0.5">{t('Display reading level badges on reports and analysis', 'إظهار شارات مستوى القراءة على التقارير والتحليلات')}</p>
              </div>
            </div>
            <button
              onClick={() => handleSettingChange('showReadabilityScores', !settings.showReadabilityScores)}
              className={`relative w-14 h-8 rounded-full transition-all duration-300 flex-shrink-0 border ${
                settings.showReadabilityScores
                  ? 'bg-emerald-600 border-emerald-500'
                  : 'bg-slate-200 border-slate-300'
              }`}
              aria-pressed={settings.showReadabilityScores}
              aria-label={t('Toggle readability scores', 'تبديل درجات قابلية القراءة')}
            >
              <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-md transition-all duration-300 ${
                settings.showReadabilityScores ? 'start-[1.75rem]' : 'start-1'
              }`} />
            </button>
          </div>

          {/* Target Reading Level */}
          <div>
            <label className="label-modern" htmlFor="target-reading-level">
              {t('Target Reading Level', 'مستوى القراءة المستهدف')}
            </label>
            <select
              id="target-reading-level"
              value={settings.targetReadingLevel}
              onChange={(e) => handleSettingChange('targetReadingLevel', e.target.value)}
              disabled={!settings.showReadabilityScores}
              className="select-modern disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {READING_LEVELS.map(level => (
                <option key={level.value} value={level.value}>
                  {readingLevelLabels[level.value] || level.label}
                </option>
              ))}
            </select>
            <p className="text-slate-500 text-xs mt-2.5">
              {t('Adjust medical content complexity to match your comfort level', 'اضبط درجة تعقيد المحتوى الطبي بما يناسب مستوى راحتك')}
            </p>
          </div>
        </section>

        {/* Save + Danger Zone */}
        <div className="glass-card p-6 space-y-4 animate-fade-up" style={{ animationDelay: '180ms' }}>
          <Button
            onClick={handleSaveSettings}
            variant="primary"
            disabled={!hasChanges || saving}
            isLoading={saving}
            className="w-full"
          >
            <Save className="w-5 h-5" />
            {saving ? t('Saving...', 'جارٍ الحفظ...') : t('Save Settings', 'حفظ الإعدادات')}
          </Button>

          {/* Danger zone — red-tinted inset */}
          <div className="rounded-xl bg-red-50 border border-red-200 p-4">
            <button
              onClick={handleResetDefaults}
              className="w-full px-6 py-3 bg-white hover:bg-red-100 text-red-700 border border-red-200 hover:border-red-300 font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              <RotateCcw className="w-5 h-5" />
              {t('Reset to Defaults', 'إعادة تعيين التفضيلات')}
            </button>
          </div>
        </div>

        {/* Unsaved Changes Warning */}
        {hasChanges && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-amber-700 animate-fade-up">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">{t('You have unsaved changes', 'لديك تغييرات غير محفوظة')}</span>
          </div>
        )}

        {/* Info Card */}
        <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '240ms' }}>
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
              <SettingsIcon className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="ms-serif font-semibold mb-2 text-slate-900">{t('About Your Settings', 'حول إعداداتك')}</h3>
              <ul className="text-sm text-slate-600 space-y-1.5">
                <li>• <strong>{t('Preferred Language:', 'اللغة المفضلة:')}</strong> {t('Used for medication instructions and report generation', 'تُستخدم لتعليمات الدواء وإنشاء التقارير')}</li>
                <li>• <strong>{t('Auto-translate:', 'الترجمة التلقائية:')}</strong> {t('Automatically translates AI responses and analysis results', 'تترجم ردود الذكاء الاصطناعي ونتائج التحليل تلقائياً')}</li>
                <li>• <strong>{t('Readability Scores:', 'درجات قابلية القراءة:')}</strong> {t('Shows text complexity indicators on medical content', 'تعرض مؤشرات تعقيد النصوص على المحتوى الطبي')}</li>
                <li>• <strong>{t('Reading Level:', 'مستوى القراءة:')}</strong> {t('Helps tailor content to your comprehension preference', 'تساعد في تخصيص المحتوى بما يناسب مستوى فهمك')}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
