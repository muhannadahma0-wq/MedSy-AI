import React, { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import Loader from '../components/Loader';
import { useLanguage } from '../hooks/useTranslation';

const OAuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    const linked = searchParams.get("linked");

    if (linked === "true") {
        alert(t("Google Calendar linked successfully!", "تم ربط تقويم Google بنجاح!"));
        setTimeout(() => navigate("/dashboard"), 1500);
      } else {
        navigate("/dashboard");
      }

    // Redirect to dashboard
    navigate("/dashboard");
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Dark canvas loading state — Loader's legacy "orange" maps to emerald */}
      <div className="animate-fade-up flex flex-col items-center text-center">
        <Loader size="xl" className="mb-6" />
        <p className="ms-serif text-lg font-medium text-slate-300">{t("Connecting your Google Calendar...", "جارٍ ربط تقويم Google...")}</p>
        <p className="mt-2 text-xs text-slate-500">{t("Redirecting you to your dashboard", "جارٍ تحويلك إلى لوحة التحكم")}</p>
      </div>
    </div>
  );
};

export default OAuthCallback;
