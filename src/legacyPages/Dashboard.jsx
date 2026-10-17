import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pill, Calendar, TrendingUp, Clock, CheckCircle, XCircle, AlertCircle,
  Flame, Sparkles, Brain, Heart, Activity, FileText,
  Settings, LogOut, Plus, ChevronRight, Bell, Menu, RefreshCw,
  Languages, LayoutDashboard, HeartPulse, BotMessageSquare, ChartLine, Settings2,
  MessageSquare, Radar, Ban, Gauge, Pencil, Trash2
} from 'lucide-react';
import { useMedicine } from '../context/medicationContext.jsx';
import { useNotification } from '../context/notificationContext.jsx';
import { useLanguage } from '../hooks/useTranslation.js';
import { useCalendarSync } from '../context/calendarSyncContext.jsx';
// Phase 11 — offline queue awareness (badge state + post-sync refresh).
import { SYNC_COMPLETE_EVENT } from '../services/offline/syncEngine';

import Analytics from "./Analytics";


import Loader from '../components/Loader';
import Button from '../components/Button';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import AppSidebar from '../components/AppSidebar.jsx';
// Medication lifecycle — inline editor modal (edit / delete wiring is additive).
import EditMedicationModal from '../components/EditMedicationModal.jsx';

export default function Dashboard() {

  const { todayMedication, medicineStatus, getStreakDays, fetchAllMedications, deleteMedication } = useMedicine();

  const { notifications, sendNotification, fetchTodayNotifications } = useNotification();

  const { syncStatus, checkSyncStatus, syncToCalendar, connectCalendar } = useCalendarSync();

  const { t, language: currentLanguage } = useLanguage();

  const navigate = useNavigate();

  const [medications, setMedications] = useState([]);
  const [filteredMeds, setFilteredMeds] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [processingMeds, setProcessingMeds] = useState({}); // Track loading state for each med action
  const [streak, setStreak] = useState(12);  //  will add it for afterwards(streak = number of days for 100% adherence)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [linked, setLinked] = useState(false);
  const [account, setAccount] = useState('');
  const [syncToast, setSyncToast] = useState(null); // Toast notification state

  const [currentUser, setCurrentUser] = useState(null);
  const [showOriginal, setShowOriginal] = useState({});

  // Plan §12 — Skip action state: pending DoseEvent lookup (medId@slotTime →
  // doseEventId), the open reason picker, its in-flight flag and its toast.
  const [doseEventLookup, setDoseEventLookup] = useState({});
  const [skipPicker, setSkipPicker] = useState(null); // { medId, pillName, slotTime }
  const [skipLoading, setSkipLoading] = useState(false);
  const [skipToast, setSkipToast] = useState(null);

  // Medication lifecycle — management view state (additive wiring):
  // 'today' keeps the original /api/medicine/today behavior; 'all' swaps the
  // list source to /api/medicine/list so every regimen (even one not
  // scheduled today) can be inspected, edited or deleted.
  const [medView, setMedView] = useState('today'); // 'today' | 'all'
  const medViewRef = useRef('today');
  medViewRef.current = medView;
  const [deleteTarget, setDeleteTarget] = useState(null); // medication object awaiting confirmation
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteToast, setDeleteToast] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // medication object in the editor


  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    console.log("storedUser: ", storedUser);
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        console.log("Loaded currentUser:", parsedUser);
        setCurrentUser(parsedUser);
      } catch (error) {
        console.error("Error parsing stored user:", error);
      }
    } else {
      console.warn("No user found in localStorage");
    }
  }, []);

  useEffect(() => {
    fetchTodayMedications();
    getStreakDays().then(setStreak);
    checkSyncStatus(); // Check calendar sync status on load
  }, [checkSyncStatus]);

  // Phase 11 — after the offline queue replays successfully, refresh the
  // cards/streak so optimistically-marked doses reflect the server's truth.
  useEffect(() => {
    const onSyncComplete = () => {
      fetchTodayMedications();
      getStreakDays().then(setStreak);
    };
    window.addEventListener(SYNC_COMPLETE_EVENT, onSyncComplete);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, onSyncComplete);
  }, []);

  useEffect(() => {
    filterMedications();
  }, [medications, activeFilter]);

  // Plan §12 — refresh the pending DoseEvent lookup whenever today's
  // medication list changes (initial load, Mark Taken, Skip).
  useEffect(() => {
    if (medications.length > 0) {
      fetchTodayDoseEvents();
    }
  }, [medications]);

  const fetchTodayMedications = async () => {
    setLoading(true);
    try {
      const data = await todayMedication();
      // Phase 11 — offline: keep whatever is already rendered (no server
      // truth available); the sync badge shows the offline/queued state.
      if (data?.offline) {
        console.log('Offline — keeping currently rendered medication list');
        return;
      }
      console.log('Fetched today\'s medications:', data);
      setMedications(Array.isArray(data) ? data : data?.data || []);
      console.log("medications", medications)
    } catch (error) {
      console.error('Error fetching medications:', error);
    } finally {
      setLoading(false);
    }
  };


  const filterMedications = () => {
    if (activeFilter === 'all') {
      setFilteredMeds(medications);
    } else {
      const filtered = medications.filter(med =>
        med.dosageTimes.some(dt => dt.status === activeFilter)
      );
      console.log("filtered medicine ", filtered)
      setFilteredMeds(filtered);
    }
  };

  // Medication lifecycle — fetch EVERY regimen of the caller (management view).
  // Same response contract as todayMedication (data array of serialized meds).
  const fetchAllMeds = async () => {
    setLoading(true);
    try {
      const data = await fetchAllMedications();
      if (data?.offline) {
        console.log('Offline — keeping currently rendered medication list');
        return;
      }
      setMedications(Array.isArray(data) ? data : data?.data || []);
    } catch (error) {
      console.error('Error fetching all medications:', error);
    } finally {
      setLoading(false);
    }
  };

  // Medication lifecycle — one refresh path that respects the active view, so
  // Mark Taken / Skip / Delete / Edit all land on the list the user is looking
  // at (the today path is byte-for-byte the original fetchTodayMedications).
  const refreshMedications = () =>
    medViewRef.current === 'all' ? fetchAllMeds() : fetchTodayMedications();

  // Medication lifecycle — swap list source when the view toggle changes.
  useEffect(() => {
    if (medView === 'all') {
      fetchAllMeds();
    }
    // 'today' is covered by the mount effect below (and stays the default).
  }, [medView]);

  // Medication lifecycle — delete after explicit confirmation. The endpoint
  // cascades to dose events, reminders and risk predictions; the UI refreshes
  // the active view + streak afterwards.
  const handleDeleteMedication = async () => {
    if (!deleteTarget || deleteLoading) return;
    const medId = deleteTarget._id || deleteTarget.id;
    setDeleteLoading(true);
    try {
      const result = await deleteMedication(medId);
      if (result?.offline) {
        setDeleteToast({
          type: 'error',
          message: t('Deleting requires a connection', 'الحذف يتطلب اتصالاً بالإنترنت'),
        });
        setTimeout(() => setDeleteToast(null), 7000);
        setDeleteTarget(null);
        return;
      }
      if (!result?.success) {
        throw new Error(result?.message || `Delete failed`);
      }
      const removed = result?.data?.removed;
      setDeleteTarget(null);
      setDeleteToast({
        type: 'success',
        message: t('Medication deleted', 'تم حذف الدواء'),
        details: removed
          ? t(
              `${removed.doseEvents} dose events, ${removed.smartReminders} reminders and ${removed.riskPredictions} risk records removed`,
              `تمت إزالة ${removed.doseEvents} حدث جرعة و${removed.smartReminders} تذكيراً و${removed.riskPredictions} سجل مخاطر`
            )
          : undefined,
      });
      setTimeout(() => setDeleteToast(null), 5000);
      await refreshMedications();
      getStreakDays().then(setStreak);
    } catch (error) {
      console.error('Error deleting medication:', error);
      setDeleteTarget(null);
      setDeleteToast({
        type: 'error',
        message: t('Could not delete this medication', 'تعذّر حذف هذا الدواء'),
        details: error?.message,
      });
      setTimeout(() => setDeleteToast(null), 7000);
    } finally {
      setDeleteLoading(false);
    }
  };

  // Medication lifecycle — after a successful edit, close the modal, tell the
  // user, and refresh the active view (the server may have re-planned the
  // upcoming doses when the schedule changed).
  const handleEditSaved = async () => {
    setEditTarget(null);
    setDeleteToast({
      type: 'success',
      message: t('Medication updated', 'تم تعديل الدواء بنجاح'),
    });
    setTimeout(() => setDeleteToast(null), 5000);
    await refreshMedications();
    getStreakDays().then(setStreak);
  };

  // Plan §12 — build the medicationId@slotTime → doseEventId lookup for
  // today's PENDING dose events (the Skip action needs the id; /api/medicine/today
  // does not carry it). Reads the logged-in user the same way the contexts do.
  const fetchTodayDoseEvents = async () => {
    try {
      const stored = localStorage.getItem('user');
      if (!stored || stored === 'undefined') return;
      const user = JSON.parse(stored);
      const uid = user?.id || user?._id;
      if (!uid) return;
      const res = await fetch(`/api/dose-events?range=today&limit=200&userId=${encodeURIComponent(uid)}`, {
        // Phase 12 — authenticated raw fetch.
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success || !Array.isArray(data.doseEvents)) return;
      const lookup = {};
      for (const ev of data.doseEvents) {
        if (ev.status === 'pending') {
          lookup[`${ev.medicationId}@${ev.slotTime}`] = ev.id;
        }
      }
      setDoseEventLookup(lookup);
    } catch (error) {
      console.error('Error fetching dose events:', error);
    }
  };

  // Plan §12 — honest skip reasons (behavioral signal, never a medical decision).
  const skipReasons = [
    { value: 'forgot', label: t('Forgot', 'نسيان') },
    { value: 'not_needed', label: t('Not needed', 'غير ضروري') },
    { value: 'doctor', label: t("Doctor's instruction", 'تعليمات الطبيب') },
    { value: 'side_effects', label: t('Side effects', 'آثار جانبية') },
    { value: 'other', label: t('Other', 'أخرى') }
  ];

  // Plan §12 — open the reason picker for the card's first pending dose slot.
  const openSkipPicker = (med) => {
    const slots = Array.isArray(med.dosageTimes) ? med.dosageTimes : [];
    const pendingSlot = slots.find(dt => dt.status === 'pending');
    if (!pendingSlot) return;
    setSkipPicker({ medId: med._id, pillName: med.pillName, slotTime: pendingSlot.time });
  };

  // Plan §12 — POST /api/dose-events/skip with the picked reason, then run the
  // same data-refresh path Mark Taken uses so cards and counts update.
  const handleSkipDose = async (reason) => {
    if (!skipPicker || skipLoading) return;
    const { medId, slotTime } = skipPicker;
    setSkipLoading(true);
    try {
      // Pending DoseEvent for this med+slot — built when today's meds load. A
      // miss still flows to the API and surfaces its honest error as a toast.
      const doseEventId = doseEventLookup[`${medId}@${slotTime}`] || null;
      let localuser = null;
      try {
        const stored = localStorage.getItem('user');
        if (stored && stored !== 'undefined') localuser = JSON.parse(stored);
      } catch {
        localuser = null;
      }
      const token = localStorage.getItem('token');
      const tokenValid = token && token !== 'null' && token !== 'undefined' && token.trim() !== '';
      const res = await fetch('/api/dose-events/skip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tokenValid ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ doseEventId, reason, localuser }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `Skip failed (${res.status})`);
      }
      setSkipPicker(null);
      setSkipToast({ type: 'success', message: t('Dose skipped', 'تم تخطي الجرعة') });
      setTimeout(() => setSkipToast(null), 5000);
      // Same refresh path Mark Taken uses (the [medications] effect then
      // refreshes the pending DoseEvent lookup).
      await refreshMedications();
    } catch (error) {
      console.error('Error skipping dose:', error);
      setSkipPicker(null);
      setSkipToast({
        type: 'error',
        message: t('Could not skip this dose', 'تعذّر تخطي هذه الجرعة'),
        details: error?.message
      });
      setTimeout(() => setSkipToast(null), 7000);
    } finally {
      setSkipLoading(false);
    }
  };

  const handleStatusToggle = async (medId) => {
    setProcessingMeds(prev => ({ ...prev, [medId]: true }));
    try {
      // FIX (original-repo bug): original called medicineStatus(medId) with no status,
      // which the original statusMedicineController rejects with 400 "Invalid status",
      // so the "Mark Taken" button never worked. Pass 'taken' explicitly (button label).
      const result = await medicineStatus(medId, 'taken');
      // Phase 11 — offline: the write was queued for replay. Update the UI
      // optimistically (first pending slot → taken) and tell the user the
      // confirmation will sync when connectivity returns. No refetch — the
      // server hasn't applied anything yet.
      if (result?.offline && result?.queued) {
        setMedications(prev => prev.map(med => {
          if (med._id !== medId) return med;
          const slots = Array.isArray(med.dosageTimes) ? [...med.dosageTimes] : [];
          const idx = slots.findIndex(dt => dt.status === 'pending');
          if (idx >= 0) slots[idx] = { ...slots[idx], status: 'taken' };
          return { ...med, dosageTimes: slots };
        }));
        setSyncToast({
          type: 'info',
          message: t('Saved offline — will sync automatically', 'تم الحفظ دون اتصال — ستتم المزامنة تلقائيًا'),
        });
        setTimeout(() => setSyncToast(null), 5000);
        return;
      }
      await refreshMedications();
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setProcessingMeds(prev => ({ ...prev, [medId]: false }));
    }
  };
 const handleStatusChange = async (medId, status) => {
  try {
    await medicineStatus(medId, status);
    await fetchTodayMedications();
  } catch (err) {
    console.error(err);
  }
};


  // Med status icon tile — flat tinted tile per status (full static class strings)
  const getStatusColor = (status) => {
    switch (status) {
      case 'taken': return 'bg-emerald-50 border border-emerald-100 text-emerald-600';
      case 'missed': return 'bg-red-50 border border-red-100 text-red-600';
      case 'delayed': return 'bg-amber-50 border border-amber-100 text-amber-600';
      case 'skipped': return 'bg-amber-50 border border-amber-100 text-amber-600';
      default: return 'bg-slate-100 border border-slate-200 text-slate-500';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'taken': return <CheckCircle className="w-5 h-5" />;
      case 'missed': return <XCircle className="w-5 h-5" />;
      case 'delayed': return <AlertCircle className="w-5 h-5" />;
      case 'skipped': return <Ban className="w-5 h-5" />;
      default: return <Clock className="w-5 h-5" />;
    }
  };

  // Dose-time chip styling (status → semantic chip; full static class strings)
  const getDoseChipClass = (status) => {
    switch (status) {
      case 'taken': return 'chip-modern chip-taken';
      case 'missed': return 'chip-modern chip-missed';
      case 'delayed': return 'chip-modern chip-delayed';
      case 'skipped': return 'chip-modern chip-delayed';
      default: return 'chip-modern chip-pending';
    }
  };

  // Display-only status labels — raw API values ("taken"/"pending"/…) stay untouched
  const statusLabels = {
    taken: t('Taken', 'تم تناوله'),
    pending: t('Pending', 'قيد الانتظار'),
    missed: t('Missed', 'فائت'),
    delayed: t('Delayed', 'متأخر'),
    skipped: t('Skipped', 'مخطّاة')
  };

  const getTodayStats = () => {
    const allDoses = Array.isArray(medications)
      ? medications.flatMap(m => Array.isArray(m.dosageTimes) ? m.dosageTimes : [])
      : [];
    return {
      total: allDoses.length,
      taken: allDoses.filter(d => d.status === 'taken').length,
      missed: allDoses.filter(d => d.status === 'missed').length,
      delayed: allDoses.filter(d => d.status === 'delayed').length,
      pending: allDoses.filter(d => d.status === 'pending').length
    };
  };

  const stats = getTodayStats();
  const adherenceRate = stats.total > 0 ? Math.round((stats.taken / stats.total) * 100) : 0;

  const aiAgents = [
    { icon: Brain, title: t('Medical Knowledge', 'المعرفة الطبية'), tile: 'bg-purple-50 border border-purple-100', iconColor: 'text-purple-600', desc: t('Ask about diseases & symptoms', 'اسأل عن الأمراض والأعراض') },
    { icon: Heart, title: t('Personal Health', 'الصحة الشخصية'), tile: 'bg-rose-50 border border-rose-100', iconColor: 'text-rose-600', desc: t('Track your health journey', 'تابع رحلتك الصحية') },
    { icon: Pill, title: t('Medication Specialist', 'أخصائي الأدوية'), tile: 'bg-cyan-50 border border-cyan-100', iconColor: 'text-cyan-600', desc: t('Drug info & interactions', 'معلومات الأدوية وتفاعلاتها') },
    { icon: Activity, title: t('Emergency Triage', 'فرز الطوارئ'), tile: 'bg-amber-50 border border-amber-100', iconColor: 'text-amber-600', desc: t('Urgent symptom assessment', 'تقييم عاجل للأعراض') }
  ];

  // Shared "Rhythm" sidebar navigation (desktop)
  const sidebarItems = [
    { id: 'dashboard', label: t('Dashboard', 'لوحة التحكم'), icon: LayoutDashboard, onClick: () => navigate('/dashboard') },
    { id: 'health', label: t('Health', 'الصحة'), icon: HeartPulse, onClick: () => navigate('/health') },
    { id: 'agents', label: t('AI Assistant', 'المساعد الذكي'), icon: BotMessageSquare, onClick: () => navigate('/agents') },
    { id: 'reports', label: t('Reports', 'التقارير'), icon: FileText, onClick: () => navigate('/reports') },
    { id: 'analytics', label: t('Analytics', 'التحليلات'), icon: ChartLine, onClick: () => navigate('/analytics') },
    { id: 'intelligence', label: t('Intelligence', 'الذكاء التنبؤي'), icon: Radar, onClick: () => navigate('/intelligence') },
    { id: 'ai-monitoring', label: t('AI Monitoring', 'مراقبة الذكاء'), icon: Gauge, onClick: () => navigate('/ai-monitoring') },
    { id: 'settings', label: t('Settings', 'الإعدادات'), icon: Settings2, onClick: () => navigate('/settings') }
  ];

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    // Sandbox port fix: the original logout navigated with a full page unload,
    // which tore the socket down; hash navigation doesn't — announce the auth
    // change so the socket provider disconnects.
    window.dispatchEvent(new Event('medsync-auth-changed'));
    window.location.href = '#/landing';
  };

  const handleConnectCalendar = async () => {
    try {
      connectCalendar();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncCalendar = async () => {
    console.log("[Dashboard] Sync button clicked");
    setSyncToast({ type: 'loading', message: t('Syncing medications to Google Calendar...', 'جارٍ مزامنة الأدوية مع Google Calendar...') });

    try {
      console.log("[Dashboard] Starting sync...");
      const result = await syncToCalendar();
      console.log(`[Dashboard] Sync successful:`, result);

      setSyncToast({
        type: 'success',
        message: t(
          `Success! Synced ${result.syncedEvents} medication events to Google Calendar.`,
          `تمت المزامنة بنجاح! تمت مزامنة ${result.syncedEvents} حدث دوائي إلى Google Calendar.`
        ),
        details: t(`${result.syncedMedications} medications processed`, `تمت معالجة ${result.syncedMedications} دواء`)
      });

      // Auto-hide success toast after 5 seconds
      setTimeout(() => setSyncToast(null), 5000);

      // Refresh sync status
      await checkSyncStatus();
    } catch (error) {
      console.error('[Dashboard] Sync error:', error);
      setSyncToast({
        type: 'error',
        message: t(
          `Sync failed: ${error.message || 'Unknown error'}`,
          `فشلت المزامنة: ${error.message || 'خطأ غير معروف'}`
        ),
        details: t('Check your Google Calendar connection and try again.', 'تحقق من اتصالك بـ Google Calendar ثم حاول مرة أخرى.')
      });

      // Auto-hide error toast after 7 seconds
      setTimeout(() => setSyncToast(null), 7000);
    }
  };



  // Removed old calendar status logic - now using CalendarSyncContext

  return (
    <div className="flex min-h-screen">

      {/* Sidebar (desktop) */}
      <AppSidebar
        items={sidebarItems}
        activeId="dashboard"
        onConnectCalendar={syncStatus.isLinked ? handleSyncCalendar : handleConnectCalendar}
        calendarLabel={syncStatus.isLinked
          ? (syncStatus.isSyncing ? t('Syncing...', 'جارٍ المزامنة...') : t('Sync Medications', 'مزامنة الأدوية'))
          : t('Connect Google Calendar', 'ربط Google Calendar')}
      />

      {/* Mobile drawer overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        ></div>
      )}

      {/* Mobile drawer */}
      <aside className={`fixed top-0 start-0 h-full w-72 max-w-[85vw] z-50 md:hidden bg-slate-950/95 backdrop-blur-xl border-e border-white/10 overflow-y-auto transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'}`}>
        <div className="p-6 space-y-8 min-h-full flex flex-col">
          <div className="flex items-center gap-x-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-sm">
              <Pill className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-white tracking-tight">
              MedSync <span className="text-emerald-400">AI</span>
            </span>
          </div>

          <nav className="space-y-2">
            <button className="w-full flex items-center gap-x-3 px-4 py-3 rounded-xl bg-emerald-500/15 text-emerald-300 font-semibold border border-emerald-400/20">
              <Calendar className="w-5 h-5" />
              <span>{t('Dashboard', 'لوحة التحكم')}</span>
            </button>
            <button onClick={() => window.location.href = '#/addmedication'} className="w-full flex items-center gap-x-3 px-4 py-3 rounded-xl text-slate-300 hover:text-white hover:bg-white/5 transition-all">
              <Pill className="w-5 h-5" />
              <span>{t('Medications', 'الأدوية')}</span>
            </button>
            <button onClick={() => window.location.href = '#/analytics'} className="w-full flex items-center gap-x-3 px-4 py-3 rounded-xl text-slate-300 hover:text-white hover:bg-white/5 transition-all">
              <TrendingUp className="w-5 h-5" />
              <span>{t('Analytics', 'التحليلات')}</span>
            </button>
            <button onClick={() => window.location.href = '#/agents'} className="w-full flex items-center gap-x-3 px-4 py-3 rounded-xl text-slate-300 hover:text-white hover:bg-white/5 transition-all">
              <MessageSquare className="w-5 h-5" />
              <span>{t('AI Assistant', 'المساعد الذكي')}</span>
            </button>
            <button onClick={() => window.location.href = '#/health'} className="w-full flex items-center gap-x-3 px-4 py-3 rounded-xl text-slate-300 hover:text-white hover:bg-white/5 transition-all">
              <Settings className="w-5 h-5" />
              <span>{t('Health Profile', 'الملف الصحي')}</span>
            </button>

            {/* Calendar Sync Section */}
            <div className="pt-4 border-t border-white/10">
              <p className="text-slate-500 text-xs font-medium mb-2 px-4 tracking-wider">{t('CALENDAR SYNC', 'مزامنة التقويم')}</p>

              {syncStatus.isLinked ? (
                <div className="space-y-2">
                  <div className="px-4 py-2 text-emerald-400 text-sm flex items-center gap-x-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-soft" />
                    <span>{t('Google Calendar Connected', 'تم الاتصال بـ Google Calendar')}</span>
                  </div>

                  <button
                    onClick={handleSyncCalendar}
                    disabled={syncStatus.isSyncing}
                    className="w-full flex items-center gap-x-3 px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-400/20 text-emerald-300 hover:bg-emerald-500/25 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-5 h-5 ${syncStatus.isSyncing ? 'animate-spin' : ''}`} />
                    <span>{syncStatus.isSyncing ? t('Syncing...', 'جارٍ المزامنة...') : t('Sync Medications', 'مزامنة الأدوية')}</span>
                  </button>

                  {syncStatus.lastSync && (
                    <p className="text-slate-500 text-xs px-4">
                      {t('Last sync:', 'آخر مزامنة:')} {new Date(syncStatus.lastSync).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={handleConnectCalendar}
                  className="w-full flex items-center gap-x-3 px-4 py-3 rounded-xl text-slate-300 hover:text-white hover:bg-white/5 transition-all"
                >
                  <Calendar className="w-5 h-5" />
                  <span>{t('Connect Google Calendar', 'ربط Google Calendar')}</span>
                </button>
              )}
            </div>
          </nav>

          <div className="mt-auto pt-4">
            <button onClick={handleLogout} className="w-full flex items-center gap-x-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-500/10 transition-all">
              <LogOut className="w-5 h-5 rtl:rotate-180" />
              <span>{t('Logout', 'تسجيل الخروج')}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Header */}
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-10 pt-5 sm:pt-6">
          <div className="flex items-center gap-x-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={t('Toggle menu', 'تبديل القائمة')} className="md:hidden p-2.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-all">
              <Menu className="w-6 h-6" />
            </button>
            <p className="ms-eyebrow-canvas hidden sm:block">
              {new Date().toLocaleDateString(currentLanguage === 'ar' ? 'ar' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-x-2 sm:gap-x-3">
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>
            <button onClick={() => window.location.href = '#/notifications'} aria-label={t('Notifications', 'الإشعارات')} className="relative p-3 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-all">
              <Bell className="w-6 h-6" />
              <span className="absolute top-2 end-2 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse-soft" />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 sm:px-6 lg:px-10 py-6 sm:py-8 space-y-6 sm:space-y-8 overflow-x-hidden">

          {/* Hero */}
          <section className="ms-hero p-7 sm:p-10 animate-fade-up">
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
              <div className="max-w-xl min-w-0">
                <p className="ms-serif text-sm sm:text-base text-emerald-800/70">
                  {t('Good morning', 'صباح الخير')}{currentUser?.name ? `, ${currentUser.name.trim().split(/\s+/)[0]}` : ''}
                </p>
                <h1 className="ms-serif text-2xl sm:text-4xl font-semibold tracking-tight text-slate-900 mt-2 leading-snug">
                  {t('A steady day starts with your morning dose.', 'يبدأ يومك الهادئ بجرعة الصباح.')}
                </h1>
                <p className="text-sm sm:text-base text-slate-600 mt-3">
                  {t("Here's your health overview for today", 'إليك نظرة عامة على حالتك الصحية اليوم')}
                </p>
              </div>
              <button
                onClick={() => document.getElementById('medications')?.scrollIntoView({ behavior: 'smooth' })}
                className="btn-primary-modern px-6 py-3.5 text-sm sm:text-base w-full sm:w-auto shrink-0"
              >
                {t('Take next dose', 'تناول الجرعة التالية')}
              </button>
            </div>
          </section>

          {/* Hero Stats */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
            <div className="glass-card glass-card-hover p-6 animate-fade-up">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-cyan-50 border border-cyan-100 rounded-xl flex items-center justify-center">
                  <Flame className="w-6 h-6 text-cyan-600" />
                </div>
                <span className="text-3xl font-bold text-slate-900">{streak}</span>
              </div>
              <h3 className="text-slate-500 text-sm font-medium">{t('Day Streak', 'سلسلة الالتزام')}</h3>
              <p className="text-xs text-slate-400 mt-1">{t('Keep it going! 🔥', 'واصل التقدم! 🔥')}</p>
            </div>

            <div className="glass-card glass-card-hover p-6 animate-fade-up" style={{ animationDelay: '60ms' }}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
                <span className="text-3xl font-bold text-gradient">{adherenceRate}%</span>
              </div>
              <h3 className="text-slate-500 text-sm font-medium">{t("Today's Adherence", 'معدل التزام اليوم')}</h3>
              <p className="text-xs text-slate-400 mt-1">{t(`${stats.taken} of ${stats.total} taken`, `${stats.taken} من ${stats.total} تم تناولها`)}</p>
            </div>

            <div className="glass-card glass-card-hover p-6 animate-fade-up" style={{ animationDelay: '120ms' }}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-amber-50 border border-amber-100 rounded-xl flex items-center justify-center">
                  <Pill className="w-6 h-6 text-amber-600" />
                </div>
                <span className="text-3xl font-bold text-slate-900">{stats.total}</span>
              </div>
              <h3 className="text-slate-500 text-sm font-medium">{t('Total Doses Today', 'إجمالي جرعات اليوم')}</h3>
              <p className="text-xs text-slate-400 mt-1">{t(`${stats.pending} pending`, `${stats.pending} قيد الانتظار`)}</p>
            </div>

            <div className="glass-card glass-card-hover p-6 animate-fade-up" style={{ animationDelay: '180ms' }}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-rose-50 border border-rose-100 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-rose-600" />
                </div>
                <span className="text-3xl font-bold text-slate-900">89%</span>
              </div>
              <h3 className="text-slate-500 text-sm font-medium">{t('This Month', 'هذا الشهر')}</h3>
              <p className="text-xs text-slate-400 mt-1">{t('Great progress!', 'تقدم رائع!')}</p>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

            {/* Medication Plan */}
            <section id="medications" className="glass-card p-5 sm:p-7 col-span-1 lg:col-span-2 scroll-mt-6 animate-fade-up">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
                <div>
                  <p className="ms-eyebrow mb-1.5">{t('YOUR RHYTHM', 'إيقاعك اليومي')}</p>
                  <h2 className="ms-serif text-xl sm:text-2xl font-semibold text-slate-900">{t('Your Medication Plan', 'خطة الأدوية الخاصة بك')}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="chip-modern chip-pending">
                    {medView === 'today'
                      ? `${stats.total} ${t('doses today', 'جرعات اليوم')}`
                      : `${medications.length} ${t('medications', 'دواء')}`}
                  </span>
                  {/* Medication lifecycle — Today / All view toggle (additive) */}
                  <div className="ms-segmented" role="tablist" aria-label={t('Medication view', 'عرض الأدوية')}>
                    <button
                      role="tab"
                      aria-selected={medView === 'today'}
                      onClick={() => setMedView('today')}
                      className={medView === 'today' ? 'ms-segmented-btn ms-segmented-active' : 'ms-segmented-btn'}
                    >
                      {t('Today', 'اليوم')}
                    </button>
                    <button
                      role="tab"
                      aria-selected={medView === 'all'}
                      onClick={() => setMedView('all')}
                      className={medView === 'all' ? 'ms-segmented-btn ms-segmented-active' : 'ms-segmented-btn'}
                    >
                      {t('All Meds', 'كل الأدوية')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="ms-segmented mb-5">
                <button
                  onClick={() => setActiveFilter('all')}
                  className={activeFilter === 'all' ? 'ms-segmented-btn ms-segmented-active' : 'ms-segmented-btn'}
                >
                  {t('All', 'الكل')} ({stats.total})
                </button>
                <button
                  onClick={() => setActiveFilter('taken')}
                  className={activeFilter === 'taken' ? 'ms-segmented-btn ms-segmented-active' : 'ms-segmented-btn'}
                >
                  {t('Taken', 'تم تناوله')} ({stats.taken})
                </button>
                <button
                  onClick={() => setActiveFilter('pending')}
                  className={activeFilter === 'pending' ? 'ms-segmented-btn ms-segmented-active' : 'ms-segmented-btn'}
                >
                  {t('Pending', 'قيد الانتظار')} ({stats.pending})
                </button>
                <button
                  onClick={() => setActiveFilter('delayed')}
                  className={activeFilter === 'delayed' ? 'ms-segmented-btn ms-segmented-active' : 'ms-segmented-btn'}
                >
                  {t('Delayed', 'متأخر')} ({stats.delayed})
                </button>
                <button
                  onClick={() => setActiveFilter('missed')}
                  className={activeFilter === 'missed' ? 'ms-segmented-btn ms-segmented-active' : 'ms-segmented-btn'}
                >
                  {t('Missed', 'فائت')} ({stats.missed})
                </button>
              </div>

              {/* Medications List */}
              <div className="space-y-4">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader size="lg" color="orange" />
                  </div>
                ) : filteredMeds.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 p-6 sm:p-12 text-center">
                    <Sparkles className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500">{t('No medications to show', 'لا توجد أدوية لعرضها')}</p>
                  </div>
                ) : (
                  (Array.isArray(filteredMeds) ? filteredMeds : []).map((med, idx) => {
                    // Determine which instructions to display
                    const isTranslated = med.userLanguage && med.userLanguage !== 'en';
                    const displayInstructions = showOriginal[med._id]
                      ? (med.originalInstructions || med.pillDescription)
                      : (med.displayInstructions || med.pillDescription);

                    return (
                      <div key={med._id || idx} className="surface-inset p-4 sm:p-5 flex flex-wrap gap-2 animate-fade-up" style={{ animationDelay: `${Math.min(idx * 60, 360)}ms` }}>
                        <div className="flex items-start justify-between mb-4 w-full">
                          <div className="flex items-center gap-x-4">
                            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${getStatusColor(med.dosageTimes[0]?.status)}`}>
                              {getStatusIcon(med.dosageTimes[0]?.status)}
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-lg font-semibold text-slate-900">{med.pillName}</h3>
                                {/* All-meds view — flag regimens scheduled today */}
                                {medView === 'all' && med.scheduledToday && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                                    <Clock className="w-3 h-3" />
                                    {t('Today', 'اليوم')}
                                  </span>
                                )}
                              </div>
                              <p className="text-slate-500 text-sm">{med.dosageAmount} • {med.frequency}</p>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {/* Medication lifecycle — edit (opens the inline editor modal) */}
                            <button
                              onClick={() => setEditTarget(med)}
                              aria-label={t('Edit medication', 'تعديل الدواء')}
                              title={t('Edit medication', 'تعديل الدواء')}
                              className="flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl text-sm font-medium text-slate-600 bg-white/60 border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-all"
                            >
                              <Pencil className="w-4 h-4" />
                              {t('Edit', 'تعديل')}
                            </button>
                            {/* Medication lifecycle — delete (confirmation modal follows) */}
                            <button
                              onClick={() => setDeleteTarget(med)}
                              aria-label={t('Delete medication', 'حذف الدواء')}
                              title={t('Delete medication', 'حذف الدواء')}
                              className="flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl text-sm font-medium text-slate-600 bg-white/60 border border-slate-200 hover:border-red-300 hover:bg-red-50 hover:text-red-700 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                              {t('Delete', 'حذف')}
                            </button>
                            {/* Plan §12 — Skip action (only while a dose slot is still pending) */}
                            {(Array.isArray(med.dosageTimes) ? med.dosageTimes : []).some(dt => dt.status === 'pending') && (
                              <button
                                onClick={() => openSkipPicker(med)}
                                aria-label={t('Skip', 'تخطي')}
                                className="flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl text-sm font-medium text-slate-500 bg-white/60 border border-slate-200 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-all"
                              >
                                <Ban className="w-4 h-4" />
                                {t('Skip', 'تخطي')}
                              </button>
                            )}
                            <Button
                              onClick={() => handleStatusToggle(med._id)}
                              isLoading={processingMeds[med._id]}
                              variant="primary"
                              className="px-4 py-2.5 text-sm"
                            >
                              {t('Mark Taken', 'تم التناول')}
                            </Button>
                          </div>
                        </div>

                        {
                          displayInstructions && (
                            <div className="mb-4">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-slate-600 text-sm flex-1">{displayInstructions}</p>
                                {isTranslated && (
                                  <button
                                    onClick={() => setShowOriginal(prev => ({ ...prev, [med._id]: !prev[med._id] }))}
                                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyan-700 text-xs transition-all"
                                    title={showOriginal[med._id] ? t('Show translated version', 'عرض النسخة المترجمة') : t('Show original English', 'عرض النص الإنجليزي الأصلي')}
                                  >
                                    <Languages className="w-3 h-3" />
                                    {showOriginal[med._id] ? 'EN' : currentLanguage.toUpperCase()}
                                  </button>
                                )}
                              </div>
                              {isTranslated && !showOriginal[med._id] && (
                                <p className="text-cyan-700/70 text-xs mt-1 flex items-center gap-1">
                                  <Languages className="w-3 h-3" />
                                  {t('Translated from English', 'تمت الترجمة من الإنجليزية')}
                                </p>
                              )}
                            </div>
                          )
                        }

                        <div className="flex flex-wrap gap-2 w-full">
                          {med.dosageTimes.map((dt, i) => (
                            <div key={i} className={`${getDoseChipClass(dt.status)} px-3 py-1.5`}>
                              <Clock className="w-3.5 h-3.5" />
                              <span className="text-sm font-semibold">{dt.time}</span>
                              <span className="text-xs opacity-70">({statusLabels[dt.status] || dt.status})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Add New Medication */}
              <button onClick={() => window.location.href = '#/addMedication'} className="mt-5 w-full rounded-2xl p-6 border-2 border-dashed border-slate-300 hover:border-emerald-500/60 hover:bg-emerald-50/40 transition-all flex items-center justify-center gap-x-3 group min-h-[72px]">
                <Plus className="w-6 h-6 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                <span className="text-slate-500 group-hover:text-emerald-600 transition-colors font-medium">{t('Add New Medication', 'إضافة دواء جديد')}</span>
              </button>
            </section>

            {/* Right Column */}
            <div className="space-y-6 w-full">

              {/* AI Assistant */}
              <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '60ms' }}>
                <div className="flex items-center gap-x-3 mb-6">
                  <div className="w-10 h-10 bg-purple-50 border border-purple-100 rounded-xl flex items-center justify-center">
                    <Brain className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">{t('AI Health Assistant', 'المساعد الصحي الذكي')}</h3>
                    <p className="text-xs text-slate-500">{t('24/7 support', 'دعم على مدار الساعة')}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {aiAgents.map((agent, idx) => (
                    <button
                      key={idx}
                      onClick={() => window.location.href = '#/agents'}
                      className="surface-inset rounded-xl p-4 text-start group transition-all hover:border-emerald-200 hover:bg-emerald-50/50"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${agent.tile}`}>
                        <agent.icon className={`w-5 h-5 ${agent.iconColor}`} />
                      </div>
                      <h4 className="text-sm font-medium mb-1 text-slate-900">{agent.title}</h4>
                      <p className="text-xs text-slate-400">{agent.desc}</p>
                    </button>
                  ))}
                </div>

                <button onClick={() => window.location.href = '#/agents'} className="w-full mt-4 bg-emerald-700 hover:bg-emerald-600 text-white font-semibold py-3 rounded-xl transition-all shadow-[0_6px_18px_-4px_rgba(4,120,87,0.5)] hover:shadow-[0_10px_26px_-6px_rgba(4,120,87,0.6)] flex items-center justify-center gap-x-2 group active:scale-[0.98]">
                  <span>{t('Start Conversation', 'ابدأ المحادثة')}</span>
                  <ChevronRight className="w-5 h-5 rtl:rotate-180 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
                </button>
              </div>

              {/* Quick Actions */}
              <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '120ms' }}>
                <h3 className="font-bold mb-4 text-slate-900">{t('Quick Actions', 'إجراءات سريعة')}</h3>
                <div className="space-y-3">
                  <button onClick={() => window.location.href = '#/reports'} className="w-full flex items-center justify-between px-4 py-3 surface-inset hover:bg-slate-100 rounded-xl transition-all group">
                    <div className="flex items-center gap-x-3">
                      <FileText className="w-5 h-5 text-cyan-600" />
                      <span className="text-sm font-medium text-slate-700">{t('Generate Report', 'إنشاء تقرير')}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-emerald-600 transition-colors rtl:rotate-180" />
                  </button>
                  <button onClick={() => window.location.href = '#/reportChat'} className="w-full flex items-center justify-between px-4 py-3 surface-inset hover:bg-slate-100 rounded-xl transition-all group">
                    <div className="flex items-center gap-x-3">
                      <FileText className="w-5 h-5 text-rose-600" />
                      <span className="text-sm font-medium text-slate-700">{t('Chat With Report', 'الدردشة مع التقرير')}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-emerald-600 transition-colors rtl:rotate-180" />
                  </button>
                  <button onClick={() => window.location.href = '#/report-analysis'} className="w-full flex items-center justify-between px-4 py-3 surface-inset hover:bg-slate-100 rounded-xl transition-all group">
                    <div className="flex items-center gap-x-3">
                      <FileText className="w-5 h-5 text-emerald-600" />
                      <span className="text-sm font-medium text-slate-700">{t('Analyse Health Report', 'تحليل التقرير الصحي')}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-emerald-600 transition-colors rtl:rotate-180" />
                  </button>
                  <button onClick={() => window.location.href = '#/calendar-sync'} className="w-full flex items-center justify-between px-4 py-3 surface-inset hover:bg-slate-100 rounded-xl transition-all group">
                    <div className="flex items-center gap-x-3">
                      <Calendar className="w-5 h-5 text-emerald-600" />
                      <span className="text-sm font-medium text-slate-700">{t('Sync Calendar', 'مزامنة التقويم')}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-emerald-600 transition-colors rtl:rotate-180" />
                  </button>
                </div>
              </div>

              {/* Motivation Card */}
              <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '180ms' }}>
                <div className="w-10 h-10 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center mb-3">
                  <Sparkles className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="font-bold text-lg mb-2 text-slate-900">{t('Keep Going!', 'واصل التقدم!')}</h3>
                <p className="text-sm text-slate-600">{t(
                  `You're on a ${streak}-day streak. Stay consistent and reach your health goals! 🎯`,
                  `أنت على سلسلة التزام من ${streak} يوماً. حافظ على الانتظام وحقق أهدافك الصحية! 🎯`
                )}</p>
              </div>
            </div>
          </div>

          {/* Analytics Section */}
          {currentUser && (
            <div className="mt-8">
              <Analytics userId={currentUser?.id || currentUser?._id} />
            </div>
          )}
        </main>
      </div>

      {
        syncToast && (
          <div className={`fixed bottom-6 end-6 max-w-sm rounded-2xl p-4 bg-white border shadow-xl animate-slide-in-right z-40 ${syncToast.type === 'success'
            ? 'border-emerald-200 text-emerald-800'
            : syncToast.type === 'error'
              ? 'border-red-200 text-red-800'
              : 'border-cyan-200 text-cyan-800'
            }`}>
            <div className="flex items-start gap-x-3">
              <div className="flex-shrink-0 mt-0.5">
                {syncToast.type === 'loading' && (
                  <Loader size="sm" color="blue" />
                )}
                {syncToast.type === 'success' && (
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                )}
                {syncToast.type === 'error' && (
                  <AlertCircle className="w-5 h-5 text-red-600" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-medium">{syncToast.message}</p>
                {syncToast.details && (
                  <p className="text-sm opacity-75 mt-1">{syncToast.details}</p>
                )}
              </div>
              {syncToast.type !== 'loading' && (
                <button
                  onClick={() => setSyncToast(null)}
                  aria-label={t('Dismiss', 'إغلاق')}
                  className="flex-shrink-0 opacity-75 hover:opacity-100 transition p-1.5 rounded-lg hover:bg-slate-100"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )
      }

      {/* Plan §12 — Skip reason picker (glass-card modal on the dark canvas) */}
      {skipPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={t('Skip dose', 'تخطي الجرعة')}
          onClick={() => !skipLoading && setSkipPicker(null)}
        >
          <div
            className="glass-card w-full max-w-md p-6 animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="ms-eyebrow mb-1.5">{t('SKIP DOSE', 'تخطي الجرعة')}</p>
                <h3 className="ms-serif text-xl font-semibold text-slate-900 truncate">{skipPicker.pillName}</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {t(`Why are you skipping the ${skipPicker.slotTime} dose?`, `لماذا ستتخطى جرعة ${skipPicker.slotTime}؟`)}
                </p>
              </div>
              <button
                onClick={() => setSkipPicker(null)}
                aria-label={t('Cancel', 'إلغاء')}
                className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors hover:bg-slate-100 rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 mt-4">
              {skipReasons.map((r) => (
                <button
                  key={r.value}
                  onClick={() => handleSkipDose(r.value)}
                  disabled={skipLoading}
                  className="w-full flex items-center justify-between gap-x-3 min-h-[44px] px-4 py-3 rounded-xl surface-inset text-start hover:border-amber-300 hover:bg-amber-50/60 transition-all disabled:opacity-50 group"
                >
                  <span className="text-sm font-medium text-slate-700">{r.label}</span>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-amber-600 transition-colors rtl:rotate-180" />
                </button>
              ))}
            </div>

            {skipLoading && (
              <div className="flex items-center justify-center gap-x-2 mt-4 text-sm text-slate-500">
                <Loader size="sm" color="orange" />
                <span>{t('Saving…', 'جارٍ الحفظ…')}</span>
              </div>
            )}

            <button
              onClick={() => setSkipPicker(null)}
              disabled={skipLoading}
              className="mt-4 w-full min-h-[44px] rounded-xl text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all disabled:opacity-50"
            >
              {t('Keep this dose', 'الاحتفاظ بالجرعة')}
            </button>
          </div>
        </div>
      )}

      {/* Plan §12 — Skip feedback toast (same pattern as the calendar sync toast) */}
      {skipToast && (
        <div className={`fixed bottom-6 end-6 max-w-sm rounded-2xl p-4 bg-white border shadow-xl animate-slide-in-right z-40 ${skipToast.type === 'success'
          ? 'border-emerald-200 text-emerald-800'
          : 'border-red-200 text-red-800'
          }`}>
          <div className="flex items-start gap-x-3">
            <div className="flex-shrink-0 mt-0.5">
              {skipToast.type === 'success' && (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              )}
              {skipToast.type === 'error' && (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{skipToast.message}</p>
              {skipToast.details && (
                <p className="text-sm opacity-75 mt-1 break-words">{skipToast.details}</p>
              )}
            </div>
            <button
              onClick={() => setSkipToast(null)}
              aria-label={t('Dismiss', 'إلغاء')}
              className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center opacity-75 hover:opacity-100 transition rounded-lg hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Medication lifecycle — delete confirmation (glass-card modal, same
          pattern as the skip picker; destructive action is never one-tap) */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label={t('Delete medication', 'حذف الدواء')}
          onClick={() => !deleteLoading && setDeleteTarget(null)}
        >
          <div
            className="glass-card w-full max-w-md p-6 animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="ms-eyebrow-canvas-danger mb-1.5">{t('DELETE MEDICATION', 'حذف الدواء')}</p>
                <h3 className="ms-serif text-xl font-semibold text-slate-900 truncate">{deleteTarget.pillName}</h3>
              </div>
              <button
                onClick={() => !deleteLoading && setDeleteTarget(null)}
                aria-label={t('Cancel', 'إلغاء')}
                className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors hover:bg-slate-100 rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">
                {t(
                  'This permanently removes the medication together with its dose history, reminders and risk records. This action cannot be undone.',
                  'سيؤدي هذا إلى حذف الدواء نهائياً مع سجل جرعاته وتذكيراته وسجلات المخاطر المرتبطة به. لا يمكن التراجع عن هذا الإجراء.'
                )}
              </p>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-3 mt-5">
              <button
                onClick={() => !deleteLoading && setDeleteTarget(null)}
                disabled={deleteLoading}
                className="btn-ghost-modern px-6 py-3"
              >
                {t('Keep it', 'الاحتفاظ به')}
              </button>
              <button
                onClick={handleDeleteMedication}
                disabled={deleteLoading}
                className="flex-1 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-[0_6px_18px_-4px_rgba(220,38,38,0.45)] active:scale-[0.98]"
              >
                {deleteLoading ? (
                  <>
                    <Loader size="sm" color="orange" />
                    <span>{t('Deleting…', 'جارٍ الحذف…')}</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>{t('Delete permanently', 'حذف نهائي')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Medication lifecycle — feedback toast (delete / edit outcomes) */}
      {deleteToast && (
        <div className={`fixed bottom-6 end-6 max-w-sm rounded-2xl p-4 bg-white border shadow-xl animate-slide-in-right z-40 ${deleteToast.type === 'success'
          ? 'border-emerald-200 text-emerald-800'
          : 'border-red-200 text-red-800'
          }`}>
          <div className="flex items-start gap-x-3">
            <div className="flex-shrink-0 mt-0.5">
              {deleteToast.type === 'success' && (
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              )}
              {deleteToast.type === 'error' && (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{deleteToast.message}</p>
              {deleteToast.details && (
                <p className="text-sm opacity-75 mt-1 break-words">{deleteToast.details}</p>
              )}
            </div>
            <button
              onClick={() => setDeleteToast(null)}
              aria-label={t('Dismiss', 'إلغاء')}
              className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center opacity-75 hover:opacity-100 transition rounded-lg hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Medication lifecycle — inline editor modal (self-contained) */}
      {editTarget && (
        <EditMedicationModal
          med={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleEditSaved}
        />
      )}
    </div>
  );
}
