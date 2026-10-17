import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, TrendingDown, Calendar, Clock, Pill, AlertCircle,
  CheckCircle, XCircle, BarChart3, PieChart, Activity, Target,
  Award, Zap, ChevronDown, Filter, Download, Info, ArrowUp, ArrowDown, ArrowLeft
} from 'lucide-react';
import { 
  LineChart, Line, BarChart as ReBarChart, Bar, PieChart as RePieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../hooks/useTranslation';

// Move StatCard outside component to prevent recreation on every render
const StatCard = ({ title, value, subtitle, icon: Icon, trend, color = 'emerald', style }) => {
  // Rhythm v4 — flat tinted icon tiles on white cards (full static class strings)
  const colorMap = {
    emerald: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
    green: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
    cyan: 'bg-cyan-50 border border-cyan-100 text-cyan-600',
    teal: 'bg-teal-50 border border-teal-100 text-teal-600',
    rose: 'bg-rose-50 border border-rose-100 text-rose-600',
    red: 'bg-rose-50 border border-rose-100 text-rose-600',
    amber: 'bg-amber-50 border border-amber-100 text-amber-600'
  };

  // Only the adherence (accent) KPI keeps the emerald gradient number
  const isAccent = color === 'green' || color === 'emerald';

  return (
    <div className="glass-card glass-card-hover p-6 animate-fade-up" style={style}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colorMap[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${trend.isPositive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
            {trend.isPositive ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
            <span className="text-xs font-bold">{Math.abs(trend.change)}%</span>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <h3 className={`text-3xl font-bold ${isAccent ? 'text-gradient' : 'text-slate-900'}`}>{value}</h3>
        <p className="text-slate-600 text-sm font-semibold">{title}</p>
        {subtitle && <p className="text-xs text-slate-400 font-medium">{subtitle}</p>}
      </div>
    </div>
  );
};

// The API sends byDay keys as English weekday abbreviations ("Mon".."Sun");
// display-only Arabic map for RTL (raw API values stay untouched).
const WEEKDAY_AR = {
  Mon: 'الاثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس',
  Fri: 'الجمعة', Sat: 'السبت', Sun: 'الأحد',
};

// Move CustomTooltip outside component and fix CSS
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white px-3 py-2.5 rounded-xl border border-slate-200 shadow-[0_8px_24px_rgba(16,24,40,0.08)] text-xs text-slate-900 space-y-1">
        <p className="font-semibold">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.color }}>
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function Analytics() {
  const navigate = useNavigate();
  const { t, isRTL } = useLanguage();
  const [dateRange, setDateRange] = useState('30days');
  const [selectedMedicine, setSelectedMedicine] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let uid = null;
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      try {
        uid = JSON.parse(storedUser)?.id;
      } catch (err) {
        console.error("Failed to parse stored user", err);
      }
    }

    if (!uid) {
      console.warn("No user ID found");
      // Defer the state update so the effect body itself stays synchronous
      const timer = setTimeout(() => setLoading(false), 0);
      return () => clearTimeout(timer);
    }

    // Analytics 2.0 — DoseEvent-based KPIs, window follows the date filter.
    // Range changes refetch silently (no full-page spinner flash); `loading`
    // stays true only until the first successful load.
    const daysMap = { '7days': 7, '30days': 30, '90days': 90, custom: 30 };
    const days = daysMap[dateRange] || 30;
    fetch(`/api/analytics/${uid}?days=${days}`, {
      // Phase 12 — authenticated raw fetch (Bearer; the HttpOnly cookie set at
      // login rides along as well).
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
      },
    })
      .then((res) => res.json())
      .then((apiData) => {
        setData(apiData);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [dateRange]);

  if (loading) {
    return (
      <div className="py-16 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-emerald-500 border-t-transparent mx-auto mb-4"></div>
          <p className="text-slate-300 text-lg font-medium">{t('Loading analytics...', 'جارٍ تحميل التحليلات...')}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-16 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <p className="text-slate-300 text-lg font-medium">{t('No analytics data available', 'لا توجد بيانات تحليلات متاحة')}</p>
        </div>
      </div>
    );
  }

  const totalDoses = data.taken + data.missed + data.delayed + data.pending;
  // Analytics 2.0 — the server computes the research-framed confirmation
  // rate over RESOLVED doses (pending/skipped excluded from the denominator);
  // the legacy client-side taken/total was inflated by pending doses.
  const adherenceRate =
    typeof data.confirmationRate === 'number' ? data.confirmationRate : (totalDoses > 0 ? ((data.taken / totalDoses) * 100).toFixed(1) : 0);

  const statusDistribution = [
    { name: t('Taken', 'تم تناوله'), value: data.taken, color: '#10b981' },
    { name: t('Missed', 'فائت'), value: data.missed, color: '#f43f5e' },
    { name: t('Delayed', 'متأخر'), value: data.delayed, color: '#f59e0b' },
    { name: t('Pending', 'قيد الانتظار'), value: data.pending, color: '#06b6d4' },
    ...(data.skipped > 0
      ? [{ name: t('Skipped', 'تم تخطيه'), value: data.skipped, color: '#a78bfa' }]
      : [])
  ];

  // By-hour buckets (Analytics 2.0) — confirmed vs missed per hour of day.
  const hourData = (data.byHour || []).map((h) => ({
    hour: `${h.hour}:00`,
    confirmed: h.confirmed,
    missed: h.missed,
  }));

  // By-medication adherence (Analytics 2.0).
  const medRows = data.byMedication || [];

  const fmtDelay = (min) =>
    min === null || min === undefined
      ? t('—', '—')
      : t(`${min} min late`, `${min} دقيقة تأخير`);

  const barData = Object.entries(data.byDay || {}).map(([date, counts]) => {
    const parsed = new Date(date);
    return {
      // The API sends weekday keys ("Mon".."Sun"); map them to Arabic in RTL and
      // keep the key as-is when it is not a parseable date (prevents "Invalid Date"
      // axis labels).
      date: isNaN(parsed.getTime())
        ? (isRTL ? (WEEKDAY_AR[date] || date) : date)
        : parsed.toLocaleDateString(isRTL ? 'ar' : 'en-US', { month: 'short', day: 'numeric' }),
      taken: counts?.taken || 0,
      missed: counts?.missed || 0,
      delayed: counts?.delayed || 0,
      pending: counts?.pending || 0
    };
  });

  // Enhanced insights logic with better feedback for all adherence levels
  const insights = [];

  // Analytics 2.0: use the research-framed confirmation rate (resolved
  // denominator) when the server provides it.
  const adherencePct =
    typeof data.confirmationRate === 'number' ? data.confirmationRate : null;

  if (data.taken > 0 && totalDoses > 0) {
    const takenPercentage = adherencePct !== null
      ? Math.round(adherencePct)
      : Math.round((data.taken / totalDoses) * 100);
    if (takenPercentage >= 90) {
      insights.push({
        type: 'success',
        icon: Award,
        title: t('Excellent Adherence!', 'التزام ممتاز!'),
        description: t(`You've taken ${takenPercentage}% of your medications. Outstanding commitment to your health!`, `لقد تناولت ${takenPercentage}% من أدويتك. التزام رائع بصحتك!`),
        action: t('Keep it up', 'واصل على هذا النحو')
      });
    } else if (takenPercentage >= 70) {
      insights.push({
        type: 'success',
        icon: Target,
        title: t('Good Progress!', 'تقدم جيد!'),
        description: t(`You've taken ${takenPercentage}% of your medications. You're doing well - keep building this habit!`, `لقد تناولت ${takenPercentage}% من أدويتك. أنت تسير بشكل جيد — واصل بناء هذه العادة!`),
        action: t('Improve consistency', 'حسّن الاستمرارية')
      });
    } else if (takenPercentage >= 50) {
      insights.push({
        type: 'info',
        icon: Activity,
        title: t('Room for Improvement', 'مجال للتحسين'),
        description: t(`You've taken ${takenPercentage}% of your medications. Setting reminders can help you stay on track.`, `لقد تناولت ${takenPercentage}% من أدويتك. يمكن لضبط التذكيرات أن يساعدك على البقاء على المسار الصحيح.`),
        action: t('Set reminders', 'اضبط التذكيرات')
      });
    } else {
      insights.push({
        type: 'warning',
        icon: AlertCircle,
        title: t('Needs Attention', 'يحتاج انتباهاً'),
        description: t(`You've taken ${takenPercentage}% of your medications. Let's work on improving your adherence.`, `لقد تناولت ${takenPercentage}% من أدويتك. لنعمل معاً على تحسين التزامك.`),
        action: t('Create schedule', 'أنشئ جدولاً')
      });
    }
  }

  if (data.missed > 0) {
    insights.push({
      type: 'warning',
      icon: AlertCircle,
      title: t('Missed Doses Detected', 'تم رصد جرعات فائتة'),
      description: t(`You've missed ${data.missed} dose${data.missed > 1 ? 's' : ''}. Consider setting additional reminders.`, `فاتتك ${data.missed} من الجرعات. فكّر في ضبط تذكيرات إضافية.`),
      action: t('Add reminders', 'أضف تذكيرات')
    });
  }

  if (data.delayed > 0) {
    insights.push({
      type: 'info',
      icon: Clock,
      title: t('Delayed Medications', 'أدوية متأخرة'),
      description: t(`${data.delayed} dose${data.delayed > 1 ? 's were' : ' was'} taken late. Try to maintain consistent timing.`, `تم تناول ${data.delayed} من الجرعات في وقت متأخر. حاول الحفاظ على توقيت ثابت.`),
      action: t('Adjust schedule', 'عدّل الجدول')
    });
  }

  if (insights.length === 0) {
    insights.push({
      type: 'info',
      icon: Zap,
      title: t('Getting Started', 'البداية'),
      description: t('Keep tracking your medications to see personalized insights here.', 'واصل تتبع أدويتك لترى رؤى مخصصة هنا.'),
      action: t('Add medication', 'أضف دواءً')
    });
  }

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 animate-fade-up">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            aria-label={t('Go back', 'الرجوع')}
            className="p-3 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl transition-all group"
          >
            <ArrowLeft className="w-6 h-6 rtl:rotate-180 ltr:group-hover:-translate-x-1 rtl:group-hover:translate-x-1 transition-transform" />
          </button>
          <div>
            <h1 className="section-title flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-sm shrink-0">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              {t('Analytics Dashboard', 'لوحة تحكم التحليلات')}
            </h1>
            <p className="ms-eyebrow-canvas mt-2">{t('Comprehensive insights into your medication adherence', 'رؤى شاملة حول الالتزام بتناول أدويتك')}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className="btn-ghost-dark px-4 py-2.5 text-sm"
          >
            <Filter className="w-5 h-5" />
            <span>{t('Filters', 'التصفية')}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          
          <button className="btn-primary-modern px-4 py-2.5 text-sm">
            <Download className="w-5 h-5" />
            <span>{t('Export', 'تصدير')}</span>
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="glass-card p-5 sm:p-6 space-y-4 animate-fade-in">
          <h3 className="ms-serif text-slate-900 font-semibold text-lg flex items-center gap-2">
            <Filter className="w-5 h-5 text-emerald-600" />
            {t('Filter Options', 'خيارات التصفية')}
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label-modern">{t('Date Range', 'النطاق الزمني')}</label>
              <div className="ms-segmented">
                {[
                  { value: '7days', label: t('Last 7 Days', 'آخر 7 أيام') },
                  { value: '30days', label: t('Last 30 Days', 'آخر 30 يوماً') },
                  { value: '90days', label: t('Last 90 Days', 'آخر 90 يوماً') },
                  { value: 'custom', label: t('Custom Range', 'نطاق مخصص') }
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDateRange(opt.value)}
                    className={`ms-segmented-btn ${dateRange === opt.value ? 'ms-segmented-active' : ''}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label-modern">{t('Medication', 'الدواء')}</label>
              <select 
                value={selectedMedicine}
                onChange={(e) => setSelectedMedicine(e.target.value)}
                className="select-modern"
              >
                <option value="all">{t('All Medications', 'كل الأدوية')}</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StatCard
          title={t('Overall Adherence', 'الالتزام العام')}
          value={`${adherenceRate}%`}
          subtitle={t(`${data.confirmed ?? data.taken} of ${data.resolved ?? totalDoses} resolved doses`, `${data.confirmed ?? data.taken} من ${data.resolved ?? totalDoses} جرعة محسومة`)}
          icon={Target}
          color="green"
          style={{ animationDelay: '60ms' }}
        />
        <StatCard
          title={t('Doses Taken', 'جرعات تم تناولها')}
          value={data.taken}
          subtitle={t('Successfully completed', 'أُكملت بنجاح')}
          icon={CheckCircle}
          color="cyan"
          style={{ animationDelay: '120ms' }}
        />
        <StatCard
          title={t('Missed Doses', 'جرعات فائتة')}
          value={data.missed}
          subtitle={t('Needs attention', 'تحتاج انتباهاً')}
          icon={XCircle}
          color="red"
          style={{ animationDelay: '180ms' }}
        />
        <StatCard
          title={t('Delayed Doses', 'جرعات متأخرة')}
          value={data.delayed}
          subtitle={t('Taken late', 'تم تناولها متأخرة')}
          icon={Clock}
          color="amber"
          style={{ animationDelay: '240ms' }}
        />
      </div>

      {/* Analytics 2.0 KPI row (plan Phase 4) — DoseEvent-based */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StatCard
          title={t('On-Time Rate', 'نسبة الالتزام بالوقت')}
          value={typeof data.onTimeRate === 'number' ? `${data.onTimeRate}%` : '—'}
          subtitle={t('Of confirmed doses, taken on schedule', 'من الجرعات المؤكدة، ما التُزم بوقتها')}
          icon={Zap}
          color="teal"
          style={{ animationDelay: '60ms' }}
        />
        <StatCard
          title={t('Average Delay', 'متوسط التأخير')}
          value={data.avgDelayMinutes !== null && data.avgDelayMinutes !== undefined ? t(`${data.avgDelayMinutes} min`, `${data.avgDelayMinutes} د`) : '—'}
          subtitle={t('Across late confirmations', 'عبر التأكيدات المتأخرة')}
          icon={Clock}
          color="amber"
          style={{ animationDelay: '120ms' }}
        />
        <StatCard
          title={t('Current Streak', 'سلسلة الالتزام الحالية')}
          value={t(`${data.currentStreakDays ?? 0} days`, `${data.currentStreakDays ?? 0} أيام`)}
          subtitle={t(`Longest: ${data.longestStreakDays ?? 0} days`, `الأطول: ${data.longestStreakDays ?? 0} أيام`)}
          icon={Award}
          color="green"
          style={{ animationDelay: '180ms' }}
        />
        <StatCard
          title={t('Reminder Response', 'زمن الاستجابة للتذكير')}
          value={data.reminderResponse?.medianMinutes !== null && data.reminderResponse?.medianMinutes !== undefined ? t(`${data.reminderResponse.medianMinutes} min`, `${data.reminderResponse.medianMinutes} د`) : '—'}
          subtitle={t(
            `Median, from reminder to confirmation (${data.reminderResponse?.samples ?? 0} samples)`,
            `الوسيط، من التذكير إلى التأكيد (${data.reminderResponse?.samples ?? 0} عيّنة)`
          )}
          icon={Activity}
          color="cyan"
          style={{ animationDelay: '240ms' }}
        />
      </div>

      {/* Charts Section */}
      <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
        
        {/* Status Distribution Pie Chart */}
        <div className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="ms-serif text-slate-900 font-semibold text-lg">{t('Overall Adherence', 'الالتزام العام')}</h3>
              <p className="ms-eyebrow mt-1">{t('Status distribution breakdown', 'تفصيل توزيع الحالات')}</p>
            </div>
            <PieChart className="w-6 h-6 text-teal-600" />
          </div>
          <div className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={300}>
              <RePieChart>
                <Pie
                  data={statusDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, value, percent }) => {
                    if (value === 0) return null;
                    return `${name}: ${value} (${(percent * 100).toFixed(0)}%)`;
                  }}
                >
                  {statusDistribution.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.value === 0 ? '#cbd5e1' : entry.color}
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  wrapperStyle={{ color: '#64748b', fontWeight: 600 }}
                />
              </RePieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weekly Trend Bar Chart */}
        <div className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '160ms' }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="ms-serif text-slate-900 font-semibold text-lg">{t('Weekly Medication Trend', 'الاتجاه الأسبوعي للأدوية')}</h3>
              <p className="ms-eyebrow mt-1">{t('Daily breakdown over time', 'التفصيل اليومي عبر الزمن')}</p>
            </div>
            <Activity className="w-6 h-6 text-cyan-600" />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ReBarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis 
                dataKey="date" 
                stroke="#94a3b8" 
                tick={{ fill: '#64748B', fontSize: 12 }}
              />
              <YAxis 
                stroke="#94a3b8" 
                tick={{ fill: '#64748B', fontSize: 12 }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: '#64748b', fontWeight: 600 }} />
              <Bar dataKey="taken" name={t('Taken', 'تم تناوله')} fill="#10b981" radius={[6, 6, 0, 0]} minPointSize={5} />
              <Bar dataKey="missed" name={t('Missed', 'فائت')} fill="#f43f5e" radius={[6, 6, 0, 0]} minPointSize={5} />
              <Bar dataKey="delayed" name={t('Delayed', 'متأخر')} fill="#f59e0b" radius={[6, 6, 0, 0]} minPointSize={5} />
              <Bar dataKey="pending" name={t('Pending', 'قيد الانتظار')} fill="#06b6d4" radius={[6, 6, 0, 0]} minPointSize={5} />
            </ReBarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By Hour + By Medication (Analytics 2.0) */}
      <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="ms-serif text-slate-900 font-semibold text-lg">{t('Adherence by Hour of Day', 'الالتزام حسب ساعة اليوم')}</h3>
              <p className="ms-eyebrow mt-1">{t('Confirmed vs missed, at your local clock', 'مؤكد مقابل فائت، حسب ساعتك المحلية')}</p>
            </div>
            <Clock className="w-6 h-6 text-amber-600" />
          </div>
          {hourData.length === 0 ? (
            <p className="text-slate-400 text-sm py-8 text-center">{t('No dose data in this window yet', 'لا توجد بيانات جرعات في هذه النافذة بعد')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ReBarChart data={hourData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="hour" stroke="#94a3b8" tick={{ fill: '#64748B', fontSize: 12 }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#64748B', fontSize: 12 }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ color: '#64748b', fontWeight: 600 }} />
                <Bar dataKey="confirmed" name={t('Confirmed', 'مؤكد')} fill="#10b981" radius={[6, 6, 0, 0]} minPointSize={5} />
                <Bar dataKey="missed" name={t('Missed', 'فائت')} fill="#f43f5e" radius={[6, 6, 0, 0]} minPointSize={5} />
              </ReBarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-card p-5 sm:p-6 animate-fade-up" style={{ animationDelay: '160ms' }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="ms-serif text-slate-900 font-semibold text-lg">{t('Adherence by Medication', 'الالتزام حسب الدواء')}</h3>
              <p className="ms-eyebrow mt-1">{t('Per-medication confirmation over the window', 'التأكيد لكل دواء خلال النافذة')}</p>
            </div>
            <Pill className="w-6 h-6 text-teal-600" />
          </div>
          {medRows.length === 0 ? (
            <p className="text-slate-400 text-sm py-8 text-center">{t('No medications yet', 'لا توجد أدوية بعد')}</p>
          ) : (
            <div className="max-h-72 overflow-y-auto ms-scrollbar space-y-3 pe-1">
              {medRows.map((m) => (
                <div key={m.id || m.name} className="surface-inset p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="font-semibold text-sm text-slate-900 truncate">{m.name}</p>
                    <span className={`text-sm font-bold shrink-0 ${m.adherenceRate >= 80 ? 'text-emerald-600' : m.adherenceRate >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                      {m.adherenceRate === null ? '—' : `${m.adherenceRate}%`}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
                    <div
                      className={`h-2 rounded-full transition-all ${m.adherenceRate >= 80 ? 'bg-emerald-500' : m.adherenceRate >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                      style={{ width: `${m.adherenceRate ?? 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    {t(`${m.confirmed} confirmed · ${m.missed} missed · ${fmtDelay(m.avgDelayMinutes)}`, `${m.confirmed} مؤكدة · ${m.missed} فائتة · ${m.avgDelayMinutes !== null && m.avgDelayMinutes !== undefined ? m.avgDelayMinutes + ' د تأخير' : '—'}`)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="glass-card p-6 animate-fade-up">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="ms-serif text-slate-900 font-semibold">{t('Taken', 'تم تناوله')}</h3>
          </div>
          <p className="text-3xl font-bold text-emerald-600 mb-2">{data.taken}</p>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div 
              className="bg-emerald-500 h-2 rounded-full transition-all"
              style={{ width: `${totalDoses > 0 ? (data.taken / totalDoses * 100) : 0}%` }}
            />
          </div>
        </div>

        <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-rose-50 border border-rose-100 rounded-xl flex items-center justify-center">
              <XCircle className="w-6 h-6 text-rose-600" />
            </div>
            <h3 className="ms-serif text-slate-900 font-semibold">{t('Missed', 'فائت')}</h3>
          </div>
          <p className="text-3xl font-bold text-rose-600 mb-2">{data.missed}</p>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div 
              className="bg-rose-500 h-2 rounded-full transition-all"
              style={{ width: `${totalDoses > 0 ? (data.missed / totalDoses * 100) : 0}%` }}
            />
          </div>
        </div>

        <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-amber-50 border border-amber-100 rounded-xl flex items-center justify-center">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="ms-serif text-slate-900 font-semibold">{t('Delayed', 'متأخر')}</h3>
          </div>
          <p className="text-3xl font-bold text-amber-600 mb-2">{data.delayed}</p>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div 
              className="bg-amber-500 h-2 rounded-full transition-all"
              style={{ width: `${totalDoses > 0 ? (data.delayed / totalDoses * 100) : 0}%` }}
            />
          </div>
        </div>

        <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '180ms' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-cyan-50 border border-cyan-100 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6 text-cyan-600" />
            </div>
            <h3 className="ms-serif text-slate-900 font-semibold">{t('Pending', 'قيد الانتظار')}</h3>
          </div>
          <p className="text-3xl font-bold text-cyan-600 mb-2">{data.pending}</p>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div 
              className="bg-cyan-500 h-2 rounded-full transition-all"
              style={{ width: `${totalDoses > 0 ? (data.pending / totalDoses * 100) : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Insights & Recommendations */}
      <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '120ms' }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-teal-50 border border-teal-100 rounded-xl flex items-center justify-center">
            <Activity className="w-6 h-6 text-teal-600" />
          </div>
          <div>
            <h3 className="ms-serif text-slate-900 font-semibold text-lg">{t('AI-Powered Insights', 'رؤى مدعومة بالذكاء الاصطناعي')}</h3>
            <p className="ms-eyebrow mt-1">{t('Personalized recommendations based on your patterns', 'توصيات مخصصة بناءً على أنماطك الخاصة')}</p>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {insights.map((insight, idx) => (
            <div 
              key={idx}
              className={`surface-inset p-5 border hover:-translate-y-0.5 transition-all ${
                insight.type === 'success' ? 'border-emerald-200 hover:border-emerald-300' :
                insight.type === 'warning' ? 'border-amber-200 hover:border-amber-300' :
                'border-cyan-200 hover:border-cyan-300'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                insight.type === 'success' ? 'bg-emerald-50 border border-emerald-100' :
                insight.type === 'warning' ? 'bg-amber-50 border border-amber-100' :
                'bg-cyan-50 border border-cyan-100'
              }`}>
                {React.createElement(insight.icon, { className: `w-5 h-5 ${
                  insight.type === 'success' ? 'text-emerald-600' :
                  insight.type === 'warning' ? 'text-amber-600' :
                  'text-cyan-600'
                }` })}
              </div>
              <h4 className="ms-serif text-slate-900 font-semibold mb-2">{insight.title}</h4>
              <p className="text-sm text-slate-600 mb-3 font-medium">{insight.description}</p>
              <button className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                insight.type === 'success' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' :
                insight.type === 'warning' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' :
                'bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
              }`}>
                {insight.action}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
