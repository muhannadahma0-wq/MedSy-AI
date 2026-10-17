import { useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleLogin } from '@react-oauth/google';
import { Pill, User, Mail, Lock, Check } from 'lucide-react';
import Button from '../components/Button';
import OTPInput from "../components/OTPInput";
import { useLanguage } from '../hooks/useTranslation';

export default function Signup() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [step, setStep] = useState(1); // 1: Info, 2: OTP
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const navigate = useNavigate();
  const { t, isRTL } = useLanguage();

  const [backupCodes, setBackupCodes] = useState([]);
  // Sandbox demo mode: no SMTP service is available, so the backend returns
  // the OTP in the response and we surface it here instead of a real email.
  const [demoOtp, setDemoOtp] = useState(null);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Phase 3 — capture the browser timezone at signup.
        body: JSON.stringify({
          ...form,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json();
      if (res.ok && data.requiresVerification) {
        setDemoOtp(data.demoOtp || null);
        setStep(2);
      } else {
        setError(data.message || t("Signup failed", "فشل إنشاء الحساب"));
      }
    } catch (err) {
      setError(t("An error occurred during signup", "حدث خطأ أثناء إنشاء الحساب"));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          otp,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        window.dispatchEvent(new Event("medsync-auth-changed"));
        if (data.backupCodes) {
          setBackupCodes(data.backupCodes);
          setStep(3); // Show backup codes
        } else {
          navigate("/dashboard");
        }
      } else {
        setError(data.message || t("Verification failed", "فشل التحقق"));
      }
    } catch (err) {
      setError(t("An error occurred during verification", "حدث خطأ أثناء التحقق"));
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (resendTimer > 0) return;
    setError("");
    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      const data = await res.json();
      if (res.ok) {
        setResendTimer(60);
        const timer = setInterval(() => {
          setResendTimer((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setError(data.message || t("Failed to resend OTP", "فشلت إعادة إرسال الرمز"));
      }
    } catch (err) {
      setError(t("An error occurred", "حدث خطأ"));
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: credentialResponse.credential })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        navigate("/dashboard");
      } else {
        setError(data.message || t("Google Login failed", "فشل تسجيل الدخول عبر Google"));
      }
    } catch (err) {
      setError(t("An error occurred during Google Login", "حدث خطأ أثناء تسجيل الدخول عبر Google"));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-card w-full max-w-lg p-8 animate-fade-up">
        {/* Card header — emerald brand tile + serif heading */}
        <div className="flex flex-col items-center text-center">
          <a
            href="#/landing"
            className="mb-4 w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-[0_6px_16px_-4px_rgba(5,150,105,0.45)] transition-transform duration-200 hover:scale-105"
            aria-label={t("INSIGHT-X home", "الصفحة الرئيسية لـ INSIGHT-X")}
          >
            <Pill className="w-6 h-6 text-white" />
          </a>
          <h2 className={`ms-serif text-2xl font-semibold ltr:tracking-tight ${step === 3 ? 'text-emerald-600' : 'text-slate-900'}`}>
            {step === 1 ? t("Join MedSync AI", "انضم إلى MedSync AI") : step === 2 ? t("Verify Email", "تأكيد بريدك الإلكتروني") : t("Account Verified!", "تم توثيق الحساب!")}
          </h2>
        </div>

        {/* Step indicator (presentation-only, reads existing `step` state) */}
        <div className="mt-6 mb-8 flex items-center justify-center" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <Fragment key={n}>
              {n > 1 && (
                <span className={`h-px w-10 ${step >= n ? 'bg-emerald-600' : 'bg-slate-200'}`} />
              )}
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-all duration-200 ${
                  step > n
                    ? 'bg-emerald-600 text-white'
                    : step === n
                      ? 'border-2 border-emerald-600 bg-white text-emerald-600'
                      : 'bg-slate-200 text-slate-500'
                }`}
              >
                {step > n ? <Check className="h-4 w-4" /> : n}
              </span>
            </Fragment>
          ))}
        </div>

        {step === 1 ? (
          <form onSubmit={handleSignupSubmit}>
            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label htmlFor="signup-name" className="label-modern">{t("Full Name", "الاسم الكامل")}</label>
                <div className="relative">
                  <User className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
                  <input
                    id="signup-name"
                    name="name"
                    placeholder={t("John Doe", "محمد أحمد")}
                    className="input-modern ps-11"
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="signup-email" className="label-modern">{t("Email Address", "البريد الإلكتروني")}</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
                  <input
                    id="signup-email"
                    name="email"
                    type="email"
                    placeholder="john@example.com"
                    className="input-modern ps-11"
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="signup-password" className="label-modern">{t("Password", "كلمة المرور")}</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
                  <input
                    id="signup-password"
                    name="password"
                    type="password"
                    placeholder="••••••••"
                    className="input-modern ps-11"
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              isLoading={loading}
              className="mt-6 w-full"
            >
              {loading ? t("Creating Account...", "جارٍ إنشاء الحساب...") : t("Sign Up", "إنشاء حساب")}
            </Button>

            <div className="mt-6 flex flex-col items-center">
              <div className="w-full flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200"></div>
                <span className="text-xs font-medium uppercase ltr:tracking-wider text-slate-400">{t("OR", "أو")}</span>
                <div className="h-px flex-1 bg-slate-200"></div>
              </div>

              <div className="mt-5 w-full flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError(t("Google Signup Failed", "فشل التسجيل عبر Google"))}
                  theme="outline"
                  shape="pill"
                  text="signup_with"
                  width="100%"
                />
              </div>
            </div>

            <p className="mt-6 text-center text-sm text-slate-600">
              {t("Already have an account?", "لديك حساب بالفعل؟")} <a href="#/login" className="font-medium text-emerald-600 hover:text-emerald-500 transition-colors hover:underline">{t("Login", "تسجيل الدخول")}</a>
            </p>
          </form>
        ) : step === 2 ? (
          <div>
            <p className="text-slate-600 text-center mb-8 -mt-2">{t("We've sent a code to ", "أرسلنا رمزاً إلى ")}<span className="text-slate-900 font-medium" dir="ltr">{form.email}</span></p>

            {error && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {demoOtp && (
              <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 mb-6 text-sm text-center text-cyan-800">
                <span className="font-semibold">{t("Demo mode:", "الوضع التجريبي:")}</span>{" "}
                {t("email delivery is not configured in this environment. Your verification code is ", "إرسال البريد الإلكتروني غير مُهيَّأ في هذه البيئة. رمز التحقق الخاص بك هو ")}{" "}
                <span className="font-mono font-bold text-lg tracking-widest" dir="ltr">{demoOtp}</span>
              </div>
            )}

            <OTPInput onComplete={(code) => setOtp(code)} />

            <Button
              onClick={handleVerifyOTP}
              variant="primary"
              isLoading={loading}
              disabled={loading || otp.length < 6}
              className="w-full"
            >
              {loading ? t("Verifying...", "جارٍ التحقق...") : t("Verify OTP", "تأكيد الرمز")}
            </Button>

            <div className="mt-8 text-center">
              <p className="text-sm text-slate-600">{t("Didn't receive the code?", "لم يصلك الرمز؟")}</p>
              <button
                onClick={handleResendOTP}
                disabled={resendTimer > 0}
                className={`mt-2 py-1.5 font-medium transition-colors ${resendTimer > 0 ? 'text-slate-400 cursor-not-allowed' : 'text-emerald-600 hover:text-emerald-500 hover:underline'}`}
              >
                {resendTimer > 0 ? `${t("Resend code in", "إعادة إرسال الرمز خلال")} ${resendTimer}s` : t("Resend OTP", "إعادة إرسال الرمز")}
              </button>
            </div>

            <button
              onClick={() => setStep(1)}
              className="mt-6 w-full py-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
            >
              {/* Directional text arrow — points inline-start (right) in RTL */}
              {isRTL ? '→' : '←'} {t("Back to Sign Up", "الرجوع إلى إنشاء الحساب")}
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-full">
                <svg className="w-12 h-12 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
            </div>
            <p className="text-slate-600 mb-6">{t("Your backup codes are listed below. Please save them in a safe place.", "رموز النسخ الاحتياطي الخاصة بك مدرجة أدناه. يرجى حفظها في مكان آمن.")}</p>

            <div className="surface-inset p-4 grid grid-cols-1 gap-2 mb-8" dir="ltr">
              {backupCodes.map((code, i) => (
                <code key={i} className="text-lg font-mono text-emerald-700">{code}</code>
              ))}
            </div>

            <Button
              onClick={() => navigate("/dashboard")}
              variant="primary"
              className="w-full"
            >
              {t("Go to Dashboard", "الانتقال إلى لوحة التحكم")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
