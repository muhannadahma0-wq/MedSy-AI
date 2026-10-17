import React, { useState, useEffect } from 'react';
import { useNotification } from '../context/notificationContext';
import { useMedicine } from '../context/medicationContext';
import { useLanguage } from '../hooks/useTranslation';
import { 
  Bell, Clock, AlertCircle, Sparkles, Pill, 
  Calendar, ArrowLeft, Filter, RefreshCw, Menu
} from 'lucide-react';

export default function NotificationsPage() {
  const { notifications, fetchTodayNotifications, sendNotification } = useNotification();
  const { todayMedication, medicineStatus } = useMedicine();
  const { t, isRTL } = useLanguage();
  const [filteredNotifications, setFilteredNotifications] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);


  
  useEffect(() => {
    loadNotifications();
    console.log("notification message",notifications)
  }, []);

  useEffect(() => {
    filterNotifications();
  }, [notifications, activeFilter]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      await fetchTodayNotifications();
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterNotifications = () => {
    if (activeFilter === 'all') {
      setFilteredNotifications(notifications);
    } else {
      const filtered = notifications.filter(notif => notif.type === activeFilter);
      setFilteredNotifications(filtered);
    }
  };

  const handleRefresh = async () => {
    await loadNotifications();
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'before':
        return <Clock className="w-5 h-5 text-cyan-600" />;
      case 'onTime':
        return <Bell className="w-5 h-5 text-emerald-600" />;
      case 'after':
        return <AlertCircle className="w-5 h-5 text-rose-600" />;
      case 'test':
        return <Sparkles className="w-5 h-5 text-teal-600" />;
      default:
        return <Bell className="w-5 h-5 text-slate-500" />;
    }
  };

  const getNotificationColor = (type) => {
    switch (type) {
      case 'before':
        return 'bg-cyan-50 border-cyan-100';
      case 'onTime':
        return 'bg-emerald-50 border-emerald-100';
      case 'after':
        return 'bg-rose-50 border-rose-100';
      case 'test':
        return 'bg-teal-50 border-teal-100';
      default:
        return 'bg-slate-50 border-slate-200';
    }
  };

  const getNotificationBadge = (type) => {
    switch (type) {
      case 'before':
        return { text: 'Upcoming', textAr: 'قادمة', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' };
      case 'onTime':
        return { text: 'Take Now', textAr: 'تناول الآن', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      case 'after':
        return { text: 'Missed', textAr: 'فائتة', color: 'bg-rose-50 text-rose-700 border-rose-200' };
      case 'test':
        return { text: 'Test', textAr: 'تجريبي', color: 'bg-teal-50 text-teal-700 border-teal-200' };
      default:
        return { text: 'Info', textAr: 'معلومة', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    }
  };

  const formatTime = (timeString) => {
    const date = new Date(timeString);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const formatDate = (timeString) => {
    const date = new Date(timeString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return t('Today', 'اليوم');
    } else if (date.toDateString() === yesterday.toDateString()) {
      return t('Yesterday', 'أمس');
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const getTypeStats = () => {
    return {
      all: notifications.length,
      before: notifications.filter(n => n.type === 'before').length,
      onTime: notifications.filter(n => n.type === 'onTime').length,
      after: notifications.filter(n => n.type === 'after').length,
      test: notifications.filter(n => n.type === 'test').length
    };
  };

  const stats = getTypeStats();

  const filterTabs = [
    { key: 'all', label: 'All', labelAr: 'الكل', count: stats.all, icon: Filter },
    { key: 'before', label: 'Upcoming', labelAr: 'قادمة', count: stats.before, icon: Clock },
    { key: 'onTime', label: 'Take Now', labelAr: 'تناول الآن', count: stats.onTime, icon: Bell },
    { key: 'after', label: 'Missed', labelAr: 'فائتة', count: stats.after, icon: AlertCircle },
    { key: 'test', label: 'Test', labelAr: 'تجريبي', count: stats.test, icon: Sparkles }
  ];

  const activeTab = filterTabs.find(tab => tab.key === activeFilter);

  return (
    <div className="min-h-screen">
      
      {/* Sidebar — logical start-0 + isRTL-aware hide transform (physical translate) */}
      <aside className={`fixed top-0 start-0 h-full w-64 bg-white border-e border-slate-200/80 z-50 transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? 'translate-x-0' : isRTL ? 'translate-x-full' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="p-6 space-y-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center shadow-sm">
              <Pill className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold text-slate-900 tracking-tight">
              INSIGHT-X
            </span>
          </div>

          <nav className="space-y-1.5">
            <button onClick={() => window.location.href = '#/dashboard'} className="nav-item-modern">
              <Calendar className="w-5 h-5" />
              <span>{t('Dashboard', 'لوحة التحكم')}</span>
            </button>
            <button onClick={() => window.location.href = '#/addmedication'} className="nav-item-modern">
              <Pill className="w-5 h-5" />
              <span>{t('Medications', 'الأدوية')}</span>
            </button>
            <button className="nav-item-active-modern">
              <Bell className="w-5 h-5" />
              <span>{t('Notifications', 'الإشعارات')}</span>
            </button>
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <div className="lg:ms-64 p-4 sm:p-6 space-y-5 sm:space-y-6 relative z-10">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-fade-up">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2.5 hover:bg-white/10 rounded-xl transition-all text-slate-300 hover:text-white" aria-label={t('Toggle menu', 'إظهار/إخفاء القائمة')}>
              <Menu className="w-5 h-5" />
            </button>
            <button onClick={() => window.location.href = '#/dashboard'} className="p-2.5 hover:bg-white/10 rounded-xl transition-all text-slate-300 hover:text-white" aria-label={t('Back to dashboard', 'العودة إلى لوحة التحكم')}>
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </button>
            <div>
              <h1 className="section-title flex items-center gap-3">
                <span>{t('Notifications', 'الإشعارات')}</span>
                <span className="ms-feature-icon">
                  <Bell className="w-5 h-5" />
                </span>
              </h1>
              <p className="ms-eyebrow-canvas mt-2">{t('Your medication reminders and alerts', 'تذكيرات وتنبيهات دوائك')}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button onClick={handleRefresh} className="btn-ghost-dark px-4 py-2.5 text-sm group">
              <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
              <span>{t('Refresh', 'تحديث')}</span>
            </button>
            <button onClick={sendNotification} className="btn-primary-modern px-4 py-2.5 text-sm">
              <Bell className="w-4 h-4" />
              <span>{t('Test Notify', 'إشعار تجريبي')}</span>
            </button>
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
          <div className="glass-card glass-card-hover p-4 animate-fade-up" style={{ animationDelay: '0ms' }}>
            <div className="text-2xl font-bold text-gradient mb-1">{stats.all}</div>
            <div className="text-sm text-slate-500">{t('Total Today', 'إجمالي اليوم')}</div>
          </div>
          <div className="glass-card glass-card-hover p-4 animate-fade-up" style={{ animationDelay: '60ms' }}>
            <div className="text-2xl font-bold text-cyan-600 mb-1">{stats.before}</div>
            <div className="text-sm text-slate-500">{t('Upcoming', 'قادمة')}</div>
          </div>
          <div className="glass-card glass-card-hover p-4 animate-fade-up" style={{ animationDelay: '120ms' }}>
            <div className="text-2xl font-bold text-emerald-600 mb-1">{stats.onTime}</div>
            <div className="text-sm text-slate-500">{t('Take Now', 'تناول الآن')}</div>
          </div>
          <div className="glass-card glass-card-hover p-4 animate-fade-up" style={{ animationDelay: '180ms' }}>
            <div className="text-2xl font-bold text-rose-600 mb-1">{stats.after}</div>
            <div className="text-sm text-slate-500">{t('Missed', 'فائتة')}</div>
          </div>
          <div className="glass-card glass-card-hover p-4 animate-fade-up" style={{ animationDelay: '240ms' }}>
            <div className="text-2xl font-bold text-teal-600 mb-1">{stats.test}</div>
            <div className="text-sm text-slate-500">{t('Test', 'تجريبي')}</div>
          </div>
        </div>

        {/* Filter Tabs — segmented control (horizontally scrollable on mobile) */}
        <div className="ms-segmented animate-fade-up" style={{ animationDelay: '120ms' }}>
          {filterTabs.map(tab => (
            <button 
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`ms-segmented-btn flex items-center gap-1.5 ${activeFilter === tab.key ? 'ms-segmented-active' : ''}`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{t(tab.label, tab.labelAr)} ({tab.count})</span>
            </button>
          ))}
        </div>

        {/* Notifications List */}
        <div className="space-y-3 sm:space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent"></div>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="glass-card p-10 sm:p-12 text-center animate-fade-up">
              <div className="w-16 h-16 bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Bell className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="ms-serif text-lg font-semibold mb-1.5 text-slate-900">{t('No Notifications', 'لا توجد إشعارات')}</h3>
              <p className="text-slate-500 text-sm">
                {activeTab && activeTab.key !== 'all'
                  ? t(`You don't have any ${activeTab.label} notifications yet`, `لا توجد لديك إشعارات ${activeTab.labelAr} بعد`)
                  : t("You don't have any notifications yet", 'لا توجد لديك إشعارات بعد')}
              </p>
            </div>
          ) : (
            <div className="glass-card divide-y divide-slate-100 overflow-hidden animate-fade-up" style={{ animationDelay: '160ms' }}>
              {filteredNotifications.map((notif, idx) => {
                const badge = getNotificationBadge(notif.type);
                return (
                  <div key={idx} className="p-4 sm:p-6 flex items-start gap-4 transition-colors duration-200 hover:bg-slate-50/70">
                    {/* Icon */}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border ${getNotificationColor(notif.type)}`}>
                      {getNotificationIcon(notif.type)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center flex-wrap gap-2.5 mb-1">
                            <h3 className="text-base sm:text-lg font-semibold text-slate-900">{notif.title}</h3>
                            <span className={`chip-modern border ${badge.color}`}>
                              {t(badge.text, badge.textAr)}
                            </span>
                          </div>
                          <p className="text-slate-600 text-sm">{notif.message}</p>
                        </div>
                      </div>

                      {/* Meta Info */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-4 h-4" />
                          <span>{formatTime(notif.time)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-4 h-4" />
                          <span>{formatDate(notif.time)}</span>
                        </div>
                        {notif.medicineName && (
                          <div className="flex items-center gap-1.5">
                            <Pill className="w-4 h-4" />
                            <span>{notif.medicineName}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Empty State Helper */}
        {!loading && notifications.length === 0 && (
          <div className="glass-card p-8 text-center animate-fade-up">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-7 h-7 text-emerald-600" />
            </div>
            <h3 className="ms-serif text-lg font-semibold mb-1.5 text-slate-900">{t('Start Receiving Notifications', 'ابدأ استقبال الإشعارات')}</h3>
            <p className="text-slate-500 text-sm mb-5">{t('Add medications to your schedule to receive timely reminders and alerts', 'أضف الأدوية إلى جدولك لتصلك التذكيرات والتنبيهات في وقتها')}</p>
            <button onClick={() => window.location.href = '#/addMedication'} className="btn-primary-modern px-6 py-3 text-sm">
              {t('Add Your First Medication', 'أضف دواءك الأول')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
