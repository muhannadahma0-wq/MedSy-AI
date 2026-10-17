import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../hooks/useTranslation";
import {
  User,
  Heart,
  Activity,
  Shield,
  Calendar,
  Phone,
  Edit3,
  Save,
  X,
  ArrowLeft,
  Stethoscope,
  Users,
  Pill,
  AlertTriangle,
  Plus,
  BarChart3,
} from "lucide-react";

function HealthProfile() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({});

  const token = localStorage.getItem("token");

  // Display-only gender labels — the stored/API value stays untouched
  const genderDisplay = (g) => {
    if (!g) return g;
    const normalized = String(g).toLowerCase();
    if (normalized === 'male') return t('Male', 'ذكر');
    if (normalized === 'female') return t('Female', 'أنثى');
    return g;
  };

  const fetchProfile = async () => {
    try {
      const res = await fetch("/api/health", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (data.profile) {
        setProfile(data.profile);
        setForm({
          ...data.profile,
          emergencyContactName: data.profile.emergencyContact?.name || "",
          emergencyContactPhone: data.profile.emergencyContact?.phone || "",
        });
      } else {
        setProfile(null);
        setForm({});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    // Handle emergency contact fields separately
    if (name === "emergencyContactName") {
      setForm({
        ...form,
        emergencyContactName: value,
        emergencyContact: {
          ...form.emergencyContact,
          name: value,
        },
      });
    } else if (name === "emergencyContactPhone") {
      setForm({
        ...form,
        emergencyContactPhone: value,
        emergencyContact: {
          ...form.emergencyContact,
          phone: value,
        },
      });
    } else {
      setForm({ ...form, [name]: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Helper function to clean array fields
    const cleanArrayField = (field) => {
      if (!field) return [];
      if (Array.isArray(field)) {
        return field.map(item => item.trim()).filter(item => item.length > 0);
      }
      return [];
    };

    // Build clean payload with only defined fields
    const payload = {};
    
    // Add basic fields if they exist
    if (form.age) payload.age = Number(form.age);
    if (form.gender) payload.gender = form.gender.trim();
    if (form.height) payload.height = Number(form.height);
    if (form.weight) payload.weight = Number(form.weight);
    if (form.bloodGroup) payload.bloodGroup = form.bloodGroup.trim();
    if (form.lastCheckup) payload.lastCheckup = form.lastCheckup;
    
    // Clean and add array fields
    const medicalConditions = cleanArrayField(form.medicalConditions);
    if (medicalConditions.length > 0) {
      payload.medicalConditions = medicalConditions;
    }
    
    const allergies = cleanArrayField(form.allergies);
    if (allergies.length > 0) {
      payload.allergies = allergies;
    }
    
    const medications = cleanArrayField(form.medications);
    if (medications.length > 0) {
      payload.medications = medications;
    }
    
    // Add emergency contact if both name and phone are provided
    const emergencyName = form.emergencyContactName?.trim();
    const emergencyPhone = form.emergencyContactPhone?.trim();
    
    if (emergencyName || emergencyPhone) {
      payload.emergencyContact = {
        name: emergencyName || "",
        phone: emergencyPhone || "",
      };
    }

    try {
      const res = await fetch("/api/health", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data = await res.json();
      if (data.profile) {
        setProfile(data.profile);
        setForm({
          ...data.profile,
          emergencyContactName: data.profile.emergencyContact?.name || "",
          emergencyContactPhone: data.profile.emergencyContact?.phone || "",
        });
        setEditMode(false);
      }
    } catch (err) {
      console.error("Error saving profile:", err);
      alert(t('Failed to save profile. Please try again.', 'فشل حفظ الملف. يرجى المحاولة مرة أخرى.'));
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-emerald-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-slate-400 text-lg">{t('Loading your health profile...', 'جارٍ تحميل ملفك الصحي...')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-up">
          <div className="flex items-center gap-x-4">
            <button
              onClick={() => navigate("/dashboard")}
              aria-label={t('Back to dashboard', 'العودة إلى لوحة التحكم')}
              className="p-3 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl transition-all group"
            >
              <ArrowLeft className="w-6 h-6 rtl:rotate-180 ltr:group-hover:-translate-x-1 rtl:group-hover:translate-x-1 transition-transform" />
            </button>
            <div>
              <p className="ms-eyebrow-canvas mb-2">{t('Your Health Record', 'سجلك الصحي')}</p>
              <h1 className="section-title">
                {t('Health Profile', 'الملف الصحي')}
              </h1>
              <p className="text-slate-400 mt-1.5">{t('Manage your health information', 'إدارة معلوماتك الصحية')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!editMode && profile && (
              <button
                onClick={() => setEditMode(true)}
                className="btn-primary-modern px-5 sm:px-6 py-2.5 sm:py-3 text-sm"
              >
                <Edit3 className="w-5 h-5" />
                <span>{t('Edit Profile', 'تعديل الملف')}</span>
              </button>
            )}

            <button
              onClick={() => navigate("/analytics")}
              className="btn-ghost-dark px-5 sm:px-6 py-2.5 sm:py-3 text-sm"
            >
              <BarChart3 className="w-5 h-5" />
              <span>{t('Analytics', 'التحليلات')}</span>
            </button>
          </div>
        </header>

        {!editMode ? (
          profile ? (
            <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
              {/* Main Profile Info */}
              <div className="lg:col-span-2 space-y-4 sm:space-y-6">
                {/* Basic Info Card */}
                <div className="glass-card p-6 animate-fade-up">
                  <div className="flex items-center gap-x-3 mb-6">
                    <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center">
                      <User className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <h2 className="ms-serif text-xl font-semibold text-slate-900">{t('Basic Information', 'المعلومات الأساسية')}</h2>
                      <p className="text-slate-500 text-sm">
                        {t('Your personal details', 'بياناتك الشخصية')}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoCard
                      icon={Calendar}
                      label={t('Age', 'العمر')}
                      value={`${profile.age} ${t('years', 'سنة')}`}
                      accent="emerald"
                    />
                    <InfoCard
                      icon={User}
                      label={t('Gender', 'الجنس')}
                      value={genderDisplay(profile.gender)}
                      accent="cyan"
                    />
                    <InfoCard
                      icon={Activity}
                      label={t('Height', 'الطول')}
                      value={`${profile.height} ${t('cm', 'سم')}`}
                      accent="cyan"
                    />
                    <InfoCard
                      icon={Activity}
                      label={t('Weight', 'الوزن')}
                      value={`${profile.weight} ${t('kg', 'كجم')}`}
                      accent="amber"
                    />
                    <InfoCard
                      icon={Heart}
                      label={t('Blood Group', 'زمرة الدم')}
                      value={profile.bloodGroup}
                      accent="rose"
                    />
                    <InfoCard
                      icon={Stethoscope}
                      label={t('Last Checkup', 'آخر فحص')}
                      value={
                        profile.lastCheckup
                          ? new Date(profile.lastCheckup).toLocaleDateString()
                          : t('Not recorded', 'غير مسجل')
                      }
                      accent="emerald"
                    />
                  </div>
                </div>

                {/* Medical History Card */}
                <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '60ms' }}>
                  <div className="flex items-center gap-x-3 mb-6">
                    <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center">
                      <Stethoscope className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <h2 className="ms-serif text-xl font-semibold text-slate-900">{t('Medical History', 'التاريخ الطبي')}</h2>
                      <p className="text-slate-500 text-sm">
                        {t('Conditions, allergies & medications', 'الحالات والحساسيات والأدوية')}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="surface-inset p-4">
                      <div className="flex items-center gap-x-2 mb-2">
                        <AlertTriangle className="w-5 h-5 text-red-600" />
                        <span className="font-medium text-slate-900">{t('Medical Conditions', 'الحالات الطبية')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {profile.medicalConditions &&
                        profile.medicalConditions.length > 0 ? (
                          profile.medicalConditions.map((condition, idx) => (
                            <span
                              key={idx}
                              className="px-3 py-1 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm"
                            >
                              {condition}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500 text-sm">
                            {t('No conditions recorded', 'لا توجد حالات مسجلة')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="surface-inset p-4">
                      <div className="flex items-center gap-x-2 mb-2">
                        <Shield className="w-5 h-5 text-amber-600" />
                        <span className="font-medium text-slate-900">{t('Allergies', 'الحساسيات')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {profile.allergies && profile.allergies.length > 0 ? (
                          profile.allergies.map((allergy, idx) => (
                            <span
                              key={idx}
                              className="px-3 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm"
                            >
                              {allergy}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500 text-sm">
                            {t('No allergies recorded', 'لا توجد حساسيات مسجلة')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="surface-inset p-4">
                      <div className="flex items-center gap-x-2 mb-2">
                        <Pill className="w-5 h-5 text-cyan-600" />
                        <span className="font-medium text-slate-900">{t('Current Medications', 'الأدوية الحالية')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {profile.medications &&
                        profile.medications.length > 0 ? (
                          profile.medications.map((medication, idx) => (
                            <span
                              key={idx}
                              className="px-3 py-1 bg-cyan-50 border border-cyan-200 text-cyan-700 rounded-lg text-sm"
                            >
                              {medication}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500 text-sm">
                            {t('No medications recorded', 'لا توجد أدوية مسجلة')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Emergency Contact Sidebar */}
              <div className="space-y-4 sm:space-y-6">
                <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '120ms' }}>
                  <div className="flex items-center gap-x-3 mb-6">
                    <div className="w-12 h-12 bg-red-50 border border-red-100 rounded-xl flex items-center justify-center">
                      <Users className="w-6 h-6 text-red-600" />
                    </div>
                    <div>
                      <h2 className="ms-serif text-xl font-semibold text-slate-900">{t('Emergency Contact', 'جهة الاتصال للطوارئ')}</h2>
                      <p className="text-slate-500 text-sm">
                        {t('In case of emergency', 'في حالات الطوارئ')}
                      </p>
                    </div>
                  </div>

                  {profile.emergencyContact ? (
                    <div className="space-y-4">
                      <div className="surface-inset p-4">
                        <div className="flex items-center gap-x-2 mb-2">
                          <User className="w-5 h-5 text-slate-400" />
                          <span className="text-sm text-slate-500">{t('Name', 'الاسم')}</span>
                        </div>
                        <p className="font-medium text-slate-900">
                          {profile.emergencyContact.name}
                        </p>
                      </div>
                      <div className="surface-inset p-4">
                        <div className="flex items-center gap-x-2 mb-2">
                          <Phone className="w-5 h-5 text-slate-400" />
                          <span className="text-sm text-slate-500">{t('Phone', 'الهاتف')}</span>
                        </div>
                        <p className="font-medium text-slate-900">
                          {profile.emergencyContact.phone}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <Users className="w-16 h-16 text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-500">{t('No emergency contact set', 'لا توجد جهة اتصال للطوارئ')}</p>
                    </div>
                  )}
                </div>

                {/* Health Stats */}
                <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '180ms' }}>
                  <div className="flex items-center gap-x-3 mb-4">
                    <div className="w-12 h-12 bg-rose-50 border border-rose-100 rounded-xl flex items-center justify-center">
                      <Heart className="w-6 h-6 text-rose-600" />
                    </div>
                    <h3 className="ms-serif text-lg font-semibold text-slate-900">{t('Health Score', 'درجة الصحة')}</h3>
                  </div>
                  <div className="text-3xl font-bold text-rose-700 mb-2">
                    8.5/10
                  </div>
                  <p className="text-sm text-slate-600">
                    {t('Your profile is complete and up-to-date! 🎯', 'ملفك الصحي مكتمل ومحدّث! 🎯')}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="glass-card p-8 sm:p-12 text-center max-w-lg animate-fade-up">
                <div className="w-20 h-20 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <User className="w-10 h-10 text-emerald-600" />
                </div>
                <h2 className="ms-serif text-2xl font-semibold mb-4 text-slate-900">
                  {t('Create Your Health Profile', 'أنشئ ملفك الصحي')}
                </h2>
                <p className="text-slate-600 mb-8">
                  {t('Set up your health information to get personalized insights and better care recommendations.', 'أكمل معلوماتك الصحية للحصول على رؤى مخصصة وتوصيات رعاية أفضل.')}
                </p>
                <button
                  onClick={() => setEditMode(true)}
                  className="btn-primary-modern mx-auto px-6 py-3"
                >
                  <Plus className="w-5 h-5" />
                  <span>{t('Create Profile', 'إنشاء الملف')}</span>
                </button>
              </div>
            </div>
          )
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            <div className="glass-card p-6 animate-fade-up">
              <div className="flex items-center gap-x-3 mb-6">
                <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center">
                  <Edit3 className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <h2 className="ms-serif text-xl font-semibold text-slate-900">{t('Edit Health Profile', 'تعديل الملف الصحي')}</h2>
                  <p className="text-slate-500 text-sm">
                    {t('Update your health information', 'حدّث معلوماتك الصحية')}
                  </p>
                </div>
              </div>

              {/* Basic Information */}
              <div className="space-y-4">
                <h3 className="ms-serif text-lg font-semibold flex items-center gap-x-2 text-slate-900">
                  <User className="w-5 h-5 text-emerald-600" />
                  <span>{t('Basic Information', 'المعلومات الأساسية')}</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <InputField
                    label={t('Age', 'العمر')}
                    name="age"
                    value={form.age || ""}
                    onChange={handleChange}
                    type="number"
                    placeholder="25"
                  />
                  <InputField
                    label={t('Gender', 'الجنس')}
                    name="gender"
                    value={form.gender || ""}
                    onChange={handleChange}
                    placeholder={t('Male/Female/Other', 'ذكر/أنثى/غير ذلك')}
                  />
                  <InputField
                    label={t('Height (cm)', 'الطول (سم)')}
                    name="height"
                    value={form.height || ""}
                    onChange={handleChange}
                    type="number"
                    placeholder="170"
                  />
                  <InputField
                    label={t('Weight (kg)', 'الوزن (كجم)')}
                    name="weight"
                    value={form.weight || ""}
                    onChange={handleChange}
                    type="number"
                    placeholder="70"
                  />
                  <InputField
                    label={t('Blood Group', 'زمرة الدم')}
                    name="bloodGroup"
                    value={form.bloodGroup || ""}
                    onChange={handleChange}
                    placeholder={t('A+, B-, O+, etc.', 'A+، B-، O+، إلخ.')}
                  />
                  <InputField
                    label={t('Last Checkup', 'آخر فحص')}
                    name="lastCheckup"
                    value={form.lastCheckup?.split("T")[0] || ""}
                    onChange={handleChange}
                    type="date"
                  />
                </div>
              </div>
            </div>

            {/* Medical History */}
            <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '60ms' }}>
              <div className="space-y-4">
                <h3 className="ms-serif text-lg font-semibold flex items-center gap-x-2 text-slate-900">
                  <Stethoscope className="w-5 h-5 text-emerald-600" />
                  <span>{t('Medical History', 'التاريخ الطبي')}</span>
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="label-modern">
                      {t('Medical Conditions', 'الحالات الطبية')}
                    </label>
                    <textarea
                      name="medicalConditions"
                      value={form.medicalConditions?.join(", ") || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setForm({
                          ...form,
                          medicalConditions: value
                            ? value
                                .split(",")
                                .map((s) => s.trim())
                                .filter((s) => s.length > 0)
                            : [],
                        });
                      }}
                      placeholder={t('Diabetes, Hypertension, Heart Disease (separate with commas)', 'السكري، ارتفاع ضغط الدم، أمراض القلب (افصل بينها بفواصل)')}
                      rows={3}
                      className="input-modern resize-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="label-modern">
                      {t('Allergies', 'الحساسيات')}
                    </label>
                    <textarea
                      name="allergies"
                      value={form.allergies?.join(", ") || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setForm({
                          ...form,
                          allergies: value
                            ? value
                                .split(",")
                                .map((s) => s.trim())
                                .filter((s) => s.length > 0)
                            : [],
                        });
                      }}
                      placeholder={t('Peanuts, Penicillin, Shellfish (separate with commas)', 'الفول السوداني، Penicillin، المحار (افصل بينها بفواصل)')}
                      rows={3}
                      className="input-modern resize-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="label-modern">
                      {t('Current Medications', 'الأدوية الحالية')}
                    </label>
                    <textarea
                      name="medications"
                      value={form.medications?.join(", ") || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setForm({
                          ...form,
                          medications: value
                            ? value
                                .split(",")
                                .map((s) => s.trim())
                                .filter((s) => s.length > 0)
                            : [],
                        });
                      }}
                      placeholder={t('Aspirin, Metformin, Lisinopril (separate with commas)', 'Aspirin، Metformin، Lisinopril (افصل بينها بفواصل)')}
                      rows={3}
                      className="input-modern resize-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Emergency Contact */}
            <div className="glass-card p-6 animate-fade-up" style={{ animationDelay: '120ms' }}>
              <div className="space-y-4">
                <h3 className="ms-serif text-lg font-semibold flex items-center gap-x-2 text-slate-900">
                  <Users className="w-5 h-5 text-red-600" />
                  <span>{t('Emergency Contact', 'جهة الاتصال للطوارئ')}</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <InputField
                    label={t('Contact Name', 'اسم جهة الاتصال')}
                    name="emergencyContactName"
                    value={form.emergencyContactName || ""}
                    onChange={handleChange}
                    placeholder={t('John Doe', 'محمد أحمد')}
                  />
                  <InputField
                    label={t('Contact Phone', 'هاتف جهة الاتصال')}
                    name="emergencyContactPhone"
                    value={form.emergencyContactPhone || ""}
                    onChange={handleChange}
                    placeholder="+1 234 567 8900"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 mt-6 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  className="btn-ghost-modern px-6 py-3"
                >
                  <X className="w-5 h-5" />
                  <span>{t('Cancel', 'إلغاء')}</span>
                </button>
                <button
                  type="submit"
                  className="btn-primary-modern px-6 py-3"
                >
                  <Save className="w-5 h-5" />
                  <span>{t('Save Profile', 'حفظ الملف')}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default HealthProfile;

// Helper component for info display — color-coded icon tile (emerald/cyan/amber/rose)
function InfoCard({ icon: Icon, label, value, accent = "slate" }) {
  const { t } = useLanguage();
  const accentTile = {
    emerald: "bg-emerald-50 border-emerald-100 text-emerald-600",
    cyan: "bg-cyan-50 border-cyan-100 text-cyan-600",
    amber: "bg-amber-50 border-amber-100 text-amber-600",
    rose: "bg-rose-50 border-rose-100 text-rose-600",
    slate: "bg-slate-100 border-slate-200 text-slate-500",
  }[accent] || "bg-slate-100 border-slate-200 text-slate-500";
  return (
    <div className="surface-inset p-4 hover:bg-slate-100/70 transition-all">
      <div className="flex items-center gap-x-2.5 mb-2.5">
        <span className={`flex items-center justify-center w-9 h-9 rounded-lg border shrink-0 ${accentTile}`}>
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-slate-500 text-sm">{label}</span>
      </div>
      <p className="font-medium text-lg text-slate-900">{value || t('Not set', 'غير محدد')}</p>
    </div>
  );
}

// Reusable input component
function InputField({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
}) {
  return (
    <div className="space-y-2">
      <label className="label-modern">{label}</label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="input-modern"
      />
    </div>
  );
}