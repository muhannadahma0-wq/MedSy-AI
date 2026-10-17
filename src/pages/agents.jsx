import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Brain, Heart, Pill, Activity, Send, Sparkles, 
  ChevronDown, ChevronUp, Loader, User, Bot,
  Zap, X, Menu, LayoutDashboard, HeartPulse, BotMessageSquare,
  FileText, ChartLine, Settings2, Radar, Gauge, Camera, Siren,
  ArrowLeftRight, ShieldAlert, ThumbsUp, ThumbsDown, AlertTriangle,
  Trash2, Plus, MessagesSquare, History, Database, FlaskConical, Check
} from 'lucide-react';
import { useLanguage } from '../hooks/useTranslation';
import { errorMessage } from '../lib/i18n';
import AppSidebar from '../components/AppSidebar.jsx';
import Button from '../components/Button';

export default function MultiAgentChat() {
  // Bilingual UI: t(en, ar) picks the string for the active language;
  // `language` is forwarded to the agent API so replies come back in Arabic.
  const { t, language, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [activeAgent, setActiveAgent] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [messages, setMessages] = useState({
    0: [],
    1: [],
    2: [],
    3: [],
    4: []
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Conversation 2.0 (v5 item 35) — server-backed threads ──────────────
  // Each agent tab keeps its own thread list + active thread id. Tab 0
  // (Smart Router) has no single backend agent — its panel merges the
  // threads of all four specialists (the router appends every exchange to
  // the ROUTED agent's thread and returns the id, so any of them can be
  // continued from here; threads may span agents server-side).
  const AGENT_THREAD_KEYS = ['medical', 'medicine', 'personal-health', 'emergency'];
  const THREAD_AGENT_BY_TAB = { 1: 'medical', 2: 'personal-health', 3: 'medicine', 4: 'emergency' };
  const [threads, setThreads] = useState({ 0: [], 1: [], 2: [], 3: [], 4: [] });
  const [threadsLoading, setThreadsLoading] = useState({ 0: false, 1: false, 2: false, 3: false, 4: false });
  const [activeThreadId, setActiveThreadId] = useState({ 0: null, 1: null, 2: null, 3: null, 4: null });
  const [loadingThread, setLoadingThread] = useState(false);
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
  // delete-confirm state: the thread id whose inline confirm is expanded
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingThread, setDeletingThread] = useState(false);

  // ── AI feedback (v5 item 38) — 👍 / 👎 / ⚠️ per answer ────────────────
  const [feedbackRatings, setFeedbackRatings] = useState({}); // logId → rating
  const [feedbackBusyLogId, setFeedbackBusyLogId] = useState(null);
  const [unsafeConfirmLogId, setUnsafeConfirmLogId] = useState(null);

  // ── Localized toast (error-code aware — PART 4) ──────────────────────
  const [toast, setToast] = useState(null); // { type: 'error'|'success', text }
  const toastTimerRef = useRef(null);
  // FIX (original-repo bug): original initialized sidebarOpen=true on every
  // screen size — on mobile the fixed w-72 (288px) sidebar squeezed the chat
  // column to ~100px and truncated all text. Start collapsed below the lg
  // breakpoint. (v4: the desktop rail is now the shared AppSidebar — visible
  // from md — so this state drives the mobile drawer; the >=1024 init is
  // preserved unchanged.)
  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const chatEndRef = useRef(null);
  // §51 — image upload flow state: { file, previewUrl, mode, analyzing, error }
  const [imageModal, setImageModal] = useState(null);
  const fileInputRef = useRef(null);

  const closeImageModal = () => {
    if (imageModal?.previewUrl) URL.revokeObjectURL(imageModal.previewUrl);
    setImageModal(null);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
      setImageModal({ error: t('Only PNG, JPEG or WebP images are supported.', 'الصور المدعومة: PNG أو JPEG أو WebP فقط.') });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImageModal({ error: t('Image exceeds the 10MB limit.', 'حجم الصورة يتجاوز حد 10 ميغابايت.') });
      return;
    }
    setImageModal({ file, previewUrl: URL.createObjectURL(file), mode: 'medication', analyzing: false, error: null });
  };

  // §51-52 — analyze the uploaded image through the vision pipeline
  // (/api/agents/vision): Gemini-vision primary → z-ai-vision fallback,
  // structured extraction + ALWAYS the verification notice.
  const handleAnalyzeImage = async () => {
    if (!imageModal?.file || imageModal.analyzing) return;
    setImageModal((m) => ({ ...m, analyzing: true, error: null }));
    try {
      const form = new FormData();
      form.append('image', imageModal.file);
      form.append('mode', imageModal.mode);
      form.append('language', language);
      const response = await fetch('/api/agents/vision', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: form,
      });
      const data = await response.json();
      const visionMessage = {
        role: 'assistant',
        content: data.explanation || data.error || t('Analysis failed. Please try again.', 'فشل التحليل. حاول مرة أخرى.'),
        vision: data.success
          ? { mode: data.mode, extracted: data.extracted || {}, verifyNotice: data.verifyNotice, warnings: data.warnings || [] }
          : null,
        confidence: data.confidence || null,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => ({ ...prev, [activeAgent]: [...prev[activeAgent], visionMessage] }));
      closeImageModal();
    } catch (error) {
      setImageModal((m) => ({ ...m, analyzing: false, error: t('Failed to analyze the image. Please try again.', 'فشل تحليل الصورة. حاول مرة أخرى.') }));
    }
  };

  // Phase 8 (AIRouter) — bilingual labels for the server-side routing badge
  // shown under Smart-Router replies. The response's `routedTo` names the
  // agent that actually handled the message (honest routing, no black box).
  const ROUTED_LABELS = {
    'emergency': ['Emergency Triage', 'فرز الطوارئ'],
    'personal-health': ['Personal Health', 'الصحة الشخصية'],
    'medicine': ['Medication Specialist', 'أخصائي الأدوية'],
    'medical': ['Medical Knowledge', 'المعرفة الطبية'],
  };

  // §50 quick actions — the 6-way chat launcher. The first four SELECT a
  // specialist card; the selection is a HINT only — every message still goes
  // through the AI Gateway (/api/agents), which verifies safety and can
  // correct the routing (preferredAgent + emergency/data-ownership overrides).
  const QUICK_ACTIONS = [
    { key: 'medication', icon: Pill, en: 'Medication', ar: 'أدوية', agentIndex: 3 },
    { key: 'medical', icon: Brain, en: 'Medical', ar: 'طبي', agentIndex: 1 },
    { key: 'my-health', icon: Heart, en: 'My Health', ar: 'صحتي', agentIndex: 2 },
    { key: 'emergency', icon: Siren, en: 'Emergency', ar: 'طوارئ', agentIndex: 4 },
    { key: 'report', icon: FileText, en: 'Analyze Report', ar: 'تحليل تقرير', navigateTo: '/reports' },
    { key: 'image', icon: Camera, en: 'Upload Image', ar: 'رفع صورة', action: 'upload' },
  ];

  // "Rhythm" v4: one calm emerald accent across all agents. `tile` is the
  // light emerald tile used INSIDE the white chat card (header, avatars,
  // empty state); `solid` is the emerald fill; `activeCard` is the
  // emerald-tinted active treatment on the dark canvas.
  // name/description/badge/complexity are English display defaults; the *Ar
  // twins are the Arabic display translations (endpoint stays untouched).
  // Agent 0 is the Phase-8 AIRouter — the DEFAULT experience: intent is
  // classified server-side (/api/agents) and the reply carries routedTo.
  const agents = [
    {
      id: 0,
      name: 'Smart Router',
      nameAr: 'الموجّه الذكي',
      endpoint: '/api/agents',
      icon: Sparkles,
      tile: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
      solid: 'bg-emerald-600',
      activeCard: 'ring-1 ring-emerald-400/40 bg-emerald-500/10',
      description: 'Ask anything — routed to the right specialist automatically',
      descriptionAr: 'اسأل أي شيء — يُوجّه سؤالك إلى الأخصائي المناسب تلقائيًا',
      badge: 'Auto-Route',
      badgeAr: 'توجيه تلقائي',
      complexity: 'Deterministic Intent Router',
      complexityAr: 'موجّه نية حتمي'
    },
    {
      id: 1,
      name: 'Medical Knowledge',
      nameAr: 'المعرفة الطبية',
      // §50: specialists post through the GATEWAY too — the card sets a
      // preferredAgent hint; the gateway still verifies safety + scope.
      endpoint: '/api/agents',
      preferredAgent: 'medical',
      icon: Brain,
      tile: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
      solid: 'bg-emerald-600',
      activeCard: 'ring-1 ring-emerald-400/40 bg-emerald-500/10',
      description: 'Advanced medical knowledge & research',
      descriptionAr: 'معرفة وبحث طبي متقدم',
      badge: 'General Health',
      badgeAr: 'صحة عامة',
      complexity: 'Deep Learning Model',
      complexityAr: 'نموذج تعلّم عميق'
    },
    {
      id: 2,
      name: 'Personal Health',
      nameAr: 'الصحة الشخصية',
      endpoint: '/api/agents',
      preferredAgent: 'personal-health',
      icon: Heart,
      tile: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
      solid: 'bg-emerald-600',
      activeCard: 'ring-1 ring-emerald-400/40 bg-emerald-500/10',
      description: 'Your personalized health companion',
      descriptionAr: 'رفيقك الصحي المخصص لك',
      badge: 'Context-Aware',
      badgeAr: 'واعٍ بالسياق',
      complexity: 'Memory-Enhanced AI',
      complexityAr: 'ذكاء اصطناعي معزّز بالذاكرة'
    },
    {
      id: 3,
      name: 'Medication Specialist',
      nameAr: 'أخصائي الأدوية',
      endpoint: '/api/agents',
      preferredAgent: 'medicine',
      icon: Pill,
      tile: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
      solid: 'bg-emerald-600',
      activeCard: 'ring-1 ring-emerald-400/40 bg-emerald-500/10',
      description: 'Pharmaceutical intelligence system',
      descriptionAr: 'نظام ذكاء صيدلاني',
      badge: 'Drug Database',
      badgeAr: 'قاعدة بيانات الأدوية',
      complexity: 'Multi-Source Analysis',
      complexityAr: 'تحليل متعدد المصادر'
    },
    {
      id: 4,
      name: 'Emergency Triage',
      nameAr: 'فرز الطوارئ',
      endpoint: '/api/agents',
      preferredAgent: 'emergency',
      icon: Activity,
      tile: 'bg-emerald-50 border border-emerald-100 text-emerald-600',
      solid: 'bg-emerald-600',
      activeCard: 'ring-1 ring-emerald-400/40 bg-emerald-500/10',
      description: 'Critical assessment & response',
      descriptionAr: 'تقييم واستجابة للحالات الحرجة',
      badge: 'Real-Time',
      badgeAr: 'في الوقت الفعلي',
      complexity: 'Priority Algorithm',
      complexityAr: 'خوارزمية بالأولوية'
    }
  ];

  // Primary navigation — shared by the desktop AppSidebar and the mobile
  // drawer (presentational config only; routing goes through useNavigate).
  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: t('Dashboard', 'لوحة التحكم'), onClick: () => navigate('/dashboard') },
    { id: 'health', icon: HeartPulse, label: t('Health', 'الصحة'), onClick: () => navigate('/health') },
    { id: 'agents', icon: BotMessageSquare, label: t('AI Assistant', 'المساعد الذكي'), onClick: () => navigate('/agents') },
    { id: 'reports', icon: FileText, label: t('Reports', 'التقارير'), onClick: () => navigate('/reports') },
    { id: 'analytics', icon: ChartLine, label: t('Analytics', 'التحليلات'), onClick: () => navigate('/analytics') },
    { id: 'intelligence', icon: Radar, label: t('Intelligence', 'الذكاء التنبؤي'), onClick: () => navigate('/intelligence') },
    { id: 'ai-monitoring', icon: Gauge, label: t('AI Monitoring', 'مراقبة الذكاء'), onClick: () => navigate('/ai-monitoring') },
    { id: 'research', icon: FlaskConical, label: t('Research', 'البحث'), onClick: () => navigate('/research') },
    { id: 'settings', icon: Settings2, label: t('Settings', 'الإعدادات'), onClick: () => navigate('/settings') }
  ];


  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Conversation 2.0 helpers ──────────────────────────────────────────

  // Localized toast with auto-hide (error-code aware messages arrive via
  // errorMessage() from src/lib/i18n.ts — never raw English error bodies).
  const showToast = (type, text) => {
    setToast({ type, text });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5200);
  };
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // Shared authenticated-fetch wrapper (same JWT pattern the rest of this
  // page uses — Bearer from localStorage, JSON body on writes).
  const authFetch = (url, options = {}) =>
    fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        ...(options.headers || {}),
      },
    });

  // Compact relative time for the thread rows ("5m" / "2h" / date).
  const formatRelativeTime = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return t('just now', 'الآن');
    if (mins < 60) return t(`${mins}m ago`, `قبل ${mins} د`);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t(`${hours}h ago`, `قبل ${hours} س`);
    const days = Math.floor(hours / 24);
    if (days < 7) return t(`${days}d ago`, `قبل ${days} ي`);
    return d.toLocaleDateString(language === 'ar' ? 'ar' : 'en-US', { day: 'numeric', month: 'short' });
  };

  // Fetch the thread list for a tab. Tab 0 (Smart Router) merges the lists
  // of all four specialists — newest first; failures degrade to an empty
  // list (the panel is never worth blocking the chat on).
  const loadThreads = async (tab) => {
    setThreadsLoading((prev) => ({ ...prev, [tab]: true }));
    try {
      const agentKeys = tab === 0 ? AGENT_THREAD_KEYS : [THREAD_AGENT_BY_TAB[tab]];
      const lists = await Promise.all(
        agentKeys.map((a) =>
          authFetch(`/api/agents/conversations?agent=${a}`)
            .then((r) => (r.ok ? r.json() : { conversations: [] }))
            .catch(() => ({ conversations: [] }))
        )
      );
      const merged = lists
        .flatMap((l) => (Array.isArray(l?.conversations) ? l.conversations : []))
        .sort((x, y) => new Date(y.updatedAt) - new Date(x.updatedAt));
      setThreads((prev) => ({ ...prev, [tab]: merged }));
    } catch {
      /* keep whatever was rendered */
    } finally {
      setThreadsLoading((prev) => ({ ...prev, [tab]: false }));
    }
  };

  useEffect(() => {
    loadThreads(activeAgent);
  }, [activeAgent]);

  // "＋ New conversation" — clear the chat + drop the active thread id. No
  // conversationId is sent until the first reply returns one (create-case).
  const handleNewConversation = () => {
    if (loading) return;
    setActiveThreadId((prev) => ({ ...prev, [activeAgent]: null }));
    setMessages((prev) => ({ ...prev, [activeAgent]: [] }));
    setConfirmDeleteId(null);
    setMobileThreadsOpen(false);
  };

  // Selecting a thread loads its full history into the chat area, mapped to
  // the same message-bubble shape. History messages carry no logId → the
  // feedback buttons render disabled on them (title/aria hint).
  const handleSelectThread = async (convId) => {
    if (loading || loadingThread) return;
    setMobileThreadsOpen(false);
    if (convId === activeThreadId[activeAgent]) return;
    setLoadingThread(true);
    setConfirmDeleteId(null);
    try {
      const res = await authFetch(`/api/agents/conversations?id=${encodeURIComponent(convId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data.conversation) {
        showToast(
          'error',
          res.status === 404
            ? t('Conversation not found.', 'لم يتم العثور على المحادثة.')
            : errorMessage(data?.error?.code, data?.message, language)
        );
        return;
      }
      const conv = data.conversation;
      setActiveThreadId((prev) => ({ ...prev, [activeAgent]: conv.id }));
      setMessages((prev) => ({
        ...prev,
        [activeAgent]: (conv.messages || []).map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
          timestamp: m.at || new Date().toISOString(),
          // who answered (routing badge context) — no logId for history
          agent: m.agent || null,
          logId: null,
        })),
      }));
    } catch {
      showToast('error', t('Could not load this conversation.', 'تعذّر تحميل هذه المحادثة.'));
    } finally {
      setLoadingThread(false);
    }
  };

  // Thread delete — soft archive on the server, removed from the list here;
  // deleting the ACTIVE thread resets the tab to a fresh state.
  const handleDeleteThread = async (convId) => {
    if (deletingThread) return;
    setDeletingThread(true);
    try {
      const res = await authFetch(`/api/agents/conversations?id=${encodeURIComponent(convId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw Object.assign(new Error('delete failed'), { code: data?.error?.code, status: res.status });
      }
      setThreads((prev) => ({ ...prev, [activeAgent]: prev[activeAgent].filter((c) => c.id !== convId) }));
      setConfirmDeleteId(null);
      if (activeThreadId[activeAgent] === convId) {
        setActiveThreadId((prev) => ({ ...prev, [activeAgent]: null }));
        setMessages((prev) => ({ ...prev, [activeAgent]: [] }));
      }
      showToast('success', t('Conversation deleted.', 'تم حذف المحادثة.'));
    } catch (err) {
      showToast(
        'error',
        err?.status === 404
          ? t('Conversation not found.', 'لم يتم العثور على المحادثة.')
          : errorMessage(err?.code, t('Could not delete this conversation.', 'تعذّر حذف هذه المحادثة.'), language)
      );
    } finally {
      setDeletingThread(false);
    }
  };

  // ── AI feedback (v5 item 38) ─────────────────────────────────────────
  // One vote per answer (upsert server-side); the chosen button stays
  // highlighted and can be changed. The ⚠️ path asks for a one-line bilingual
  // confirmation first — flagging goes to the AI quality dataset only.
  const submitFeedback = async (msg, rating) => {
    if (!msg.logId || feedbackBusyLogId === msg.logId) return;
    setFeedbackBusyLogId(msg.logId);
    try {
      const res = await authFetch('/api/agents/feedback', {
        method: 'POST',
        body: JSON.stringify({
          agent: msg.agent || agents[activeAgent].preferredAgent || 'router',
          rating,
          aiLogId: msg.logId,
          ...(activeThreadId[activeAgent] ? { conversationId: activeThreadId[activeAgent] } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw Object.assign(new Error('feedback failed'), { code: data?.error?.code });
      }
      setFeedbackRatings((prev) => ({ ...prev, [msg.logId]: rating }));
      showToast('success', t('Thanks for your feedback!', 'شكراً لملاحظاتك!'));
    } catch (err) {
      showToast(
        'error',
        errorMessage(err?.code, t('Could not save feedback. Please try again.', 'تعذّر حفظ التقييم. حاول مرة أخرى.'), language)
      );
    } finally {
      setFeedbackBusyLogId(null);
      setUnsafeConfirmLogId(null);
    }
  };

  const handleFeedbackClick = (msg, rating) => {
    if (!msg.logId) return;
    if (rating === 'unsafe') {
      setUnsafeConfirmLogId((prev) => (prev === msg.logId ? null : msg.logId));
      return;
    }
    submitFeedback(msg, rating);
  };

  const handleAgentChange = (newAgent) => {
    if (newAgent === activeAgent) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveAgent(newAgent);
      setIsTransitioning(false);
    }, 300);
  };

  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };
    const sentText = input;

    setMessages(prev => ({
      ...prev,
      [activeAgent]: [...prev[activeAgent], userMessage]
    }));
    setInput('');
    setLoading(true);

    try {
      // Get the user data from localStorage
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      // Conversation 2.0 — when a thread is active its id is echoed so the
      // exchange appends to THAT thread (history + rolling summary server-side).
      const threadId = activeThreadId[activeAgent] || null;

      const response = await fetch(agents[activeAgent].endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Phase 12 — authenticated agent call (the server overrides the
          // body identity with the verified caller).
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        },
        body: JSON.stringify({
          input: userMessage.content,
          user: user, // Include user data in the request body
          language, // UI language — backend answers in Arabic (MSA) when "ar"
          // §50 — specialist cards send a preferredAgent HINT; the AI
          // Gateway still verifies safety and can override it.
          ...(agents[activeAgent].preferredAgent
            ? { preferredAgent: agents[activeAgent].preferredAgent }
            : {}),
          ...(threadId ? { conversationId: threadId } : {}),
        })
      });

      const data = await response.json().catch(() => ({}));

      // Error-code aware failure path (e.g. 429 AI_BUDGET_EXCEEDED): a
      // friendly LOCALIZED toast — never the raw English error body. The
      // optimistic user bubble is reverted and the input restored so a
      // retry never duplicates the question.
      if (!response.ok || data?.success === false) {
        showToast(
          'error',
          errorMessage(data?.error?.code, data?.error?.message || data?.message, language)
        );
        setMessages(prev => ({
          ...prev,
          [activeAgent]: prev[activeAgent].filter(m => m !== userMessage)
        }));
        setInput(sentText);
        return;
      }

      const assistantMessage = {
        role: 'assistant',
        content: data.output || t('No response received', 'لم يتم استلام رد'),
        // Phase 8 — the AIRouter reports which specialist handled the
        // message; shown as a small badge under the reply (explicit agents
        // never set this).
        routedTo: data.routedTo || null,
        // AI Gateway (§28) — structured metadata badges
        handoffFrom: data.handoffFrom || null,
        severity: data.severity || null,
        // Conversation 2.0 — the audit id of THIS answer (feedback key) +
        // cache/history transparency chips.
        logId: data.logId || null,
        cached: data.cached === true,
        historyUsed: typeof data.historyUsed === 'number' ? data.historyUsed : 0,
        agent: data.routedTo || agents[activeAgent].preferredAgent || null,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => ({
        ...prev,
        [activeAgent]: [...prev[activeAgent], assistantMessage]
      }));

      // First reply in a fresh chat CREATES the thread — capture the id so
      // follow-ups continue it, and refresh the panel so it appears at once.
      if (data.conversationId) {
        setActiveThreadId(prev => ({ ...prev, [activeAgent]: data.conversationId }));
        loadThreads(activeAgent);
      }
    } catch (error) {
      const errorMessageObj = {
        role: 'error',
        content: t('Failed to get response. Please try again.', 'فشل الحصول على رد. حاول مرة أخرى.'),
        timestamp: new Date().toISOString()
      };
      setMessages(prev => ({
        ...prev,
        [activeAgent]: [...prev[activeAgent], errorMessageObj]
      }));
    } finally {
      setLoading(false);
    }
  };

  const currentAgent = agents[activeAgent];

  // Conversations panel body — shared by the desktop rail (≥lg) and the
  // mobile collapsible section. Lists the threads of the CURRENT agent tab
  // (tab 0 merges all four specialists) with title / relative time /
  // message count, an inline bilingual delete confirm, and a "＋ New" button
  // that starts a fresh thread (no conversationId until the first reply).
  const renderThreadsPanel = () => (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-3">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          <MessagesSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t('Conversations', 'المحادثات')}</span>
        </p>
        <button
          onClick={handleNewConversation}
          className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700 transition-all hover:bg-emerald-100"
          aria-label={t('Start a new conversation', 'بدء محادثة جديدة')}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t('New conversation', 'محادثة جديدة')}</span>
        </button>
      </div>
      <div
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3"
        aria-busy={threadsLoading[activeAgent] || undefined}
        aria-label={t('Conversation list', 'قائمة المحادثات')}
      >
        {threadsLoading[activeAgent] ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))
        ) : threads[activeAgent].length === 0 ? (
          <p className="px-1 py-2 text-[11px] leading-relaxed text-slate-400">
            {t(
              'No conversations yet — your saved threads for this agent will appear here.',
              'لا توجد محادثات بعد — ستظهر هنا سلاسل محادثاتك المحفوظة مع هذا الوكيل.'
            )}
          </p>
        ) : (
          threads[activeAgent].map((conv) => {
            const isActive = conv.id === activeThreadId[activeAgent];
            return (
              <div
                key={conv.id}
                className={`rounded-xl border transition-all ${
                  isActive
                    ? 'border-emerald-300 bg-emerald-50/70'
                    : 'border-slate-200/70 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-stretch gap-1 p-1.5">
                  <button
                    onClick={() => handleSelectThread(conv.id)}
                    className="min-h-[44px] min-w-0 flex-1 rounded-lg p-1.5 text-start transition-colors hover:bg-white/60"
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span className="block truncate text-xs font-semibold text-slate-800">
                      {conv.title || t('New conversation', 'محادثة جديدة')}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-400">
                      <span>{formatRelativeTime(conv.updatedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t(`${conv.messageCount} messages`, `${conv.messageCount} رسالة`)}</span>
                      {activeAgent === 0 && conv.agent && ROUTED_LABELS[conv.agent] && (
                        <span className="chip-modern border border-slate-200 bg-slate-50 px-1.5 py-0 text-[10px] text-slate-500">
                          {t(ROUTED_LABELS[conv.agent][0], ROUTED_LABELS[conv.agent][1])}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId((prev) => (prev === conv.id ? null : conv.id))}
                    className="flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-lg text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    aria-label={t('Delete conversation', 'حذف المحادثة')}
                    aria-expanded={confirmDeleteId === conv.id}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                {confirmDeleteId === conv.id && (
                  <div className="border-t border-slate-200/70 px-2.5 pb-2.5 pt-2">
                    <p className="text-[11px] leading-snug text-slate-500">
                      {t(
                        'Delete this conversation? This cannot be undone.',
                        'حذف هذه المحادثة؟ لا يمكن التراجع عن هذا الإجراء.'
                      )}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button
                        onClick={() => handleDeleteThread(conv.id)}
                        disabled={deletingThread}
                        className="min-h-[44px] flex-1 rounded-lg border border-rose-200 bg-rose-50 px-2 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60"
                      >
                        {deletingThread ? t('Deleting…', 'جارٍ الحذف…') : t('Delete', 'حذف')}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deletingThread}
                        className="min-h-[44px] flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
                      >
                        {t('Cancel', 'إلغاء')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen lg:h-screen lg:overflow-hidden">
      {/* Desktop sidebar — shared "Rhythm" light panel (hidden below md) */}
      <AppSidebar items={navItems} activeId="agents" />

      {/* Mobile navigation drawer — dark, mirrors the AppSidebar items.
          Open/close state machine preserved 1:1 from the previous version. */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 start-0 flex w-72 max-w-[85%] flex-col border-e border-white/10 bg-slate-950/95 backdrop-blur-xl animate-fade-in">
            {/* Brand */}
            <div className="flex items-center justify-between gap-2 px-5 pb-4 pt-6">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gradient">INSIGHT-X</h2>
                  <p className="text-xs text-slate-400">{t('Multi-Agent AI', 'وكلاء الصحة الذكيون')}</p>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
                aria-label={t('Toggle agents sidebar', 'إظهار/إخفاء شريط الوكلاء')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Navigation */}
            <nav aria-label={t('Primary navigation', 'التنقل الرئيسي')} className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-2">
              {navItems.map((item) => {
                const active = item.id === 'agents';
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { item.onClick(); setSidebarOpen(false); }}
                    aria-current={active ? 'page' : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-start text-sm font-medium transition-all duration-200 ${
                      active
                        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-transparent text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Status chips */}
            <div className="flex flex-col gap-2 px-5 pb-6">
              <div className="chip-modern border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
                <span>{t('5 Active', '5 نشط')}</span>
              </div>
              <div className="chip-modern border border-white/10 bg-white/5 text-slate-300">
                {t('Orchestration', 'التنسيق')}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Canvas top bar */}
        <div className="shrink-0 px-4 pb-4 pt-5 sm:px-6 animate-fade-up">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="-ms-1 rounded-xl p-2.5 text-slate-400 transition-all hover:bg-white/10 hover:text-slate-200 md:hidden"
              aria-label={t('Toggle agents sidebar', 'إظهار/إخفاء شريط الوكلاء')}
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="ms-eyebrow-canvas">INSIGHT-X</p>
              <h1 className="section-title">{t('Multi-Agent AI', 'وكلاء الصحة الذكيون')}</h1>
            </div>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <div className="chip-modern border border-emerald-400/30 bg-emerald-500/10 text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
                <span>{t('5 Active', '5 نشط')}</span>
              </div>
              <div className="chip-modern border border-white/10 bg-white/5 text-slate-300">
                {t('Orchestration', 'التنسيق')}
              </div>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-5 sm:px-6">
          {/* Agent picker — horizontal strip on phones, grid from sm up.
              Selection logic and per-agent conversation counters untouched. */}
          <div className="flex shrink-0 gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible xl:grid-cols-5">
            {agents.map((agent, idx) => (
              <button
                key={idx}
                onClick={() => handleAgentChange(idx)}
                className={`ms-panel w-[230px] shrink-0 p-4 text-start transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:w-auto ${
                  idx === activeAgent
                    ? 'bg-emerald-500/10 ring-1 ring-emerald-400/40'
                    : 'opacity-80 hover:bg-white/[0.07] hover:opacity-100'
                }`}
              >
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-300">
                    <agent.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-100">{t(agent.name, agent.nameAr)}</span>
                  </span>
                </div>
                <p className="mb-3 text-xs text-slate-400">{t(agent.description, agent.descriptionAr)}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="chip-modern border border-white/10 bg-white/5 text-slate-300">{t(agent.badge, agent.badgeAr)}</span>
                  <span className="chip-modern flex shrink-0 border border-white/10 bg-white/5 text-slate-300">
                    <Zap className="h-3 w-3" />
                    <span>{messages[idx].length}</span>
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Chat card — the AI showcase surface. On ≥lg the card gains a
              conversations rail (server-backed threads) on the inline-start
              edge; below lg the panel becomes a collapsible section under
              the agent header. */}
          <div className="glass-card flex min-h-[540px] flex-col overflow-hidden animate-fade-up lg:min-h-0 lg:flex-1 lg:flex-row" style={{ animationDelay: '120ms' }}>
            {/* Conversations rail (desktop ≥lg) — Conversation 2.0 threads */}
            <aside
              className="hidden w-64 shrink-0 flex-col border-e border-slate-200/70 lg:flex"
              aria-label={t('Conversations', 'المحادثات')}
            >
              {renderThreadsPanel()}
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
            {/* Agent header — serif name + status dot */}
            <header className={`shrink-0 border-b border-slate-200/70 px-4 py-3.5 transition-all duration-300 sm:px-5 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
              <div className="flex items-center gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${currentAgent.tile}`}>
                  <currentAgent.icon className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <h2 className="ms-serif truncate text-lg font-semibold text-slate-900 sm:text-xl">{t(currentAgent.name, currentAgent.nameAr)}</h2>
                    <span className="chip-modern shrink-0 border border-emerald-200 bg-emerald-50 text-emerald-700">
                      <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-emerald-500" />
                      {t('Online', 'متصل')}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-400">{t(currentAgent.description, currentAgent.descriptionAr)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Conversations toggle — below lg the rail becomes this
                      collapsible section (the rail itself is lg:flex only). */}
                  <button
                    onClick={() => setMobileThreadsOpen((prev) => !prev)}
                    className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-all hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 lg:hidden"
                    aria-label={t('Toggle conversations panel', 'إظهار/إخفاء لوحة المحادثات')}
                    aria-expanded={mobileThreadsOpen}
                  >
                    <MessagesSquare className="h-5 w-5" aria-hidden="true" />
                    {activeThreadId[activeAgent] && (
                      <span className="absolute end-1 top-1 h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    )}
                  </button>
                  <span className={`chip-modern hidden border font-semibold sm:inline-flex ${currentAgent.tile}`}>
                    #{activeAgent + 1}
                  </span>
                  <button
                    onClick={() => handleAgentChange(Math.max(0, activeAgent - 1))}
                    disabled={activeAgent === 0}
                    className={`hidden h-10 w-10 items-center justify-center rounded-xl transition-all sm:flex ${
                      activeAgent === 0
                        ? 'cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-300'
                        : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                    aria-label={t('Previous agent', 'الوكيل السابق')}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleAgentChange(Math.min(agents.length - 1, activeAgent + 1))}
                    disabled={activeAgent === agents.length - 1}
                    className={`hidden h-10 w-10 items-center justify-center rounded-xl transition-all sm:flex ${
                      activeAgent === agents.length - 1
                        ? 'cursor-not-allowed border border-slate-200 bg-slate-50 text-slate-300'
                        : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                    aria-label={t('Next agent', 'الوكيل التالي')}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </header>

            {/* Conversations — collapsible section below lg (the desktop
                rail is rendered above); capped height, internal scroll. */}
            {mobileThreadsOpen && (
              <div className="flex max-h-64 shrink-0 flex-col border-b border-slate-200/70 lg:hidden">
                {renderThreadsPanel()}
              </div>
            )}

            {/* Messages — scrolls internally so the input stays reachable */}
            <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto p-4 transition-all duration-500 sm:p-5 ${isTransitioning ? 'scale-95 opacity-0' : 'scale-100 opacity-100'} ${messages[activeAgent].length > 0 ? 'max-h-[46vh] lg:max-h-none' : ''}`}>
              {loadingThread ? (
                <div className="flex h-full min-h-[240px] items-center justify-center gap-2" aria-busy="true">
                  <Loader className="h-5 w-5 animate-spin text-emerald-600" aria-hidden="true" />
                  <span className="text-xs text-slate-400">{t('Loading conversation…', 'جارٍ تحميل المحادثة…')}</span>
                  <span className="sr-only">{t('Loading conversation history', 'جارٍ تحميل سجل المحادثة')}</span>
                </div>
              ) : messages[activeAgent].length === 0 ? (
                <div className="flex h-full min-h-[300px] items-center justify-center">
                  <div className="max-w-md space-y-4 px-4 py-2 text-center animate-fade-up">
                    <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${currentAgent.tile}`}>
                      <currentAgent.icon className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">{t('Start Conversation', 'ابدأ المحادثة')}</h3>
                    <p className="text-sm text-slate-500">
                      {t(
                        `Ask me anything about ${currentAgent.description.toLowerCase()}`,
                        `اسألني عن أي شيء يتعلق بـ${currentAgent.descriptionAr}`
                      )}
                    </p>
                    <div className="mt-4 grid grid-cols-1 gap-2">
                      {activeAgent === 0 && (
                        <>
                          <button onClick={() => setInput(t("What are the symptoms of diabetes?", "ما هي أعراض مرض السكري؟"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"What are the symptoms of diabetes?"', '"ما هي أعراض مرض السكري؟"')}
                          </button>
                          <button onClick={() => setInput(t("I have chest pain and difficulty breathing", "أشعر بألم في الصدر وضيق في التنفس"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"I have chest pain and difficulty breathing"', '"أشعر بألم في الصدر وضيق في التنفس"')}
                          </button>
                        </>
                      )}
                      {activeAgent === 1 && (
                        <>
                          <button onClick={() => setInput(t("What are the symptoms of diabetes?", "ما هي أعراض مرض السكري؟"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"What are the symptoms of diabetes?"', '"ما هي أعراض مرض السكري؟"')}
                          </button>
                          <button onClick={() => setInput(t("Explain cardiovascular disease", "اشرح مرض القلب والأوعية الدموية"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"Explain cardiovascular disease"', '"اشرح مرض القلب والأوعية الدموية"')}
                          </button>
                        </>
                      )}
                      {activeAgent === 2 && (
                        <>
                          <button onClick={() => setInput(t("Track my blood pressure", "تتبّع ضغط دمي"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"Track my blood pressure"', '"تتبّع ضغط دمي"')}
                          </button>
                          <button onClick={() => setInput(t("Show my health trends", "أظهر مؤشراتي الصحية"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"Show my health trends"', '"أظهر مؤشراتي الصحية"')}
                          </button>
                        </>
                      )}
                      {activeAgent === 3 && (
                        <>
                          <button onClick={() => setInput(t("What are side effects of aspirin?", "ما الآثار الجانبية لدواء Aspirin؟"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"What are side effects of aspirin?"', '"ما الآثار الجانبية لدواء Aspirin؟"')}
                          </button>
                          <button onClick={() => setInput(t("Check drug interactions", "تحقّق من تفاعلات الأدوية"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"Check drug interactions"', '"تحقّق من تفاعلات الأدوية"')}
                          </button>
                        </>
                      )}
                      {activeAgent === 4 && (
                        <>
                          <button onClick={() => setInput(t("I have chest pain", "أشعر بألم في الصدر"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"I have chest pain"', '"أشعر بألم في الصدر"')}
                          </button>
                          <button onClick={() => setInput(t("Severe headache assessment", "تقييم صداع شديد"))} className="surface-inset px-4 py-2.5 text-start text-xs text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-all duration-200">
                            {t('"Severe headache assessment"', '"تقييم صداع شديد"')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {messages[activeAgent].map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? `justify-end ${isRTL ? 'animate-fade-up' : 'animate-slide-in-right'}` : 'justify-start animate-fade-up'}`}>
                      <div className={`flex items-start gap-2 max-w-[85%] sm:max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          msg.role === 'user' 
                            ? 'bg-emerald-600 text-white shadow-sm' 
                            : currentAgent.tile
                        }`}>
                          {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                        </div>
                        <div className={`flex flex-col min-w-0 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                          <div className={`px-4 py-2.5 ${
                            msg.role === 'user' 
                              ? 'bg-emerald-600 text-white rounded-2xl shadow-sm' 
                              : msg.role === 'error'
                              ? 'bg-red-50 border border-red-200 text-red-700 rounded-2xl'
                              : 'bg-slate-100 text-slate-800 rounded-2xl'
                          }`}>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                          </div>
                          {msg.role === 'assistant' && msg.routedTo && ROUTED_LABELS[msg.routedTo] && (
                            <span className="chip-modern mt-1.5 border border-emerald-200 bg-emerald-50 text-emerald-700">
                              <Radar className="h-3 w-3" aria-hidden="true" />
                              <span>{t(`Routed to: ${ROUTED_LABELS[msg.routedTo][0]}`, `وجّه إلى: ${ROUTED_LABELS[msg.routedTo][1]}`)}</span>
                            </span>
                          )}
                          {msg.role === 'assistant' && msg.handoffFrom && ROUTED_LABELS[msg.handoffFrom] && (
                            <span className="chip-modern mt-1.5 border border-amber-200 bg-amber-50 text-amber-700">
                              <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                              <span>{t(`Redirected from ${ROUTED_LABELS[msg.handoffFrom][0]}`, `حوّل من ${ROUTED_LABELS[msg.handoffFrom][1]}`)}</span>
                            </span>
                          )}
                          {msg.role === 'assistant' && msg.severity && (
                            <span className="chip-modern mt-1.5 border border-rose-200 bg-rose-50 text-rose-700">
                              <Siren className="h-3 w-3" aria-hidden="true" />
                              <span>{t(`Severity: ${msg.severity.toUpperCase()}`, `الخطورة: ${{ emergency: 'طارئ', urgent: 'عاجل', moderate: 'متوسط', low: 'منخفض' }[msg.severity] || msg.severity}`)}</span>
                            </span>
                          )}
                          {/* Conversation 2.0 transparency — cache hit + how much
                              thread history the answer was grounded on. */}
                          {msg.role === 'assistant' && msg.cached && (
                            <span
                              className="chip-modern mt-1.5 border border-slate-200 bg-slate-50 text-slate-500"
                              title={t('Served from the 24h answer cache — identical question asked recently.', 'من ذاكرة الإجابات المؤقتة (24 ساعة) — سؤال مطابق طُرح مؤخراً.')}
                            >
                              <Database className="h-3 w-3" aria-hidden="true" />
                              <span>{t('Cached answer', 'إجابة مخزّنة')}</span>
                            </span>
                          )}
                          {msg.role === 'assistant' && msg.historyUsed > 0 && (
                            <span
                              className="chip-modern mt-1.5 border border-slate-200 bg-slate-50 text-slate-400"
                              title={t('Conversation turns included as context for this reply', 'عدد أدوار المحادثة المُدرجة كسياق لهذا الرد')}
                            >
                              <History className="h-3 w-3" aria-hidden="true" />
                              <span>{t(`History: ${msg.historyUsed}`, `السياق: ${msg.historyUsed}`)}</span>
                            </span>
                          )}
                          {msg.role === 'assistant' && msg.vision && (
                            <div className="mt-1.5 max-w-full rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-start space-y-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="chip-modern border border-cyan-200 bg-cyan-50 text-cyan-700">
                                  <Camera className="h-3 w-3" aria-hidden="true" />
                                  <span>{msg.vision.mode === 'report' ? t('Medical Report Image', 'صورة تقرير طبي') : t('Medication Image', 'صورة دواء')}</span>
                                </span>
                                {msg.vision.extracted?.drugName && (
                                  <span className="chip-modern border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">
                                    {msg.vision.extracted.drugName}{msg.vision.extracted.strength ? ` · ${msg.vision.extracted.strength}` : ''}
                                  </span>
                                )}
                                {msg.vision.extracted?.documentType && (
                                  <span className="chip-modern border border-emerald-200 bg-emerald-50 text-emerald-700">{msg.vision.extracted.documentType}</span>
                                )}
                              </div>
                              {(msg.vision.warnings || []).length > 0 && (
                                <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
                                  {(msg.vision.warnings || []).map((w, i) => <div key={i}>⚠ {w}</div>)}
                                </div>
                              )}
                              {/* §52 — visual recognition is NEVER proof of drug identity */}
                              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-800">
                                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span>{msg.vision.verifyNotice}</span>
                              </p>
                            </div>
                          )}
                          {/* AI feedback (v5 item 38) — 👍 helpful / 👎 unhelpful /
                              ⚠️ unsafe under every assistant message. Buttons
                              are 44px hit areas; the chosen rating stays
                              highlighted (server upserts — the vote can be
                              changed). History-loaded answers carry no logId →
                              disabled with a title/aria hint. */}
                          {msg.role === 'assistant' && (
                            <div className="mt-1.5 flex items-center gap-0.5" role="group" aria-label={t('Rate this answer', 'قيّم هذا الرد')}>
                              <button
                                onClick={() => handleFeedbackClick(msg, 'helpful')}
                                disabled={!msg.logId}
                                aria-label={msg.logId ? t('Helpful answer', 'رد مفيد') : t('Feedback is unavailable for answers loaded from history', 'التقييم غير متاح للردود المحمّلة من السجل')}
                                title={msg.logId ? t('Helpful answer', 'رد مفيد') : t('Feedback is unavailable for answers loaded from history', 'التقييم غير متاح للردود المحمّلة من السجل')}
                                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                                  msg.logId && feedbackRatings[msg.logId] === 'helpful'
                                    ? 'border border-emerald-300 bg-emerald-100 text-emerald-700'
                                    : 'border border-transparent text-slate-400 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600'
                                }`}
                              >
                                <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button
                                onClick={() => handleFeedbackClick(msg, 'unhelpful')}
                                disabled={!msg.logId}
                                aria-label={msg.logId ? t('Unhelpful answer', 'رد غير مفيد') : t('Feedback is unavailable for answers loaded from history', 'التقييم غير متاح للردود المحمّلة من السجل')}
                                title={msg.logId ? t('Unhelpful answer', 'رد غير مفيد') : t('Feedback is unavailable for answers loaded from history', 'التقييم غير متاح للردود المحمّلة من السجل')}
                                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                                  msg.logId && feedbackRatings[msg.logId] === 'unhelpful'
                                    ? 'border border-amber-300 bg-amber-100 text-amber-700'
                                    : 'border border-transparent text-slate-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600'
                                }`}
                              >
                                <ThumbsDown className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button
                                onClick={() => handleFeedbackClick(msg, 'unsafe')}
                                disabled={!msg.logId}
                                aria-label={msg.logId ? t('Report unsafe answer', 'الإبلاغ عن رد غير آمن') : t('Feedback is unavailable for answers loaded from history', 'التقييم غير متاح للردود المحمّلة من السجل')}
                                title={msg.logId ? t('Report unsafe answer', 'الإبلاغ عن رد غير آمن') : t('Feedback is unavailable for answers loaded from history', 'التقييم غير متاح للردود المحمّلة من السجل')}
                                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                                  msg.logId && feedbackRatings[msg.logId] === 'unsafe'
                                    ? 'border border-rose-300 bg-rose-100 text-rose-700'
                                    : 'border border-transparent text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
                                }`}
                              >
                                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                              </button>
                              {feedbackBusyLogId === msg.logId && (
                                <Loader className="ms-1 h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden="true" />
                              )}
                              {msg.logId && feedbackRatings[msg.logId] && feedbackBusyLogId !== msg.logId && (
                                <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                              )}
                            </div>
                          )}
                          {/* ⚠️ unsafe — one-line bilingual confirmation before
                              flagging (goes to the AI quality dataset only). */}
                          {msg.role === 'assistant' && msg.logId && unsafeConfirmLogId === msg.logId && (
                            <div className="mt-1.5 max-w-full rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2">
                              <p className="text-[11px] leading-snug text-rose-700">
                                {t(
                                  'This will be flagged for the AI quality dataset — no personal data is stored.',
                                  'سيُعلَّم هذا الرد لفحص جودة الذكاء الاصطناعي — لا تُخزَّن أي بيانات شخصية.'
                                )}
                              </p>
                              <div className="mt-1.5 flex items-center gap-1.5">
                                <button
                                  onClick={() => submitFeedback(msg, 'unsafe')}
                                  disabled={feedbackBusyLogId === msg.logId}
                                  className="min-h-[44px] flex-1 rounded-lg border border-rose-300 bg-rose-100 px-2 text-[11px] font-semibold text-rose-800 transition-colors hover:bg-rose-200 disabled:opacity-60"
                                >
                                  {feedbackBusyLogId === msg.logId ? t('Sending…', 'جارٍ الإرسال…') : t('Report', 'إبلاغ')}
                                </button>
                                <button
                                  onClick={() => setUnsafeConfirmLogId(null)}
                                  disabled={feedbackBusyLogId === msg.logId}
                                  className="min-h-[44px] flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
                                >
                                  {t('Cancel', 'إلغاء')}
                                </button>
                              </div>
                            </div>
                          )}
                          <span className="mt-1 px-1 text-xs text-slate-400 opacity-60">
                            {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {loading && messages[activeAgent].length > 0 && (
                    <div className="flex justify-start animate-fade-in">
                      <div className="flex items-start gap-2">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${currentAgent.tile}`}>
                          <Bot className="w-4 h-4" />
                        </div>
                        <div className="bg-slate-100 rounded-2xl px-4 py-3.5 flex items-center gap-1.5">
                          <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-soft" />
                          <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-soft" style={{ animationDelay: '150ms' }} />
                          <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-soft" style={{ animationDelay: '300ms' }} />
                          <span className="text-xs text-slate-500 ms-1">{t('Thinking...', 'يفكّر...')}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            {/* Input — sticky bar at the bottom of the chat card */}
            <div className="shrink-0 border-t border-slate-200/70 px-4 py-3 sm:px-5">
              {/* §50 — the 6-way launcher: 4 specialist picks (gateway-verified
                  hints), report analysis, and image upload */}
              <div className="mb-2.5 flex flex-wrap items-center justify-center gap-1.5">
                {QUICK_ACTIONS.map((action) => {
                  const ActionIcon = action.icon;
                  const isActive = action.agentIndex !== undefined && action.agentIndex === activeAgent;
                  return (
                    <button
                      key={action.key}
                      onClick={() => {
                        if (action.agentIndex !== undefined) handleAgentChange(action.agentIndex);
                        else if (action.navigateTo) navigate(action.navigateTo);
                        else if (action.action === 'upload') fileInputRef.current?.click();
                      }}
                      className={`flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                        isActive
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-700'
                      }`}
                      aria-pressed={isActive || undefined}
                    >
                      <ActionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t(action.en, action.ar)}</span>
                    </button>
                  );
                })}
              </div>
              {/* §51 — hidden file input for the image pipeline */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleFileSelect}
                aria-label={t('Upload an image', 'رفع صورة')}
              />
              <div className="flex items-end gap-2 max-w-3xl mx-auto">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="flex h-[56px] w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-all hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t('Upload image for analysis', 'ارفع صورة للتحليل')}
                  title={t('Upload image for analysis', 'ارفع صورة للتحليل')}
                >
                  <Camera className="h-5 w-5" />
                </button>
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={t(`Ask ${currentAgent.name}...`, `اسأل ${currentAgent.nameAr}...`)}
                    rows="2"
                    className="chat-input-modern"
                    disabled={loading}
                  />
                </div>
                <Button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || loading}
                  variant="primary"
                  className="h-[56px] shrink-0"
                >
                  {loading ? (
                    <Loader className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5 rtl:rotate-180" />
                  )}
                  <span className="hidden sm:inline">{t('Send', 'إرسال')}</span>
                </Button>
              </div>
              <p className="text-[11px] text-slate-400 mt-2 text-center">
                {t(currentAgent.complexity, currentAgent.complexityAr)} • {t('Secure & Private', 'آمن وخاص')}
              </p>
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Localized toast — error-code aware (AI_BUDGET_EXCEEDED & friends
          render through src/lib/i18n.ts, never raw English error bodies). */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`fixed top-4 left-1/2 z-[80] w-[min(92vw,26rem)] -translate-x-1/2 rounded-2xl border px-4 py-3 shadow-[0_16px_44px_-8px_rgba(2,6,23,0.45)] animate-fade-up ${
            toast.type === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {toast.type === 'error' ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" aria-hidden="true" />
            ) : (
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1 text-sm leading-relaxed">{toast.text}</p>
            <button
              onClick={() => setToast(null)}
              className="-me-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/70 hover:text-slate-600"
              aria-label={t('Dismiss', 'إغلاق')}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* §51 — image upload modal: preview → mode choice → analyze →
          verify. The verification step is part of the medical UX contract:
          visual recognition is never treated as proof of drug identity. */}
      {imageModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('Analyze image', 'تحليل الصورة')}>
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={closeImageModal} aria-hidden="true" />
          <div className="glass-card relative z-10 w-full max-w-md space-y-4 p-5 animate-fade-up">
            <div className="flex items-center justify-between gap-2">
              <h3 className="ms-serif text-lg font-semibold text-slate-900">{t('Analyze Image', 'تحليل الصورة')}</h3>
              <button
                onClick={closeImageModal}
                className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label={t('Close', 'إغلاق')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {imageModal.previewUrl ? (
              <>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <img
                    src={imageModal.previewUrl}
                    alt={t('Image preview', 'معاينة الصورة')}
                    className="max-h-64 w-full object-contain"
                  />
                </div>

                {/* Mode choice — routes the image through the right pipeline */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-500">{t('What is this an image of?', 'ما هذه الصورة؟')}</p>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('Image type', 'نوع الصورة')}>
                    <button
                      onClick={() => setImageModal((m) => ({ ...m, mode: 'medication' }))}
                      role="radio"
                      aria-checked={imageModal.mode === 'medication'}
                      className={`flex min-h-[64px] flex-col items-start gap-1 rounded-xl border p-3 text-start transition-all ${
                        imageModal.mode === 'medication'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold"><Pill className="h-4 w-4" /> {t('Medication', 'دواء')}</span>
                      <span className="text-[11px] leading-snug opacity-80">{t('Box, label or pill package', 'علبة أو ملصق أو عبوة دواء')}</span>
                    </button>
                    <button
                      onClick={() => setImageModal((m) => ({ ...m, mode: 'report' }))}
                      role="radio"
                      aria-checked={imageModal.mode === 'report'}
                      className={`flex min-h-[64px] flex-col items-start gap-1 rounded-xl border p-3 text-start transition-all ${
                        imageModal.mode === 'report'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold"><FileText className="h-4 w-4" /> {t('Medical Report', 'تقرير طبي')}</span>
                      <span className="text-[11px] leading-snug opacity-80">{t('Lab result or medical document', 'نتيجة تحليل أو مستند طبي')}</span>
                    </button>
                  </div>
                </div>

                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  {t(
                    'The image is analyzed to extract visible information only — it is never treated as a prescription or a confirmed identification.',
                    'تُحلّل الصورة لاستخراج المعلومات الظاهرة فقط — ولا تُعامل أبداً كوصفة طبية أو تعريف مؤكد للدواء.'
                  )}
                </p>

                {imageModal.error && (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{imageModal.error}</p>
                )}

                <div className="flex gap-2">
                  <Button onClick={closeImageModal} variant="outline" className="flex-1">
                    {t('Cancel', 'إلغاء')}
                  </Button>
                  <Button onClick={handleAnalyzeImage} variant="primary" isLoading={imageModal.analyzing} disabled={imageModal.analyzing} className="flex-1">
                    {t('Analyze', 'تحليل')}
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{imageModal.error}</p>
                <Button onClick={() => setImageModal(null)} variant="outline" className="w-full">
                  {t('Close', 'إغلاق')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
