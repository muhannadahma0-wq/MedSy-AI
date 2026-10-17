import React from "react";
import { Calendar } from "lucide-react";
import { useLanguage } from "../hooks/useTranslation";

const ConnectCalendar = () => {
  const { t } = useLanguage();
  const handleConnect = () => {
    const user = JSON.parse(localStorage.getItem("user")); // get full user object
    const userId = user?.id || user?._id;
    // Redirect to backend OAuth login route
    console.log("userId: ",userId);
    if (!userId) {
      alert(t("User not found! Please log in again.", "المستخدم غير موجود! يرجى تسجيل الدخول مرة أخرى."));
      console.warn("User ID not found in localStorage!");
      return;
    }
    window.location.href = `/api/oauth/login?userId=${userId}`;
  };

  return (
    <button
      onClick={handleConnect}
      className="btn-ghost-modern px-5 py-3 text-sm"
    >
      <Calendar className="w-4 h-4 text-emerald-600" />
      {t("Connect Google Calendar", "ربط تقويم Google")}
    </button>
  );
};

export default ConnectCalendar;
