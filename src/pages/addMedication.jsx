import React, { useState, useEffect } from 'react';
import {
  Plus, Trash2, Clock, Pill, Calendar, Check, ArrowLeft,
  Sparkles, AlertCircle, Save, RotateCcw, Copy, Languages
} from 'lucide-react';
import { useMedicine } from '../context/medicationContext';
import { useNotification } from '../context/notificationContext';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../hooks/useTranslation.js';
import BulkMedicineInput from '../components/BulkMedicineInput';
import Button from '../components/Button';
import Loader from '../components/Loader';


export default function MedicationEntryForm() {
  const navigate = useNavigate();
  const { sendNotification } = useNotification();
  const { medication, setMedication, addMedication } = useMedicine();
  const { t, translateText, supportedLanguages } = useLanguage();

  const [currentTime, setCurrentTime] = useState({
    time: "",
    remindBefore: "15m",
    remindAfter: "30m"
  });
  const [showJson, setShowJson] = useState(false);
  const [translationPreviews, setTranslationPreviews] = useState({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); 
  const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  // Display-only day names — the selected/stored value stays the English day string (API contract)
  const dayDisplayNames = {
    Monday: t('Mon', 'الاثنين'),
    Tuesday: t('Tue', 'الثلاثاء'),
    Wednesday: t('Wed', 'الأربعاء'),
    Thursday: t('Thu', 'الخميس'),
    Friday: t('Fri', 'الجمعة'),
    Saturday: t('Sat', 'السبت'),
    Sunday: t('Sun', 'الأحد')
  };
  const reminderOptions = ["5m", "10m", "15m", "30m", "1h"];
  const [mode, setMode] = useState(() => localStorage.getItem("medMode") || "single");
  useEffect(() => {
    localStorage.setItem("medMode", mode);
  }, [mode]);
  // 🌐 Debounced translation preview
  useEffect(() => {
    if (!medication.pillDescription || medication.pillDescription.trim().length === 0) {
      setTranslationPreviews({});
      return;
    }

    const delayTimer = setTimeout(async () => {
      setIsTranslating(true);
      try {
        const previews = {};
        for (const lang of supportedLanguages.filter(l => l.code !== 'en')) {
          const translated = await translateText(medication.pillDescription, lang.code, 'medication');
          previews[lang.code] = translated;
        }
        setTranslationPreviews(previews);
      } catch (error) {
        console.error('Translation preview error:', error);
      } finally {
        setIsTranslating(false);
      }
    }, 1000); // 1 second debounce

    return () => clearTimeout(delayTimer);
  }, [medication.pillDescription]);

  const handleInputChange = (field, value) => {
    setMedication(prev => ({ ...prev, [field]: value }));
  };

  const handleDayToggle = (day) => {
    setMedication(prev => ({
      ...prev,
      dosageDays: prev.dosageDays.includes(day)
        ? prev.dosageDays.filter(d => d !== day)
        : [...prev.dosageDays, day]
    }));
  };

  const addDosageTime = () => {
    if (!currentTime.time) { alert(t('Please select a time', 'يرجى اختيار وقت')); return; }
    const newTime = { ...currentTime, status: "pending", takenAt: null };
    setMedication(prev => ({ ...prev, dosageTimes: [...prev.dosageTimes, newTime] }));
    setCurrentTime({ time: "", remindBefore: "15m", remindAfter: "30m" });
  };

  const removeDosageTime = (index) => {
    setMedication(prev => ({
      ...prev,
      dosageTimes: prev.dosageTimes.filter((_, i) => i !== index)
    }));
  };

  const getFinalObject = () => ({

    pillName: medication.pillName,
    pillDescription: medication.pillDescription,
    dosageDays: medication.dosageDays,
    dosageTimes: medication.dosageTimes,
    dosageAmount: medication.dosageAmount,
    frequency: medication.frequency,
    startDate: new Date(medication.startDate),
    endDate: medication.endDate ? new Date(medication.endDate) : null,
    adherenceHistory: []
  });

  const handleSubmit = async () => {
    if (!medication.pillName) {
      alert(t('Please enter pill name', 'يرجى إدخال اسم الدواء'));
      return;
    }
    if (medication.dosageDays.length === 0) {
      alert(t('Please select at least one day', 'يرجى اختيار يوم واحد على الأقل'));
      return;
    }
    if (medication.dosageTimes.length === 0) {
      alert(t('Please add at least one dosage time', 'يرجى إضافة وقت جرعة واحد على الأقل'));
      return;
    }

    setIsSubmitting(true);
    try {
      await addMedication();
      setShowJson(true);
      // Navigate back to dashboard after successful submission
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
    } catch (error) {
      console.error('Error adding medication:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setMedication({
      pillName: "",
      pillDescription: "",
      dosageDays: [],
      dosageTimes: [],
      dosageAmount: "",
      frequency: "",
      startDate: new Date().toISOString().split('T')[0],
      endDate: ""
    });
    setShowJson(false);
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">

        {/* Header */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between animate-fade-up">
          <div className="flex items-center gap-x-4">
            <button
              onClick={() => navigate("/dashboard")}
              aria-label={t('Back to dashboard', 'العودة إلى لوحة التحكم')}
              className="p-3 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl transition-all group"
            >
              <ArrowLeft className="w-6 h-6 rtl:rotate-180 ltr:group-hover:-translate-x-1 rtl:group-hover:translate-x-1 transition-transform" />
            </button>
            <div>
              <p className="ms-eyebrow-canvas mb-2">{t('Your Regimen', 'نظامك الدوائي')}</p>
              <h1 className="section-title">
                {t('Add New Medication', 'إضافة دواء جديد')}
              </h1>
              <p className="text-slate-400 mt-1.5">{t('Create a new medication schedule', 'أنشئ جدولاً دوائياً جديداً')}</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            {/* Mode Toggle — segmented control (dark canvas) */}
            <div className="ms-segmented">
              <button
                onClick={() => setMode("single")}
                className={`ms-segmented-btn ${
                  mode === "single" ? "ms-segmented-active" : ""
                }`}
              >
                {t('Single Entry', 'إدخال فردي')}
              </button>

              <button
                onClick={() => setMode("bulk")}
                className={`ms-segmented-btn ${
                  mode === "bulk" ? "ms-segmented-active" : ""
                }`}
              >
                {t('Bulk Add (AI)', 'إضافة جماعية (ذكاء اصطناعي)')}
              </button>
            </div>

            <div className="ms-feature-icon hidden sm:flex shrink-0">
              <Pill className="w-5 h-5" />
            </div>
          </div>
        </header>

        {/* Main Form Card */}
        {mode === "single" && (
        <div className="glass-card p-6 sm:p-8 space-y-8 animate-fade-up" style={{ animationDelay: '60ms' }}>


          {/* Pill Name */}
          <div>
            <label className="label-modern flex items-center gap-2">
              <Pill size={18} className="text-emerald-600" />
              {t('Pill Name', 'اسم الدواء')} <span className="text-emerald-600">*</span>
            </label>
            <input
              type="text"
              value={medication.pillName}
              onChange={e => handleInputChange('pillName', e.target.value)}
              placeholder={t('e.g., Aspirin, Metformin', 'مثال: Aspirin، Metformin')}
              className="input-modern"
            />
          </div>

          {/* Description */}
          <div>
            <label className="label-modern">
              {t('Description', 'الوصف')}
            </label>
            <textarea
              value={medication.pillDescription}
              onChange={e => handleInputChange('pillDescription', e.target.value)}
              rows={3}
              placeholder={t('Notes about this medication...', 'ملاحظات عن هذا الدواء...')}
              className="input-modern resize-none"
            />

            {/* 🌐 Translation Preview */}
            {medication.pillDescription && medication.pillDescription.trim().length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-cyan-700 text-sm">
                  <Languages className="w-4 h-4" />
                  <span className="font-medium">{t('Translation Preview', 'معاينة الترجمة')}</span>
                  {isTranslating && (
                    <div className="flex items-center gap-1">
                      <Loader size="sm" color="blue" />
                      <span className="text-xs text-slate-400">{t('translating...', 'جارٍ الترجمة...')}</span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {supportedLanguages.filter(l => l.code !== 'en').map(lang => (
                    <div
                      key={lang.code}
                      className="surface-inset p-3 border-cyan-200"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-cyan-700">{lang.nativeName}</span>
                        <span className="text-xs text-slate-400">({lang.code.toUpperCase()})</span>
                      </div>
                      <p className="text-sm text-slate-600">
                        {isTranslating ? (
                          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse"></div>
                        ) : (
                          translationPreviews[lang.code] || medication.pillDescription
                        )}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 italic">
                  {t('Translations will be automatically saved when you create the medication', 'سيتم حفظ الترجمات تلقائياً عند إنشاء الدواء')}
                </p>
              </div>
            )}
          </div>

          {/* Dosage Amount & Frequency */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label-modern">
                {t('Dosage Amount', 'الجرعة')}
              </label>
              <input
                type="text"
                value={medication.dosageAmount}
                onChange={e => handleInputChange('dosageAmount', e.target.value)}
                placeholder={t('e.g., 500mg, 2 tablets', 'مثال: 500mg، قرصان')}
                className="input-modern"
              />
            </div>
            <div>
              <label className="label-modern">
                {t('Frequency', 'عدد المرات')}
              </label>
              <input
                type="text"
                value={medication.frequency}
                onChange={e => handleInputChange('frequency', e.target.value)}
                placeholder={t('e.g., 2 times a day', 'مثال: مرتين يومياً')}
                className="input-modern"
              />
            </div>
          </div>

          {/* Days Selection */}
          <div>
            <label className="label-modern flex items-center gap-2 mb-3">
              <Calendar size={18} className="text-emerald-600" />
              {t('Select Days', 'اختر الأيام')} <span className="text-emerald-600">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {weekDays.map(day => (
                <button
                  key={day}
                  onClick={() => handleDayToggle(day)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all duration-200 ${medication.dosageDays.includes(day)
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
                    }`}
                >
                  {dayDisplayNames[day] || day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          {/* Dosage Times */}
          <div>
            <label className="label-modern flex items-center gap-2 mb-3">
              <Clock size={18} className="text-emerald-600" />
              {t('Dosage Times', 'أوقات الجرعات')} <span className="text-emerald-600">*</span>
            </label>

            <div className="surface-inset p-4 sm:p-5 mb-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('Time', 'الوقت')}</label>
                  <input
                    type="time"
                    value={currentTime.time}
                    onChange={e => setCurrentTime(prev => ({ ...prev, time: e.target.value }))}
                    className="input-modern"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('Remind Before', 'تذكير قبل')}</label>
                  <select
                    value={currentTime.remindBefore}
                    onChange={e => setCurrentTime(prev => ({ ...prev, remindBefore: e.target.value }))}
                    className="select-modern"
                  >
                    {reminderOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('Remind After', 'تذكير بعد')}</label>
                  <select
                    value={currentTime.remindAfter}
                    onChange={e => setCurrentTime(prev => ({ ...prev, remindAfter: e.target.value }))}
                    className="select-modern"
                  >
                    {reminderOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
              </div>

              <button
                onClick={addDosageTime}
                className="btn-primary-modern w-full py-2.5"
              >
                <Plus size={20} /> {t('Add Time', 'إضافة وقت')}
              </button>
            </div>

            {medication.dosageTimes.length > 0 && (
              <div className="space-y-2">
                {medication.dosageTimes.map((time, index) => (
                  <div
                    key={index}
                    className="surface-inset p-4 flex items-center justify-between gap-4"
                  >
                    <div className="text-slate-500">
                      <span className="font-semibold text-slate-900">{time.time}</span>
                      <span className="text-sm ms-3">{t('Before:', 'قبل:')} {time.remindBefore} | {t('After:', 'بعد:')} {time.remindAfter}</span>
                    </div>
                    <button
                      onClick={() => removeDosageTime(index)}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 p-2.5 rounded-lg transition"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Start & End Dates */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label-modern">
                {t('Start Date', 'تاريخ البداية')} <span className="text-emerald-600">*</span>
              </label>
              <input
                type="date"
                value={medication.startDate}
                onChange={e => handleInputChange('startDate', e.target.value)}
                className="input-modern"
              />
            </div>
            <div>
              <label className="label-modern">
                {t('End Date (Optional)', 'تاريخ الانتهاء (اختياري)')}
              </label>
              <input
                type="date"
                value={medication.endDate}
                onChange={e => handleInputChange('endDate', e.target.value)}
                className="input-modern"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="btn-primary-modern flex-1 py-3.5 sm:py-4 text-base sm:text-lg"
          >
            <Check size={24} />
            {isSubmitting ? t('Submitting...', 'جارٍ الإرسال...') : t('Create Medication Entry', 'إنشاء الدواء')}
          </button>
            <button 
              onClick={resetForm} 
              className="btn-ghost-modern px-8 py-3.5 sm:py-4"
            >
              {t('Reset', 'إعادة تعيين')}
            </button>
          </div>
        </div>
        )}

        {mode === "bulk" && (
          <div className="glass-card p-6 sm:p-8 animate-fade-up" style={{ animationDelay: '60ms' }}>
            <BulkMedicineInput />
          </div>
        )}


        {/* JSON Preview */}
        {showJson && (
          <div className="glass-card p-6 animate-fade-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="ms-serif text-xl font-semibold text-slate-900">{t('Final Medication Object', 'كائن الدواء النهائي')}</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(getFinalObject(), null, 2));
                  alert(t('Copied!', 'تم النسخ!'));
                }}
                className="btn-ghost-modern px-4 py-2 text-sm"
              >
                {t('Copy JSON', 'نسخ JSON')}
              </button>
            </div>
            <pre className="surface-inset text-slate-800 text-xs font-mono overflow-x-auto p-4 leading-relaxed">
              {JSON.stringify(getFinalObject(), null, 2)}
            </pre>
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-amber-700 text-sm">
                <strong>{t('Ready to use!', 'جاهز للاستخدام!')}</strong> {t('Copy this object and send it to backend/context.', 'انسخ هذا الكائن وأرسله إلى الخادم أو السياق.')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}