import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleLogin } from '@react-oauth/google';
import { Pill, Mail, Lock } from 'lucide-react';
import Button from '../components/Button';
import { useLanguage } from '../hooks/useTranslation';

export default function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Phase 3 — send the browser's detected timezone so dose slots are
        // scheduled at the user's local wall-clock time.
        body: JSON.stringify({
          ...form,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.requiresVerification) {
          setError(t("Account not verified. Please sign up again to receive a new code.", "الحساب غير مُوثَّق. يرجى إعادة إنشاء الحساب للحصول على رمز جديد."));
          // Optionally redirect to a dedicated verification page if we had one
        } else {
          setError(data.message || t("Login failed", "فشل تسجيل الدخول"));
        }
        return;
      }

      if (data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        window.dispatchEvent(new Event("medsync-auth-changed"));
        navigate("/dashboard");
      }
    } catch (err) {
      setError(t("An error occurred during login", "حدث خطأ أثناء تسجيل الدخول"));
    } finally {
      setLoading(false);
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
      <div className="glass-card w-full max-w-md p-8 animate-fade-up">
        {/* Card header — emerald brand tile + serif heading */}
        <div className="flex flex-col items-center mb-8 text-center">
          <a
            href="#/landing"
            className="mb-4 w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-[0_6px_16px_-4px_rgba(5,150,105,0.45)] transition-transform duration-200 hover:scale-105"
            aria-label={t("INSIGHT-X home", "الصفحة الرئيسية لـ INSIGHT-X")}
          >
            <Pill className="w-6 h-6 text-white" />
          </a>
          <h2 className="ms-serif text-2xl font-semibold ltr:tracking-tight text-slate-900">{t("Welcome Back", "أهلاً بعودتك")}</h2>
          <p className="mt-2 text-sm text-slate-500">{t("Log in to stay on track with your health", "سجّل الدخول لتبقى على المسار الصحيح")}</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="login-email" className="label-modern">{t("Email Address", "البريد الإلكتروني")}</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
                <input
                  id="login-email"
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
              <label htmlFor="login-password" className="label-modern">{t("Password", "كلمة المرور")}</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
                <input
                  id="login-password"
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
            {loading ? t("Logging in...", "جارٍ تسجيل الدخول...") : t("Login", "تسجيل الدخول")}
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
                onError={() => setError(t("Google Login Failed", "فشل تسجيل الدخول عبر Google"))}
                theme="outline"
                shape="pill"
                text="continue_with"
                width="100%"
              />
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-slate-600">
            {t("Don't have an account?", "ليس لديك حساب؟")} <a href="#/signup" className="font-medium text-emerald-600 hover:text-emerald-500 transition-colors hover:underline">{t("Sign Up", "إنشاء حساب")}</a>
          </p>

          {/* Demo helper for this sandbox build */}
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-center text-amber-800">
            {t("Demo account:", "حساب تجريبي:")} <span className="font-mono" dir="ltr">demo@medsync.ai</span> / <span className="font-mono" dir="ltr">demo1234</span>
          </div>
        </form>
      </div>
    </div>
  );
}
