import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pill, Heart, HeartPulse, ShieldAlert, Bot, Clock, TrendingUp, Sparkles, ArrowRight, Shield, Zap, Bell, FileText } from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

/* ── Presentation-only data ("Rhythm" soft-dark redesign v4 — no logic changes).
     Bilingual build: EN string + `*Ar` twin, rendered through t(). ── */
const STATS = [
  { value: '50%', label: 'Adherence Rate', labelAr: 'معدل الالتزام', icon: HeartPulse, tint: 'emerald', accent: true },
  { value: '125K', label: 'Deaths/Year', labelAr: 'وفيات سنوياً', icon: ShieldAlert, tint: 'red' },
  { value: '24/7', label: 'AI Support', labelAr: 'دعم بالذكاء الاصطناعي', icon: Bot, tint: 'purple' },
];

const TINTS = {
  emerald: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
  cyan: 'bg-cyan-50 text-cyan-600 border border-cyan-100',
  purple: 'bg-purple-50 text-purple-600 border border-purple-100',
  amber: 'bg-amber-50 text-amber-600 border border-amber-100',
  red: 'bg-red-50 text-red-600 border border-red-100',
};

const FEATURES = [
  { icon: Clock, tint: 'emerald', title: 'Smart Reminders', titleAr: 'تذكيرات ذكية', description: 'Personalized dose reminders with snooze, skip and real-time notifications that keep every day on schedule.', descriptionAr: 'تذكيرات مخصّصة بمواعيد الجرعات مع خيارات التأجيل والتخطي وإشعارات فورية تُبقي كل يوم على المسار الصحيح.' },
  { icon: Sparkles, tint: 'purple', title: 'AI Health Assistant', titleAr: 'مساعد صحي بالذكاء الاصطناعي', description: 'Four specialized agents answer questions, explain interactions and flag emergencies — grounded in your own data.', descriptionAr: 'أربعة وكلاء متخصصين يجيبون عن أسئلتك ويشرحون التداخلات الدوائية وينبّهونك إلى الحالات الطارئة — بالاستناد إلى بياناتك.' },
  { icon: TrendingUp, tint: 'cyan', title: 'Progress Insights', titleAr: 'رؤى عن التقدّم', description: 'Streaks, adherence heatmaps and weekly trends make your progress visible, measurable and motivating.', descriptionAr: 'سلاسل الالتزام وخرائط الحرارة والاتجاهات الأسبوعية تجعل تقدّمك مرئياً وقابلاً للقياس ومحفّزاً.' },
  { icon: Shield, tint: 'amber', title: 'Interaction Safety', titleAr: 'سلامة التداخلات الدوائية', description: 'A curated drug-interaction shield checks every new medication against your current list before it is saved.', descriptionAr: 'درع مدقّق للتداخلات الدوائية يفحص كل دواء جديد مقابل قائمتك الحالية قبل حفظه.' },
  { icon: FileText, tint: 'emerald', title: 'Health Reports', titleAr: 'تقارير صحية', description: 'Upload lab reports and get plain-language summaries, warnings and Q&A with cited sources.', descriptionAr: 'ارفع تقارير المختبر واحصل على ملخصات بلغة واضحة وتحذيرات وأسئلة وأجوبة موثّقة بالمصادر.' },
  { icon: Bell, tint: 'cyan', title: 'Real-Time Alerts', titleAr: 'تنبيهات فورية', description: 'Live notifications and emergency guidance reach you the moment they matter — no refresh needed.', descriptionAr: 'إشعارات مباشرة وتوجيهات للطوارئ تصلك لحظة الحاجة إليها — دون الحاجة إلى تحديث الصفحة.' },
];

