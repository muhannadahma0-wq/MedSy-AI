import React, { useState } from "react";
import axios from "axios";
// 1. Import the same context your working form uses
import { useMedicine } from '../context/medicationContext';
import { useLanguage } from '../hooks/useTranslation';

export default function BulkMedicineInput() {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // UI translation helper (display-only)
  const { t } = useLanguage();

  // 2. Get the medication state from context (which contains user info)
  const { medication } = useMedicine();

  const handleSubmit = async () => {
    if (!text.trim()) {
      alert(t('Please enter at least one medicine', 'يرجى إدخال دواء واحد على الأقل'));
      return;
    }

    setLoading(true);
    try {
      // 1. Change "localuser" to "user" to match your Login.jsx
      const userData = JSON.parse(localStorage.getItem("user"));

      if (!userData) {
        alert(t('User info missing. Please login again.', 'بيانات المستخدم مفقودة. يرجى تسجيل الدخول مرة أخرى.'));
        setLoading(false);
        return;
      }

      // 2. Ensure we send an object that has 'id' because your 
      // backend likely expects that specific key name
      const payloadUser = {
        ...userData,
        id: userData.id || userData._id // Use whichever one is available
      };

      const res = await axios.post(
        `/api/medicine/bulk`,
        { 
          text, 
          localuser: payloadUser // Sending the corrected user object
        }
      );

      setResult(res.data);
      alert(t('Bulk add successful!', 'تمت الإضافة الجماعية بنجاح!'));
    } catch (err) {
      console.error("Bulk Add Error:", err);
      alert(err.response?.data?.message || t('Bulk add failed', 'فشلت الإضافة الجماعية'));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setText("");
    setResult(null);
  };

  return (
    <div className="space-y-4">
      <textarea
        rows={12}
        placeholder={`Paracetamol 500mg morning and night for 5 days
Aspirin 75mg once daily starting from 07-Jan-2026
Metformin 500mg twice daily from Monday to Friday until 14-Jan-2026
`}
        className="input-modern font-mono leading-relaxed"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {/* Helper + sample format */}
      <p className="text-xs text-slate-500">
        {t('Enter one medication per line — the AI parser reads name, dosage, schedule and duration from plain text.', 'أدخل دواءً واحداً في كل سطر — يقرأ المحلل الذكي اسم الدواء والجرعة والجدول والمدة من النص العادي.')}
      </p>
      <div className="surface-inset p-3.5">
        <p className="text-xs font-medium text-slate-500 mb-2">{t('Sample format', 'مثال للتنسيق')}</p>
        <pre className="text-xs text-slate-600 font-mono whitespace-pre-wrap leading-relaxed">{`Paracetamol 500mg morning and night for 5 days
Aspirin 75mg once daily starting from 07-Jan-2026
Metformin 500mg twice daily from Monday to Friday until 14-Jan-2026`}</pre>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="btn-primary-modern flex-1 py-3.5 sm:py-4 text-base sm:text-lg"
        >
          {loading ? t('Processing...', 'جارٍ المعالجة...') : t('Create Medication Entries', 'إنشاء الأدوية')}
        </button>

        <button
          onClick={resetForm}
          className="btn-ghost-modern px-8 py-3.5 sm:py-4"
        >
          {t('Reset', 'إعادة تعيين')}
        </button>
      </div>

      {/* Result / Preview */}
      {result && (
        <div className="surface-inset p-5 sm:p-6 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="ms-serif text-xl font-semibold text-slate-900">{t('Bulk Add Result', 'نتيجة الإضافة الجماعية')}</h3>
            <button
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(result, null, 2));
                alert(t('Copied!', 'تم النسخ!'));
              }}
              className="btn-ghost-modern px-4 py-2 text-sm"
            >
              {t('Copy JSON', 'نسخ JSON')}
            </button>
          </div>

          <pre className="surface-inset text-slate-800 text-xs font-mono overflow-x-auto p-4 leading-relaxed">
            {JSON.stringify(result, null, 2)}
          </pre>

          {result.failed && result.failed.length > 0 && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              <strong>{t('Errors:', 'الأخطاء:')}</strong>
              <ul className="list-disc ms-5 mt-2">
                {result.failed.map((err, idx) => (
                  <li key={idx}>
                    {err.line ? err.line : t('Invalid entry', 'إدخال غير صالح')} — {err.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}