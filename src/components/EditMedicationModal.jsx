import React, { useState } from "react";
import {
  Pill, Clock, Calendar, Plus, Trash2, XCircle,
  AlertCircle, Save, Loader,
} from "lucide-react";
import { useLanguage } from "../hooks/useTranslation.js";
import { apiClient } from "../services/api/client";

/**
 * EditMedicationModal — inline editor for one medication of the caller.
 *
 * Self-contained by design: receives the serialized medication (the object
 * /api/medicine/today and /api/medicine/list return), keeps a local draft,
 * and submits a PARTIAL update to /api/medicine/update. Auth is attached by
 * the shared apiClient (JWT); identity is never taken from the payload.
 *
 * Safety UX mirrors /api/medicine/add:
 *   • a rename that triggers the interaction shield shows the bilingual
 *     warning inline with an explicit "confirm anyway" action (the endpoint
 *     blocks MAJOR interactions outright — the client cannot override those);
 *   • schedule changes re-materialize future dose events server-side.
 */
export default function EditMedicationModal({ med, onClose, onSaved }) {
  const { t } = useLanguage();

  const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const dayDisplayNames = {
    Monday: t('Mon', 'الاثنين'),
    Tuesday: t('Tue', 'الثلاثاء'),
    Wednesday: t('Wed', 'الأربعاء'),
    Thursday: t('Thu', 'الخميس'),
    Friday: t('Fri', 'الجمعة'),
    Saturday: t('Sat', 'السبت'),
    Sunday: t('Sun', 'الأحد'),
  };
  const reminderOptions = ["5m", "10m", "15m", "30m", "1h"];

  const toDateString = (value) => {
    if (!value) return "";
    try {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return "";
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    } catch {
      return "";
    }
  };

  const [draft, setDraft] = useState(() => ({
    pillName: med.pillName || "",
    pillDescription: med.pillDescription || "",
    dosageAmount: med.dosageAmount || "",
    frequency: med.frequency || "",
    dosageDays: Array.isArray(med.dosageDays) ? [...med.dosageDays] : [],
    dosageTimes: Array.isArray(med.dosageTimes)
      ? med.dosageTimes.map((dt) => ({
          time: dt.time,
          remindBefore: dt.remindBefore || "15m",
          remindAfter: dt.remindAfter || "30m",
          status: dt.status || "pending",
          takenAt: dt.takenAt ?? null,
        }))
      : [],
    startDate: toDateString(med.startDate),
    endDate: toDateString(med.endDate),
    notes: med.notes || "",
  }));

  const [newSlot, setNewSlot] = useState({ time: "", remindBefore: "15m", remindAfter: "30m" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [interaction, setInteraction] = useState(null); // { highestSeverity, interactions, blocked }

  const setField = (field, value) => setDraft((prev) => ({ ...prev, [field]: value }));

  const toggleDay = (day) =>
    setDraft((prev) => ({
      ...prev,
      dosageDays: prev.dosageDays.includes(day)
        ? prev.dosageDays.filter((d) => d !== day)
        : [...prev.dosageDays, day],
    }));

  const addSlot = () => {
    if (!newSlot.time) {
      setError(t('Please select a time', 'يرجى اختيار وقت'));
      return;
    }
    if (draft.dosageTimes.some((dt) => dt.time === newSlot.time)) {
      setError(t('This time is already added', 'هذا الوقت مُضاف مسبقاً'));
      return;
    }
    setError(null);
    setDraft((prev) => ({
      ...prev,
      dosageTimes: [...prev.dosageTimes, { ...newSlot, status: "pending", takenAt: null }],
    }));
    setNewSlot({ time: "", remindBefore: "15m", remindAfter: "30m" });
  };

  const removeSlot = (index) =>
    setDraft((prev) => ({
      ...prev,
      dosageTimes: prev.dosageTimes.filter((_, i) => i !== index),
    }));

  const buildUpdates = (override = false) => ({
    pillName: draft.pillName,
    pillDescription: draft.pillDescription,
    dosageAmount: draft.dosageAmount,
    frequency: draft.frequency,
    dosageDays: draft.dosageDays,
    dosageTimes: draft.dosageTimes,
    startDate: draft.startDate || undefined,
    endDate: draft.endDate || null,
    notes: draft.notes,
    overrideInteractionWarning: override,
  });

  const submit = async (override = false) => {
    if (!draft.pillName.trim()) {
      setError(t('Please enter pill name', 'يرجى إدخال اسم الدواء'));
      return;
    }
    if (draft.dosageDays.length === 0) {
      setError(t('Please select at least one day', 'يرجى اختيار يوم واحد على الأقل'));
      return;
    }
    if (draft.dosageTimes.length === 0) {
      setError(t('Please add at least one dosage time', 'يرجى إضافة وقت جرعة واحد على الأقل'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await apiClient({
        url: "/api/medicine/update",
        method: "POST",
        body: { medId: med._id || med.id, updates: buildUpdates(override) },
        actionType: "UPDATE_MEDICATION",
      });

      if (result?.offline) {
        setError(
          t(
            'Editing requires a connection — changes were not saved.',
            'التعديل يتطلب اتصالاً بالإنترنت — لم يتم حفظ التغييرات.'
          )
        );
        return;
      }

      if (result?.interactionDetected) {
        setInteraction(result);
        return;
      }
      if (!result?.success) {
        setError(result?.message || t('Could not save changes', 'تعذّر حفظ التعديلات'));
        return;
      }
      onSaved?.(result?.data);
    } catch (err) {
      console.error("Error updating medication:", err);
      setError(t('Server error while updating', 'حدث خطأ في الخادم أثناء التعديل'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={t('Edit medication', 'تعديل الدواء')}
      onClick={() => !saving && onClose?.()}
    >
      <div
        className="glass-card w-full max-w-2xl my-8 p-6 sm:p-8 animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-6">
          <div className="min-w-0">
            <p className="ms-eyebrow mb-1.5">{t('EDIT MEDICATION', 'تعديل الدواء')}</p>
            <h3 className="ms-serif text-xl font-semibold text-slate-900 truncate">{med.pillName}</h3>
            <p className="text-sm text-slate-500 mt-1">
              {t('Changes to the schedule re-plan upcoming doses automatically.', 'تغييرات الجدول تعيد تخطيط الجرعات القادمة تلقائياً.')}
            </p>
          </div>
          <button
            onClick={() => !saving && onClose?.()}
            aria-label={t('Cancel', 'إلغاء')}
            className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors hover:bg-slate-100 rounded-lg"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5">
          {/* Name + dose + frequency */}
          <div>
            <label className="label-modern flex items-center gap-2">
              <Pill size={16} className="text-emerald-600" />
              {t('Pill Name', 'اسم الدواء')}
            </label>
            <input
              type="text"
              value={draft.pillName}
              onChange={(e) => setField('pillName', e.target.value)}
              className="input-modern"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label-modern">{t('Dosage Amount', 'الجرعة')}</label>
              <input
                type="text"
                value={draft.dosageAmount}
                onChange={(e) => setField('dosageAmount', e.target.value)}
                placeholder={t('e.g., 500mg', 'مثال: 500mg')}
                className="input-modern"
              />
            </div>
            <div>
              <label className="label-modern">{t('Frequency', 'عدد المرات')}</label>
              <input
                type="text"
                value={draft.frequency}
                onChange={(e) => setField('frequency', e.target.value)}
                placeholder={t('e.g., 2 times a day', 'مثال: مرتين يومياً')}
                className="input-modern"
              />
            </div>
          </div>

          {/* Days */}
          <div>
            <label className="label-modern flex items-center gap-2 mb-3">
              <Calendar size={16} className="text-emerald-600" />
              {t('Select Days', 'اختر الأيام')}
            </label>
            <div className="flex flex-wrap gap-2">
              {weekDays.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-all ${
                    draft.dosageDays.includes(day)
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {dayDisplayNames[day] || day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          {/* Times */}
          <div>
            <label className="label-modern flex items-center gap-2 mb-3">
              <Clock size={16} className="text-emerald-600" />
              {t('Dosage Times', 'أوقات الجرعات')}
            </label>
            <div className="surface-inset p-4 mb-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('Time', 'الوقت')}</label>
                  <input
                    type="time"
                    value={newSlot.time}
                    onChange={(e) => setNewSlot((p) => ({ ...p, time: e.target.value }))}
                    className="input-modern"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('Remind Before', 'تذكير قبل')}</label>
                  <select
                    value={newSlot.remindBefore}
                    onChange={(e) => setNewSlot((p) => ({ ...p, remindBefore: e.target.value }))}
                    className="select-modern"
                  >
                    {reminderOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('Remind After', 'تذكير بعد')}</label>
                  <select
                    value={newSlot.remindAfter}
                    onChange={(e) => setNewSlot((p) => ({ ...p, remindAfter: e.target.value }))}
                    className="select-modern"
                  >
                    {reminderOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={addSlot}
                className="btn-primary-modern w-full py-2.5 mt-3"
              >
                <Plus size={18} /> {t('Add Time', 'إضافة وقت')}
              </button>
            </div>

            {draft.dosageTimes.length > 0 && (
              <div className="space-y-2 max-h-44 overflow-y-auto">
                {draft.dosageTimes.map((slot, index) => (
                  <div key={`${slot.time}-${index}`} className="surface-inset p-3 flex items-center justify-between gap-3">
                    <div className="text-slate-500 min-w-0">
                      <span className="font-semibold text-slate-900">{slot.time}</span>
                      <span className="text-sm ms-2">
                        {t('Before:', 'قبل:')} {slot.remindBefore} | {t('After:', 'بعد:')} {slot.remindAfter}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSlot(index)}
                      aria-label={t('Remove time', 'إزالة الوقت')}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 p-2.5 rounded-lg transition flex-shrink-0"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="label-modern">{t('Description', 'الوصف')}</label>
            <textarea
              value={draft.pillDescription}
              onChange={(e) => setField('pillDescription', e.target.value)}
              rows={2}
              placeholder={t('Notes about this medication...', 'ملاحظات عن هذا الدواء...')}
              className="input-modern resize-none"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              {t('The Arabic translation is refreshed automatically when the description changes.', 'تُحدَّث الترجمة العربية تلقائياً عند تغيير الوصف.')}
            </p>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label-modern">{t('Start Date', 'تاريخ البداية')}</label>
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => setField('startDate', e.target.value)}
                className="input-modern"
              />
            </div>
            <div>
              <label className="label-modern">{t('End Date (Optional)', 'تاريخ الانتهاء (اختياري)')}</label>
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => setField('endDate', e.target.value)}
                className="input-modern"
              />
            </div>
          </div>

          {/* Interaction warning (from the safety shield) */}
          {interaction && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 animate-fade-up">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-amber-800">
                    {t('Drug interaction detected', 'تم رصد تفاعل دوائي')}
                    {interaction.highestSeverity ? ` (${interaction.highestSeverity})` : ''}
                  </p>
                  <ul className="mt-1.5 space-y-1 text-sm text-amber-700">
                    {(interaction.interactions || []).slice(0, 4).map((int, i) => (
                      <li key={i} className="break-words">
                        • {int.drug1} + {int.drug2}: {int.description}
                      </li>
                    ))}
                  </ul>
                  {interaction.blocked ? (
                    <p className="mt-2 text-sm font-medium text-red-700">
                      {t(
                        'A major interaction blocks this rename. Please consult your doctor.',
                        'تفاعل دوائي كبير يمنع هذا التغيير — يرجى استشارة طبيبك.'
                      )}
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => submit(true)}
                      className="mt-3 w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold transition-all"
                    >
                      {t('I reviewed it — save anyway', 'اطلعت عليه — احفظ على أي حال')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-red-700 font-medium text-sm break-words">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 mt-6">
          <button
            type="button"
            onClick={() => !saving && onClose?.()}
            disabled={saving}
            className="btn-ghost-modern px-6 py-3"
          >
            {t('Cancel', 'إلغاء')}
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={saving}
            className="btn-primary-modern flex-1 py-3"
          >
            {saving ? (
              <>
                <Loader size="sm" color="orange" />
                <span className="ms-2">{t('Saving…', 'جارٍ الحفظ…')}</span>
              </>
            ) : (
              <>
                <Save size={20} />
                {t('Save Changes', 'حفظ التعديلات')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
