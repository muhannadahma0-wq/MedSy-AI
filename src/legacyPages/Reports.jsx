import React, { useState, useEffect } from "react";
import { useLanguage } from "../hooks/useTranslation";
import {
  Globe,
  FileText,
  Download,
  AlertCircle,
  Stethoscope,
  MessageSquareText,
  ChevronRight,
} from "lucide-react";
import Button from "../components/Button";

const Reports = () => {
  const [period, setPeriod] = useState(30); // default 30 days
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [error, setError] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const { t, language, supportedLanguages } = useLanguage();

  useEffect(() => {
    setSelectedLanguage(language);
  }, [language]);

  const handleGenerateReport = async () => {
    setLoading(true);
    setDownloadUrl(null);
    setError(null);

    try {
      const token = localStorage.getItem("token");
      const user = JSON.parse(localStorage.getItem("user"));
      const userId = user?.id || user?._id;
      const res = await fetch("/api/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          periodInDays: period,
          userId,
          language: selectedLanguage
        }),
      });

      const data = await res.json();

      if (data.success) {
        setDownloadUrl(data.downloadUrl);
      } else {
        setError(data.message || t("Failed to generate report", "تعذّر إنشاء التقرير"));
      }
    } catch (err) {
      console.error(err);
      setError(t("Server error while generating report", "حدث خطأ في الخادم أثناء إنشاء التقرير"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-6xl">
        {/* Hub heading — serif title on the dark canvas */}
        <div className="mb-8 text-center animate-fade-up">
          <h1 className="section-title">{t("Reports", "التقارير")}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
            {t(
              "Generate, analyze, and discuss your medical reports in one place",
              "أنشئ تقاريرك الطبية وحلّلها وناقشها من مكان واحد"
            )}
          </p>
        </div>

        {/* Report actions — white glass-cards on the canvas */}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {/* Generate medication report — the live form */}
          <div
            className="glass-card glass-card-hover animate-fade-up p-6 md:col-span-2 xl:col-span-1"
            style={{ animationDelay: "80ms" }}
          >
            <div className="mb-5 flex items-start gap-3">
              <div className="ms-feature-icon shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="ms-serif text-lg font-semibold text-slate-900">
                  {t("Generate Medication Report", "إنشاء تقرير الدواء")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t(
                    "Turn your adherence history into a shareable PDF summary",
                    "حوّل سجل التزامك بالدواء إلى ملخص PDF قابل للمشاركة"
                  )}
                </p>
              </div>
            </div>

            <label className="label-modern" htmlFor="report-period">
              {t("Select period (days):", "اختر المدة (بالأيام):")}
            </label>
            <input
              id="report-period"
              type="number"
              min={1}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="input-modern mb-5"
            />

            <label className="label-modern" htmlFor="report-language">
              {t("Report language:", "لغة التقرير:")}
            </label>
            <div className="mb-6 flex items-center gap-2.5">
              <Globe size={18} className="text-emerald-500 flex-shrink-0" />
              <select
                id="report-language"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="select-modern"
              >
                {supportedLanguages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.nativeName} ({lang.name})
                  </option>
                ))}
              </select>
            </div>

            <Button
              onClick={handleGenerateReport}
              variant="primary"
              className="w-full"
              isLoading={loading}
              disabled={loading}
            >
              {loading ? t("Generating...", "جارٍ الإنشاء…") : t("Generate Report", "إنشاء التقرير")}
            </Button>

            {downloadUrl && (
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-emerald-50 border border-emerald-200 hover:border-emerald-300 px-4 py-3 text-sm font-semibold text-emerald-700 shadow-sm transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] animate-fade-up"
              >
                <Download className="w-4 h-4" />
                {t("Download PDF", "تنزيل PDF")}
              </a>
            )}

            {error && (
              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 animate-fade-up">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <p className="text-red-700 font-medium text-sm">{error}</p>
              </div>
            )}
          </div>

          {/* Analyze a report */}
          <button
            onClick={() => { window.location.href = "#/report-analysis"; }}
            className="glass-card glass-card-hover flex cursor-pointer flex-col p-6 text-start animate-fade-up"
            style={{ animationDelay: "160ms" }}
          >
            <div className="ms-feature-icon mb-4">
              <Stethoscope className="h-5 w-5" />
            </div>
            <h2 className="ms-serif text-lg font-semibold text-slate-900">
              {t("Analyze Medical Report", "تحليل تقرير طبي")}
            </h2>
            <p className="mt-1.5 flex-1 text-sm text-slate-500">
              {t(
                "Upload a lab report and get an easy-to-read AI summary",
                "ارفع تقرير تحليل مخبري واحصل على ملخص سهل القراءة بالذكاء الاصطناعي"
              )}
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              {t("Open", "فتح")}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </span>
          </button>

          {/* Chat with a report */}
          <button
            onClick={() => { window.location.href = "#/reportChat"; }}
            className="glass-card glass-card-hover flex cursor-pointer flex-col p-6 text-start animate-fade-up"
            style={{ animationDelay: "240ms" }}
          >
            <div className="ms-feature-icon mb-4">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <h2 className="ms-serif text-lg font-semibold text-slate-900">
              {t("Report Chat", "الدردشة مع التقرير")}
            </h2>
            <p className="mt-1.5 flex-1 text-sm text-slate-500">
              {t(
                "Ask questions about your medical reports",
                "اطرح أسئلة عن تقاريرك الطبية"
              )}
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              {t("Open", "فتح")}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Reports;
