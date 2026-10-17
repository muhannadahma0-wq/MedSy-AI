import React, { useState, useEffect } from 'react';
import { X, Bell, Clock, Pill, AlertCircle, Sparkles } from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';

/**
 * NotificationToast — "Clean Medical" light redesign (v3), bilingual + RTL.
 * All original logic preserved: slide-in, 5s auto-hide, exit animation,
 * type-colored accents, container capped at 3 toasts, id-keyed list.
 * Notification title/message content stays as-received from the server.
 */
const NotificationToast = ({ notification, onRemove }) => {
  const { t, isRTL, language } = useLanguage();
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  // Plan §11 — snooze action state for dose-linked notifications
  // ('idle' | 'loading' | 'error').
  const [snoozeState, setSnoozeState] = useState('idle');

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onRemove(notification.id);
    }, 300);
  };

  // Plan §11 — POST /api/dose-events/snooze for this dose, then dismiss the
  // toast on success. On failure the toast stays visible with a one-line
  // inline error (the 5s auto-hide timer is untouched).
  const handleSnooze = async () => {
    if (snoozeState === 'loading' || !notification.doseEventId) return;
    setSnoozeState('loading');
    try {
      let localuser = null;
      try {
        const stored = localStorage.getItem('user');
        if (stored && stored !== 'undefined') localuser = JSON.parse(stored);
      } catch {
        localuser = null;
      }
      const token = localStorage.getItem('token');
      const tokenValid = token && token !== 'null' && token !== 'undefined' && token.trim() !== '';
      const res = await fetch('/api/dose-events/snooze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tokenValid ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          doseEventId: notification.doseEventId,
          minutes: 10,
          localuser,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `Snooze failed (${res.status})`);
      }
      setSnoozeState('idle');
      handleClose();
    } catch (err) {
      console.error('Error snoozing reminder:', err);
      setSnoozeState('error');
    }
  };

  useEffect(() => {
    // Slide in animation
    const timer = setTimeout(() => setIsVisible(true), 100);

    // Auto-hide after 5 seconds
    const hideTimer = setTimeout(() => {
      handleClose();
    }, 5000);

    return () => {
      clearTimeout(timer);
      clearTimeout(hideTimer);
    };
  }, []);

  const getIcon = () => {
    switch (notification.type) {
      case 'before':
        return <Clock className="w-5 h-5 text-cyan-600" />;
      case 'onTime':
        return <Bell className="w-5 h-5 text-emerald-600" />;
      case 'after':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      case 'snooze':
        return <Clock className="w-5 h-5 text-amber-600" />;
      case 'test':
        return <Sparkles className="w-5 h-5 text-purple-600" />;
      default:
        return <Pill className="w-5 h-5 text-cyan-600" />;
    }
  };

  const getAccentClasses = () => {
    switch (notification.type) {
      case 'before':
        return { tile: 'bg-cyan-50 border border-cyan-100', bar: 'bg-cyan-500/70' };
      case 'onTime':
        return { tile: 'bg-emerald-50 border border-emerald-100', bar: 'bg-emerald-500/70' };
      case 'after':
        return { tile: 'bg-red-50 border border-red-100', bar: 'bg-red-500/70' };
      case 'snooze':
        return { tile: 'bg-amber-50 border border-amber-100', bar: 'bg-amber-500/70' };
      case 'test':
        return { tile: 'bg-purple-50 border border-purple-100', bar: 'bg-purple-500/70' };
      default:
        return { tile: 'bg-cyan-50 border border-cyan-100', bar: 'bg-cyan-500/70' };
    }
  };

  const accent = getAccentClasses();

  return (
    <div
      className={`
        fixed top-4 end-4 z-50 w-80 max-w-sm
        transform transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${isVisible && !isExiting ? 'translate-x-0 opacity-100' : isRTL ? '-translate-x-full opacity-0' : 'translate-x-full opacity-0'}
      `}
    >
      <div
        className={`
          relative overflow-hidden rounded-2xl bg-white border border-white/60 p-4 shadow-[0_16px_44px_-8px_rgba(2,6,23,0.55)]
        `}
      >
        <div className="flex items-start gap-3">
          {/* Icon tile */}
          <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${accent.tile}`}>
            {getIcon()}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* dir="auto" — server notifications are localized (ar/en per
                recipient) but embed raw medication names: an Arabic sentence
                with a Latin drug name must render with the correct base
                direction in BOTH UI directions (the 2-c/50 follow-up). */}
            <h4 className="text-sm font-semibold text-slate-900 mb-0.5" dir="auto">
              {notification.title}
            </h4>
            <p className="text-sm text-slate-600 leading-relaxed" dir="auto">
              {notification.message}
            </p>
            <p className="text-xs text-slate-400 mt-2">
              {new Date(notification.timestamp).toLocaleTimeString(language === 'ar' ? 'ar' : 'en-US')}
            </p>
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            aria-label={t('Dismiss notification', 'إغلاق الإشعار')}
            className="flex-shrink-0 text-slate-400 hover:text-slate-700 transition-colors p-1.5 hover:bg-slate-100 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Plan §11 — snooze action footer (only for dose-linked notifications):
            ghost button with a 44px touch target, neutral→emerald tint. */}
        {notification.doseEventId && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            {snoozeState === 'error' && (
              <p className="flex-1 min-w-0 truncate text-xs text-red-600" role="alert">
                {t('Could not snooze. Try again.', 'تعذّر تأجيل التذكير. حاول مرة أخرى.')}
              </p>
            )}
            <button
              onClick={handleSnooze}
              disabled={snoozeState === 'loading'}
              aria-label={t('Snooze 10m', 'تذكير بعد 10 دقائق')}
              className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-all disabled:opacity-60"
            >
              <Clock className="w-4 h-4" />
              {snoozeState === 'loading' ? '…' : t('Snooze 10m', 'تذكير بعد 10 دقائق')}
            </button>
          </div>
        )}

        {/* Auto-dismiss progress bar */}
        <div className="absolute bottom-0 inset-x-0 h-0.5 overflow-hidden rounded-b-2xl bg-slate-100">
          <div
            className={`h-full ${isRTL ? 'origin-right' : 'origin-left'} ${accent.bar}`}
            style={{
              animation: 'medsync-toast-progress 5s linear forwards',
            }}
          />
        </div>
      </div>
    </div>
  );
};

const NotificationContainer = ({ notifications, onRemoveNotification }) => {
  // Only show the most recent 3 notifications as toasts
  const recentNotifications = notifications.slice(0, 3);

  return (
    <div className="fixed top-0 end-0 z-50 pointer-events-none">
      <div className="space-y-2 p-4">
        {recentNotifications.map((notification, index) => (
          <div
            key={notification.id}
            className="pointer-events-auto"
            style={{
              zIndex: 1000 - index,
              transform: `translateY(${index * 4}px)`,
            }}
          >
            <NotificationToast
              notification={notification}
              onRemove={onRemoveNotification}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotificationContainer;
