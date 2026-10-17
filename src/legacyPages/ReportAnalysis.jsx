import React, { useState } from "react";
import { FileUp, Loader, AlertCircle, Sparkles, Globe, Eye, EyeOff, Stethoscope } from "lucide-react";
import { useLanguage } from "../hooks/useTranslation";
import { ReadabilityIndicator } from "../components/ReadabilityIndicator";
import { TranslationBadge } from "../components/TranslationBadge";
import Button from "../components/Button";
import axios from "axios";

const ReportAnalysis = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [translatedAnalysis, setTranslatedAnalysis] = useState(null);
  const [readabilityScore, setReadabilityScore] = useState(null);
  const [error, setError] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [reportId, setReportId] = useState(null);
  const { t, supportedLanguages } = useLanguage();

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleGenerateAnalysis = async () => {
    if (!file) {
      setError(t("Please select a file to upload.", "يرجى اختيار ملف للرفع."));
      return;
    }

    setLoading(true);
    setAnalysis(null);
    setTranslatedAnalysis(null);
    setReadabilityScore(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const user = JSON.parse(localStorage.getItem("user"));
      formData.append("user", JSON.stringify(user));

      const res = await fetch("/api/report/analyze", {
        method: "POST",
        // Phase 12 — authenticated upload (ownership is taken from the token,
        // the appended `user` field is overridden server-side).
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
        },
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setAnalysis(data.analysis);
        setReadabilityScore(data.readabilityScore);
        setReportId(data.reportId);

        // Auto-translate if language != en
        if (selectedLanguage !== "en" && data.analysis) {
          await translateAnalysis(data.analysis, selectedLanguage, data.reportId);
        }
      } else {
        setError(data.error || t("Failed to analyze report", "فشل تحليل التقرير"));
      }
    } catch (err) {
      console.error(err);
      setError(t("Server error while analyzing report", "خطأ في الخادم أثناء تحليل التقرير"));
    } finally {
      setLoading(false);
    }
  };

  const translateAnalysis = async (text, targetLang, id) => {
    if (!text || targetLang === "en") {
      return;
    }

    setTranslating(true);
    try {
      const response = await axios.get(
        `/api/report/${id}/translate/${targetLang}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );
      setTranslatedAnalysis(response.data.translatedAnalysis);
      setShowTranslated(true);
    } catch (err) {
      console.error("Translation failed:", err.message);
      setError(t("Failed to translate analysis", "فشل ترجمة التحليل"));
    } finally {
      setTranslating(false);
    }
  };

  const handleLanguageChange = async (newLang) => {
    setSelectedLanguage(newLang);
    if (analysis && reportId && newLang !== "en") {
      await translateAnalysis(analysis, newLang, reportId);
    } else {
      setTranslatedAnalysis(null);
      setShowTranslated(false);
    }
  };

  return (
    <div className="min-h-screen py-10 px-4 sm:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Page heading — serif title on the dark canvas */}
        <div className="text-center mb-8 animate-fade-up">
          <div className="ms-feature-icon mx-auto mb-4">
            <Stethoscope className="w-5 h-5" />
          </div>
          <h2 className="section-title">{t("Analyze Medical Report", "تحليل تقرير طبي")}</h2>
          <p className="text-slate-400 text-sm mt-2">
            {t(
              "Upload a lab report and get an easy-to-read AI summary",
              "ارفع تقرير تحليل مخبري واحصل على ملخص سهل القراءة بالذكاء الاصطناعي"
            )}
          </p>
        </div>

        {/* Upload card */}
        <div className="glass-card p-6 sm:p-8 animate-fade-up" style={{ animationDelay: "80ms" }}>
          {/* Upload dropzone — dashed border + emerald upload icon */}
          <div className="flex flex-col items-center justify-center p-6 sm:p-8 border-2 border-dashed border-slate-300 rounded-2xl hover:border-emerald-500/60 hover:bg-emerald-50/40 mb-6 transition-all duration-300">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4">
              <FileUp className="w-7 h-7 text-emerald-600" />
            </div>
            <p className="text-sm font-medium text-slate-700 mb-3">
              {t("Upload your report (PDF/TXT)", "ارفع تقريرك (PDF/TXT)")}
            </p>
            <input
              type="file"
              onChange={handleFileChange}
              className="block w-full text-sm text-slate-500 file:me-4 file:py-2.5 file:px-5 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 file:cursor-pointer file:transition-colors"
            />
            <p className="mt-3 text-xs text-slate-400">{t("PDF lab reports supported", "تُدعم تقارير التحاليل بصيغة PDF")}</p>
            {file && <p className="mt-3 text-sm text-emerald-700 font-medium truncate max-w-full">{t("Selected:", "تم التحديد:")} {file.name}</p>}
          </div>

          {/* Language selector */}
          <div className="mb-6 flex items-center gap-2.5">
            <Globe size={18} className="text-emerald-500 flex-shrink-0" />
            <select
              value={selectedLanguage}
              onChange={(e) => handleLanguageChange(e.target.value)}
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
            onClick={handleGenerateAnalysis}
            variant="primary"
            className="w-full"
            isLoading={loading}
            disabled={loading}
          >
            {loading ? t("Analyzing...", "جارٍ التحليل…") : t("Analyze Report", "تحليل التقرير")}
          </Button>

          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 animate-fade-up">
              <AlertCircle className="text-red-600 w-5 h-5 flex-shrink-0" />
              <p className="text-red-700 font-medium text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Analysis results — their own white card */}
        {analysis && (
          <div className="glass-card p-6 sm:p-8 mt-6 space-y-4 animate-fade-up">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="ms-serif text-lg sm:text-xl font-bold text-emerald-600 flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                <span>{t("Analysis Results", "نتائج التحليل")}</span>
              </h3>

              {/* Readability badge */}
              {readabilityScore && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">{t("Readability:", "قابلية القراءة:")}</span>
                  <ReadabilityIndicator
                    score={readabilityScore.fleschKincaid}
                    readingLevel={readabilityScore.readingLevel}
                    showDetails={true}
                  />
                </div>
              )}
            </div>

            {/* Translation badge and toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {translatedAnalysis && (
                <TranslationBadge
                  originalLanguage="en"
                  currentLanguage={selectedLanguage}
                  onShowOriginal={() => setShowTranslated(!showTranslated)}
                />
              )}

              {translatedAnalysis && (
                <button
                  onClick={() => setShowTranslated(!showTranslated)}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                >
                  {showTranslated ? (
                    <>
                      <Eye size={14} />
                      {t("View Original", "عرض النص الأصلي")}
                    </>
                  ) : (
                    <>
                      <EyeOff size={14} />
                      {t("View Translation", "عرض الترجمة")}
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Translation loading state */}
            {translating && (
              <div className="flex items-center gap-2 text-cyan-600">
                <Loader className="animate-spin" size={16} />
                <span className="text-sm">{t("Translating...", "جارٍ الترجمة…")}</span>
              </div>
            )}

            {/* Analysis text */}
            <div className="text-slate-700 whitespace-pre-wrap leading-relaxed text-sm sm:text-base border-t border-slate-200/70 pt-4">
              {showTranslated && translatedAnalysis ? translatedAnalysis : analysis}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportAnalysis;