export default function LandingPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // Helper: extracts token from various possible response shapes
  const extractToken = (data) => {
    return data.token || data.accessToken || data.jwt || data.data?.token || null;
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password })
      });

      const data = await res.json();

      // FIX 1: was `res.error` (always undefined) — now correctly uses `!res.ok`
      if (!res.ok) {
        alert(t("Login failed: ", "فشل تسجيل الدخول: ") + (data.message || t("Invalid credentials", "بيانات الدخول غير صحيحة")));
        return;
      }

      // FIX 2: safely extract token regardless of response shape
      const token = extractToken(data);
      if (!token) {
        console.error("No token found in response. Keys received:", Object.keys(data));
        alert(t("Login failed: Server did not return a token.", "فشل تسجيل الدخول: لم يُعد الخادم أي رمز."));
        return;
      }

      // FIX 3: store raw token (no "Bearer " prefix) — prefix is added at request time
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(data.user ?? {}));
      window.dispatchEvent(new Event("medsync-auth-changed"));

      // Phase 3 — sync the browser timezone to the freshly-authenticated
      // account (fire-and-forget; the server rebuilds upcoming doses).
      fetch("/api/preferences/timezone", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      }).catch(() => {});

      console.log("Login successful:", data.user);
      navigate("/dashboard");
    } catch (error) {
      alert(t("Login failed: ", "فشل تسجيل الدخول: ") + error.message);
    }
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(t("Signup failed: ", "فشل إنشاء الحساب: ") + (data.message || t("Please try again", "يرجى المحاولة مرة أخرى")));
        return;
      }

      // Sandbox port fix: the real backend requires email verification (OTP),
      // which is handled on the /signup page — continue the flow there.
      if (data.requiresVerification) {
        alert(t("Account created! Redirecting to email verification…", "تم إنشاء الحساب! جارٍ التحويل إلى تأكيد البريد الإلكتروني…"));
        navigate("/signup");
        return;
      }

      // FIX 2 (same): safely extract token
      const token = extractToken(data);
      if (!token) {
        console.error("No token found in signup response. Keys received:", Object.keys(data));
        alert(t("Signup failed: Server did not return a token.", "فشل إنشاء الحساب: لم يُعد الخادم أي رمز."));
        return;
      }

      // FIX 3 (same): store raw token only
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(data.user ?? {}));

      // Phase 3 — sync the browser timezone (fire-and-forget).
      fetch("/api/preferences/timezone", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      }).catch(() => {});


      console.log("Signup successful:", data.user);
      alert(t("Account created successfully! Please complete your health profile.", "تم إنشاء الحساب بنجاح! يرجى استكمال ملفك الصحي."));
      navigate("/health");
    } catch (error) {
      alert(t("Signup failed: ", "فشل إنشاء الحساب: ") + error.message);
    }
  };

  // Presentation-only helper: smooth-scroll to a page section.
  // (Replaces the original `#features` href anchors, which collided with the HashRouter.)
  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Frosted sticky nav (slim dark bar over the canvas) ────────── */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-slate-950/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <a href="#/landing" className="flex items-center gap-2.5">
            <span className="w-9 h-9 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-[0_6px_16px_-4px_rgba(5,150,105,0.55)]">
              <Pill className="w-5 h-5 text-white" />
            </span>
            {/* Brand wordmark hidden below sm so the nav (with the language switcher) never overflows small screens */}
            <span className="ms-serif hidden sm:block text-lg font-semibold ltr:tracking-tight text-white">
              MedSync <span className="text-emerald-400">AI</span>
            </span>
          </a>

          <div className="hidden md:flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollToSection('features')}
              className="ms-nav-link rounded-lg px-3 py-2 hover:bg-white/5"
            >
              {t('Features', 'المزايا')}
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('about')}
              className="ms-nav-link rounded-lg px-3 py-2 hover:bg-white/5"
            >
              {t('About', 'عن التطبيق')}
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('contact')}
              className="ms-nav-link rounded-lg px-3 py-2 hover:bg-white/5"
            >
              {t('Contact', 'تواصل معنا')}
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Hidden below sm so the CTA cluster (with the language switcher) never overflows small screens */}
            <a href="#/login" className="btn-ghost-dark hidden sm:inline-flex px-4 sm:px-5 py-2.5 text-sm">
              {t('Log In', 'تسجيل الدخول')}
            </a>
            <a href="#/signup" className="btn-primary-modern px-4 sm:px-5 py-2.5 text-sm">
              {t('Sign Up', 'إنشاء حساب')}
            </a>
            {/* Global EN/AR switcher. In RTL the dropdown is anchored to the inline-start edge so it never overflows the viewport. */}
            <LanguageSwitcher className="rtl:[&>div]:left-0 rtl:[&>div]:right-auto" />
          </div>
        </nav>
      </header>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 w-full">
        {/* Hero — full-height centered statement on the dark canvas */}
        <section className="relative flex min-h-[92vh] w-full items-center justify-center overflow-hidden px-4 sm:px-6">
          {/* Decorative blurred emerald circles — depth only */}
          <div aria-hidden="true" className="pointer-events-none absolute -top-40 -end-32 h-[26rem] w-[26rem] rounded-full bg-emerald-500/10 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute top-1/3 -start-44 h-[30rem] w-[30rem] rounded-full bg-teal-500/10 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 end-1/4 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl" />

          <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
            {/* Eyebrow label */}
            <div className="animate-fade-up inline-flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
              <p className="ms-eyebrow-canvas text-emerald-300/80">Webster 2025</p>
              <Sparkles className="w-3.5 h-3.5 text-emerald-300/70" />
            </div>

            <h1
              className="ms-serif animate-fade-up mt-5 text-5xl sm:text-6xl lg:text-7xl font-semibold ltr:tracking-tight ltr:leading-[1.12] text-slate-50"
              style={{ animationDelay: '80ms' }}
            >
              {t('Your Health,', 'صحتك،')}
              <br />
              <span className="text-gradient">{t('Simplified', 'بكل بساطة')}</span>
            </h1>

            <p className="animate-fade-up mt-6 max-w-2xl text-lg text-slate-400 leading-relaxed" style={{ animationDelay: '160ms' }}>
              {t(
                'Never miss a dose again. INSIGHT-X combines intelligent medication tracking with AI-powered health assistance to keep you on track.',
                'لن تفوّت جرعة بعد اليوم. يجمع INSIGHT-X بين تتبّع الأدوية الذكي والمساعدة الصحية المدعومة بالذكاء الاصطناعي ليبقيك على المسار الصحيح.'
              )}
            </p>

            {/* CTA pair */}
            <div className="animate-fade-up mt-9 flex flex-wrap items-center justify-center gap-4" style={{ animationDelay: '240ms' }}>
              <button
                type="button"
                onClick={() => scrollToSection('get-started')}
                className="btn-primary-modern px-7 py-3 group"
              >
                <span>{t('Get Started', 'ابدأ الآن')}</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('features')}
                className="btn-ghost-dark px-7 py-3"
              >
                {t('Explore Features', 'استكشف المزايا')}
              </button>
            </div>

            {/* Feature pills (frosted dark chips) */}
            <div className="animate-fade-up mt-10 flex flex-wrap justify-center gap-3" style={{ animationDelay: '320ms' }}>
              <div className="chip-modern border border-white/10 bg-white/5 text-slate-300">
                <Clock className="w-4 h-4 text-emerald-400" />
                <span>{t('Smart Reminders', 'تذكيرات ذكية')}</span>
              </div>
              <div className="chip-modern border border-white/10 bg-white/5 text-slate-300">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                <span>{t('Track Progress', 'تابع تقدّمك')}</span>
              </div>
              <div className="chip-modern border border-white/10 bg-white/5 text-slate-300">
                <Zap className="w-4 h-4 text-purple-400" />
                <span>{t('AI Assistant', 'مساعد ذكي')}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Get started — auth card (white floating card on the canvas) */}
        <section id="get-started" className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-2 pb-16 sm:pt-4 lg:pb-24 scroll-mt-24">
          <div className="mx-auto w-full max-w-md animate-fade-up">
            <div className="glass-card overflow-hidden">
              {/* Segmented tabs (grid mirrors automatically in RTL) */}
              <div className="grid grid-cols-2 gap-1 p-1.5 bg-slate-100">
                <button
                  onClick={() => {
                    setIsLogin(true);
                    setForm({ name: "", email: "", password: "" });
                  }}
                  className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                    isLogin
                      ? 'bg-white shadow-sm text-slate-900'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                  }`}
                >
                  {t('Log In', 'تسجيل الدخول')}
                </button>
                <button
                  onClick={() => {
                    setIsLogin(false);
                    setForm({ name: "", email: "", password: "" });
                  }}
                  className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                    !isLogin
                      ? 'bg-white shadow-sm text-slate-900'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                  }`}
                >
                  {t('Sign Up', 'إنشاء حساب')}
                </button>
              </div>

              {/* Form */}
              <form onSubmit={isLogin ? handleLoginSubmit : handleSignupSubmit} className="p-6 sm:p-8 space-y-5">
                {!isLogin && (
                  <div>
                    <label htmlFor="landing-name" className="label-modern">{t('Full Name', 'الاسم الكامل')}</label>
                    <input
                      type="text"
                      id="landing-name"
                      name="name"
                      value={form.name}
                      onChange={handleChange}
                      placeholder={t('John Doe', 'محمد أحمد')}
                      required
                      className="input-modern"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="landing-email" className="label-modern">{t('Email', 'البريد الإلكتروني')}</label>
                  <input
                    type="email"
                    id="landing-email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="you@example.com"
                    required
                    className="input-modern"
                  />
                </div>

                <div>
                  <label htmlFor="landing-password" className="label-modern">{t('Password', 'كلمة المرور')}</label>
                  <input
                    type="password"
                    id="landing-password"
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    required
                    className="input-modern"
                  />
                </div>

                {isLogin && (
                  <div className="flex items-center justify-between text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 rounded accent-emerald-600" />
                      <span className="text-slate-600">{t('Remember me', 'تذكرني')}</span>
                    </label>
                    <a href="#" className="text-emerald-600 hover:text-emerald-500 font-medium transition-colors">
                      {t('Forgot password?', 'نسيت كلمة المرور؟')}
                    </a>
                  </div>
                )}

                <button
                  type="submit"
                  className="btn-primary-modern w-full py-3 group"
                >
                  <span>{isLogin ? t('Log In', 'تسجيل الدخول') : t('Create Account', 'إنشاء الحساب')}</span>
                  <ArrowRight className="w-5 h-5 rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
                </button>

                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-medium uppercase ltr:tracking-wider text-slate-400">{t('Or continue with', 'أو تابع باستخدام')}</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button type="button" className="btn-ghost-modern py-3">
                    <svg className="w-5 h-5 text-slate-500" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <span className="text-sm">Google</span>
                  </button>
                  <button type="button" className="btn-ghost-modern py-3">
                    <Heart className="w-5 h-5 text-rose-500" />
                    <span className="text-sm">{t('Health App', 'تطبيق الصحة')}</span>
                  </button>
                </div>

                {/* Demo helper for this sandbox build */}
                {isLogin && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-center text-amber-800">
                    {t('Demo account:', 'حساب تجريبي:')} <span className="font-mono" dir="ltr">demo@medsync.ai</span> / <span className="font-mono" dir="ltr">demo1234</span>
                  </div>
                )}
              </form>
            </div>

            {/* Trust Badges */}
            <div className="mt-6 flex items-center justify-center gap-6 text-slate-400 text-sm">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-500" />
                <span>{t('Secure', 'آمن')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-rose-400" />
                <span>{t('HIPAA Compliant', 'متوافق مع HIPAA')}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Stats row */}
        <section className="mx-auto max-w-7xl w-full px-4 sm:px-6 pb-16 lg:pb-24">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {STATS.map((stat, i) => {
              const StatIcon = stat.icon;
              return (
                <div
                  key={stat.label}
                  className="glass-card glass-card-hover animate-fade-up p-6 text-center"
                  style={{ animationDelay: `${80 * (i + 1)}ms` }}
                >
                  <span className={`mx-auto w-10 h-10 rounded-xl flex items-center justify-center ${TINTS[stat.tint]}`}>
                    <StatIcon className="w-5 h-5" />
                  </span>
                  <div className="text-gradient mt-3 text-3xl font-bold">{stat.value}</div>
                  <div className="mt-1.5 text-sm text-slate-500">{t(stat.label, stat.labelAr)}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Features grid */}
        <section id="features" className="mx-auto max-w-7xl w-full px-4 sm:px-6 pb-16 lg:pb-24 scroll-mt-24">
          <div className="mx-auto max-w-2xl text-center mb-10">
            <h2 className="section-title">
              {t('Everything you need to ', 'كل ما تحتاجه لتبقى ')}
              <span className="text-gradient">{t('stay on track', 'على المسار')}</span>
            </h2>
            <p className="mt-3 text-slate-400 leading-relaxed">
              {t(
                'From your first dose to your latest lab report, INSIGHT-X keeps the whole picture in one calm, private place.',
                'من جرعتك الأولى إلى أحدث تقرير مخبري، يحتفظ INSIGHT-X بالصورة الكاملة في مكان واحد هادئ وخاص.'
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="glass-card glass-card-hover animate-fade-up p-6"
                  style={{ animationDelay: `${60 * (i + 1)}ms` }}
                >
                  <span className="ms-feature-icon text-emerald-600">
                    <Icon className="w-5 h-5" />
                  </span>
                  <h3 className="ms-serif mt-4 text-lg font-semibold text-slate-900">{t(feature.title, feature.titleAr)}</h3>
                  <p className="mt-2 text-sm text-slate-500 leading-relaxed">{t(feature.description, feature.descriptionAr)}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* About — on-canvas typography + white mini cards */}
        <section id="about" className="mx-auto max-w-7xl w-full px-4 sm:px-6 pb-16 lg:pb-24 scroll-mt-24">
          <div className="animate-fade-up grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <h2 className="section-title">
                {t('About ', 'عن ')}
                <span className="text-gradient">INSIGHT-X</span>
              </h2>
              <p className="mt-4 text-slate-400 leading-relaxed">
                {t(
                  'Built for people who juggle daily medications, INSIGHT-X brings reminders, adherence analytics, AI agents and report understanding together in a single dashboard — so your health routine stops living on sticky notes and starts working for you.',
                  'صُمم INSIGHT-X لمن يدير أدوية يومية متعددة، فيجمع التذكيرات وتحليلات الالتزام ووكلاء الذكاء الاصطناعي وفهم التقارير في لوحة تحكم واحدة — ليتوقف روتينك الصحي عن العيش على الملاحظات اللاصقة ويبدأ في العمل من أجلك.'
                )}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  {t('Secure', 'آمن')}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                  <Heart className="w-4 h-4 text-rose-400" />
                  {t('HIPAA Compliant', 'متوافق مع HIPAA')}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-card glass-card-hover p-5 text-center">
                <Clock className="w-5 h-5 text-emerald-600 mx-auto" />
                <div className="mt-2 font-semibold text-slate-900">{t('Daily doses', 'جرعات يومية')}</div>
                <div className="mt-1 text-sm text-slate-500">{t('tracked & timed for you', 'تُتابَع وتُوقَّت لأجلك')}</div>
              </div>
              <div className="glass-card glass-card-hover p-5 text-center">
                <Zap className="w-5 h-5 text-purple-600 mx-auto" />
                <div className="mt-2 font-semibold text-slate-900">{t('4 AI agents', '4 وكلاء ذكاء اصطناعي')}</div>
                <div className="mt-1 text-sm text-slate-500">{t('medical, medicine & more', 'طبي ودوائي والمزيد')}</div>
              </div>
              <div className="glass-card glass-card-hover p-5 text-center">
                <TrendingUp className="w-5 h-5 text-cyan-600 mx-auto" />
                <div className="mt-2 font-semibold text-slate-900">{t('Live streaks', 'سلاسل التزام حية')}</div>
                <div className="mt-1 text-sm text-slate-500">{t('motivation you can see', 'تحفيز تراه بعينك')}</div>
              </div>
              <div className="glass-card glass-card-hover p-5 text-center">
                <FileText className="w-5 h-5 text-emerald-600 mx-auto" />
                <div className="mt-2 font-semibold text-slate-900">{t('Smart reports', 'تقارير ذكية')}</div>
                <div className="mt-1 text-sm text-slate-500">{t('explained with citations', 'مع شروحات موثّقة بالمصادر')}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA — mint hero banner */}
        <section className="mx-auto max-w-7xl w-full px-4 sm:px-6 pb-20 lg:pb-28">
          <div className="ms-hero animate-fade-up px-6 py-12 sm:px-12 sm:py-16 text-center">
            <h2 className="ms-serif text-3xl sm:text-4xl font-semibold ltr:tracking-tight text-slate-900">
              {t('Ready to take control of ', 'هل أنت مستعد لتتولّى ')}
              <span className="text-gradient">{t('your health?', 'السيطرة على صحتك؟')}</span>
            </h2>
            <p className="mt-3 text-slate-600 max-w-xl mx-auto">
              {t(
                'Set up your first medication in minutes — and let INSIGHT-X handle the rest.',
                'أضف دواءك الأول خلال دقائق — ودع INSIGHT-X يتولّى الباقي.'
              )}
            </p>
            <button
              type="button"
              onClick={() => scrollToSection('get-started')}
              className="btn-primary-modern px-8 py-3.5 mt-8 group"
            >
              <span>{t('Get Started Free', 'ابدأ الآن مجاناً')}</span>
              <ArrowRight className="w-4 h-4 rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
            </button>
          </div>
        </section>
      </main>

      {/* ── Footer — dark frosted, natural page bottom ──────────────── */}
      <footer id="contact" className="mt-auto scroll-mt-24 border-t border-white/5 bg-slate-950/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <a href="#/landing" className="flex items-center gap-2">
            <span className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center">
              <Pill className="w-4 h-4 text-white" />
            </span>
            <span className="ms-serif font-semibold text-slate-100">MedSync <span className="text-emerald-400">AI</span></span>
          </a>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <button type="button" onClick={() => scrollToSection('features')} className="py-1.5 text-slate-500 hover:text-emerald-400 transition-colors">{t('Features', 'المزايا')}</button>
            <button type="button" onClick={() => scrollToSection('about')} className="py-1.5 text-slate-500 hover:text-emerald-400 transition-colors">{t('About', 'عن التطبيق')}</button>
            <a href="#/login" className="py-1.5 text-slate-500 hover:text-emerald-400 transition-colors">{t('Log In', 'تسجيل الدخول')}</a>
            <a href="#/signup" className="py-1.5 text-slate-500 hover:text-emerald-400 transition-colors">{t('Sign Up', 'إنشاء حساب')}</a>
          </div>

          <p className="text-xs text-slate-500">{t('© 2025 INSIGHT-X. All rights reserved.', '© 2025 INSIGHT-X. جميع الحقوق محفوظة.')}</p>
        </div>
      </footer>
    </div>
  );
}
