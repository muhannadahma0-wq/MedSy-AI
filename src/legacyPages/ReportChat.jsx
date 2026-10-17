import React, { useState, useEffect, useRef } from 'react';
import { Send, FileText, ChevronDown, User, Bot, Loader, Globe, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';
import Button from '../components/Button';
import axios from 'axios';

const ReportChat = () => {
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [localUser, setLocalUser] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [translatingMessage, setTranslatingMessage] = useState(null);
  const { t, language, supportedLanguages, translateText } = useLanguage();
  const chatEndRef = useRef(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user"));
    if (user) {
      setLocalUser(user);
      fetchReports(user);
    }
    setSelectedLanguage(language);
  }, [language]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchReports = async (user) => {
    try {
      // Phase 12 — authenticated call (the server lists the caller's reports).
      const response = await axios.post('/api/agents/reports', { user }, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      setReports(response.data.reports);
    } catch (error) {
      console.error('Error fetching reports:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !selectedReport || loading) return;

    let questionToSend = input;

    // Translate question if needed
    if (selectedLanguage !== 'en') {
      setTranslatingMessage(t('Translating question...', 'جارٍ ترجمة السؤال...'));
      try {
        questionToSend = await translateText(input, 'en', 'medical');
      } catch (err) {
        console.warn('Translation failed, using original:', err);
      } finally {
        setTranslatingMessage(null);
      }
    }

    const userMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
      language: selectedLanguage,
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post('/api/agents/chat', {
        question: questionToSend,
        reportId: selectedReport._id,
        language // UI language — backend answers in Arabic (MSA) when "ar"
      }, {
        // Phase 12 — authenticated call (Q&A restricted to the report owner).
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });

      let replyText = response.data.reply;

      // Translate reply to user's selected language if needed
      if (selectedLanguage !== 'en') {
        try {
          replyText = await translateText(replyText, selectedLanguage, 'medical');
        } catch (err) {
          console.warn('Reply translation failed, showing original:', err);
        }
      }

      const assistantMessage = {
        role: 'assistant',
        content: replyText,
        timestamp: new Date().toISOString(),
        language: selectedLanguage,
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage = {
        role: 'error',
        content: t('Failed to get response. Please try again.', 'فشل الحصول على رد. حاول مرة أخرى.'),
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col px-4 py-6 sm:px-6 lg:h-screen lg:overflow-hidden">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        {/* Canvas top bar — back to the reports hub */}
        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3 animate-fade-up">
          <button
            onClick={() => { window.location.href = '#/reports'; }}
            className="btn-ghost-dark shrink-0 px-3.5 py-2 text-sm"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t('Reports', 'التقارير')}
          </button>
          <div className="min-w-0 flex-1">
            <p className="ms-eyebrow-canvas truncate">
              {selectedReport ? selectedReport.filename : 'MedSync AI'}
            </p>
            <h1 className="section-title">{t('Report Chat', 'الدردشة مع التقرير')}</h1>
          </div>
        </div>

        {/* Chat card — white surface on the dark canvas */}
        <div className="glass-card flex min-h-[560px] flex-col overflow-hidden animate-fade-up lg:min-h-0 lg:flex-1" style={{ animationDelay: '80ms' }}>
          {/* Card header — report identity + selectors */}
          <header className="shrink-0 border-b border-slate-200/70 px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="ms-serif truncate text-base font-semibold text-slate-900 sm:text-lg">
                  {selectedReport ? selectedReport.filename : t('Select a Report', 'اختر تقريراً')}
                </h2>
                <p className="hidden truncate text-xs text-slate-400 sm:block">{t('Ask questions about your medical reports', 'اطرح أسئلة عن تقاريرك الطبية')}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-3 justify-end">
                {/* Language selector */}
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-all hover:border-slate-300">
                  <Globe size={16} className="text-emerald-600" />
                  <select
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    className="cursor-pointer bg-transparent text-sm text-slate-900 focus:outline-none"
                  >
                    {supportedLanguages.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.nativeName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Report selector */}
                <div className="relative min-w-[200px] flex-1 sm:flex-none sm:w-64">
                  <select
                    value={selectedReport ? selectedReport._id : ''}
                    onChange={(e) => {
                      const report = reports.find(r => r._id === e.target.value);
                      setSelectedReport(report);
                      setMessages([]);
                    }}
                    className="select-modern pe-10"
                  >
                    <option value="" disabled>{t('Select a report to discuss', 'اختر تقريراً لمناقشته')}</option>
                    {reports.map(report => (
                      <option key={report._id} value={report._id}>{report.filename}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
            </div>
          </header>

          {/* Messages — scroll internally so the input stays reachable */}
          <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5 ${messages.length > 0 ? 'max-h-[52vh] lg:max-h-none' : ''}`}>
            {/* Report context — grounded Q&A source panel */}
            {selectedReport && (
              <div className="surface-inset flex items-center gap-2.5 px-4 py-2.5 text-xs text-slate-500">
                <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span className="truncate">
                  {t('Discussing:', 'جارٍ مناقشة:')} <span className="font-medium text-slate-900">{selectedReport.filename}</span>
                </span>
                <span className="chip-modern chip-taken ms-auto shrink-0">
                  <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-emerald-500" />
                  {t('Grounded Q&A', 'سؤال وجواب موثّق بالمصدر')}
                </span>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="flex h-full min-h-[300px] items-center justify-center">
                <div className="max-w-sm space-y-2 px-4 text-center animate-fade-up">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-600">
                    <FileText className="h-7 w-7" />
                  </div>
                  <h2 className="mb-1.5 text-xl font-bold text-slate-900">{t('Select a Report', 'اختر تقريراً')}</h2>
                  <p className="text-sm text-slate-500">{t('Choose a report from the dropdown above to start chatting.', 'اختر تقريراً من القائمة أعلاه لبدء الدردشة.')}</p>
                </div>
              </div>
            ) : (
              <div className="w-full space-y-4">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? `justify-end ${language === 'ar' ? 'animate-fade-up' : 'animate-slide-in-right'}` : 'justify-start animate-fade-up'}`}>
                    <div className={`flex items-start gap-2 max-w-[85%] sm:max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-emerald-50 border border-emerald-100 text-emerald-600'}`}>
                        {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                      </div>
                      <div className={`px-4 py-2.5 ${msg.role === 'user' ? 'bg-emerald-600 text-white rounded-2xl shadow-sm' : msg.role === 'error' ? 'bg-red-50 border border-red-200 text-red-700 rounded-2xl' : 'bg-slate-100 text-slate-800 rounded-2xl'}`}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                        {msg.language && msg.language !== 'en' && (
                          <p className={`text-[11px] mt-1.5 italic ${msg.role === 'user' ? 'text-emerald-100' : 'text-slate-500'}`}>({supportedLanguages.find(l => l.code === msg.language)?.nativeName || msg.language})</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {loading && !translatingMessage && (
              <div className="flex animate-fade-in justify-start">
                <div className="flex items-start gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-1.5 rounded-2xl bg-slate-100 px-4 py-3.5">
                    <span className="h-2 w-2 animate-pulse-soft rounded-full bg-slate-400" />
                    <span className="h-2 w-2 animate-pulse-soft rounded-full bg-slate-400" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 animate-pulse-soft rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            {translatingMessage && (
              <div className="flex animate-fade-in justify-start">
                <div className="flex items-start gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
                    <Loader className="h-4 w-4 animate-spin text-emerald-600" />
                  </div>
                  <div className="rounded-2xl bg-slate-100 px-4 py-2.5">
                    <p className="text-sm italic text-slate-500">{translatingMessage}</p>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input — pinned to the bottom of the chat card */}
          <footer className="shrink-0 border-t border-slate-200/70 p-4">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={selectedReport ? t(`Ask about ${selectedReport.filename}...`, `اسأل عن ${selectedReport.filename}...`) : t("Select a report first...", "اختر تقريراً أولاً...")}
                className="chat-input-modern flex-1 min-w-0"
                disabled={!selectedReport || loading}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!input.trim() || !selectedReport || loading}
                variant="primary"
                className="h-[54px] w-[54px] shrink-0"
                aria-label={t('Send message', 'إرسال الرسالة')}
              >
                {loading ? <Loader className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 rtl:rotate-180" />}
              </Button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default ReportChat;
