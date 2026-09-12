'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AppSettings,
  type Person,
  type Profile,
  type Receipt,
  type Role,
  cancelReceipt,
  createLocalSnapshot,
  createLocalUser,
  createReceipt,
  exportBackup,
  getBackupInfo,
  getSettings,
  getStorageInfo,
  importPeople,
  initLocalApp,
  listPeople,
  listReceipts,
  listUsers,
  loginLocal,
  logoutLocal,
  markDelivery,
  normalizeName,
  requestPersistentStorage,
  restoreBackup,
  saveSettings,
  searchPeople,
  setupFirstAdmin,
} from '@/lib/local-db';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type Tab = 'home' | 'sent' | 'names' | 'reports' | 'settings';
type DashboardData = {
  dailyTotal: number;
  dailyCount: number;
  namesCount: number;
  monthTotal: number;
  monthCount: number;
  lastAmount: number;
  recent: Receipt[];
};

type IconName =
  | 'home' | 'sent' | 'users' | 'reports' | 'settings' | 'logout' | 'search'
  | 'send' | 'cancel' | 'wallet' | 'file' | 'clock' | 'bell' | 'chevron'
  | 'mail' | 'whatsapp' | 'copy' | 'menu' | 'sun' | 'chart' | 'shield' | 'upload'
  | 'database' | 'download' | 'restore' | 'userplus';

function normalizeDigits(value: string) {
  return value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^0-9.]/g, '');
}

function cleanPhone(value: string) {
  return value.replace(/[^\d]/g, '').replace(/^00/, '');
}

function formatNumber(value: number | string) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function money(value: number | string, currency = 'د.ع') {
  return `${formatNumber(value)} ${currency}`;
}

function localDateTime(iso: string) {
  const dt = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(dt);
  const time = new Intl.DateTimeFormat('ar-IQ', {
    timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(dt);
  return { date, time };
}

function baghdadDayRange() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const start = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00+03:00`);
  const nextMonth = m === 12
    ? new Date(`${y + 1}-01-01T00:00:00+03:00`)
    : new Date(`${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00+03:00`);
  return { start, end, monthStart, nextMonth };
}

function todayLong() {
  return new Intl.DateTimeFormat('ar-IQ', {
    timeZone: 'Asia/Baghdad', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date());
}

function roleLabel(role: Profile['role']) {
  return role === 'admin' ? 'مدير' : role === 'viewer' ? 'مشاهدة فقط' : 'موظف';
}

function channelLabel(channel: Receipt['send_channel'] | 'email' | 'whatsapp' | 'both') {
  return channel === 'both' ? 'الاثنين معًا' : channel === 'email' ? 'بريد إلكتروني' : 'واتساب';
}

function formatBytes(value: number | null) {
  if (value == null) return 'غير متاح';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="M3 11.2 12 4l9 7.2"/><path d="M5.5 10.3V20h13v-9.7"/><path d="M9 20v-6h6v6"/></>,
    sent: <><path d="m21 3-8.5 18-2.7-7.2L3 10.5 21 3Z"/><path d="m9.8 13.8 4.9-4.7"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16.2 7.2a2.8 2.8 0 0 1 0 5.5"/><path d="M17 14.5c2.3.6 4 2.7 4 5.5"/></>,
    reports: <><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V3h4v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    logout: <><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M13 3h8v18h-8"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    cancel: <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></>,
    wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6Z"/><path d="M2 8V5a2 2 0 0 1 2-2h12"/><path d="M15 11h7v4h-7a2 2 0 0 1 0-4Z"/></>,
    file: <><path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5"/><path d="M9 12h6M9 16h6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    chevron: <path d="m9 6 6 6-6 6"/>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    whatsapp: <><path d="M20 11.5a8 8 0 0 1-11.7 7L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z"/><path d="M9 8.5c.5 2.5 2 4 4.5 5"/></>,
    copy: <><rect x="8" y="8" width="11" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h3"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    chart: <><path d="M4 20V11"/><path d="M10 20V6"/><path d="M16 20V3"/><path d="M22 20H2"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></>,
    restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></>,
    userplus: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M18 8v6M15 11h6"/></>,
  };
  return <svg className={`ico ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function SystemApp() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);

  const notify = (text: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 3600);
  };

  async function hydrate() {
    setLoading(true);
    setFatal('');
    try {
      const result = await initLocalApp();
      setNeedsSetup(result.needsSetup);
      setProfile(result.profile);
      setSettings(result.settings);
    } catch (e) {
      setFatal(e instanceof Error ? e.message : 'تعذر فتح قاعدة البيانات المحلية.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { hydrate(); }, []);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    setIsInstalled(standalone);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      notify('تم تثبيت التطبيق بنجاح.');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  async function installApp() {
    if (isInstalled) {
      notify('التطبيق مثبت بالفعل على هذا الجهاز.');
      return;
    }

    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null);
      }
      return;
    }

    setShowInstallHelp(true);
  }

  if (loading) return <Splash />;
  if (fatal) return <ErrorState message={fatal} onRetry={hydrate} />;
  if (needsSetup) return <FirstSetup onDone={(p) => { setNeedsSetup(false); setProfile(p); getSettings().then(setSettings); }} notify={notify} />;
  if (!profile) return <Login onDone={(p) => setProfile(p)} notify={notify} />;
  if (!settings) return <Splash />;

  const tabs: { key: Tab; icon: IconName; label: string }[] = [
    { key: 'home', icon: 'home', label: 'الرئيسية' },
    { key: 'sent', icon: 'sent', label: 'المرسلة' },
    { key: 'names', icon: 'users', label: 'الأسماء' },
    { key: 'reports', icon: 'reports', label: 'التقارير' },
    { key: 'settings', icon: 'settings', label: 'الإعدادات' },
  ];

  function logout() {
    logoutLocal();
    setProfile(null);
    setTab('home');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="wallet" /></div>
          <div><strong>نظام استلام المبالغ</strong><span>سريع • محلي • موثوق</span></div>
        </div>
        <nav>{tabs.map((item) => <NavButton key={item.key} active={tab === item.key} icon={item.icon} label={item.label} onClick={() => setTab(item.key)} />)}</nav>
        <div className="sidebar-foot">
          <div className="secure-mini"><Icon name="database"/><span>البيانات محفوظة في هذا المتصفح</span></div>
          <small>الإصدار 3.1 Local First</small>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="date-side"><button className="round-icon muted"><Icon name="sun"/></button><span>{todayLong()}</span></div>
          <div className="top-user-area">
            <button className={`round-icon install-button ${isInstalled ? 'installed' : ''}`} aria-label="تثبيت التطبيق" title={isInstalled ? 'التطبيق مثبت' : 'تثبيت التطبيق'} onClick={installApp}><Icon name="download"/></button>
            <button className="round-icon notify-button" aria-label="الإشعارات"><Icon name="bell"/><b>1</b></button>
            <div className="top-avatar">{profile.display_name.trim().slice(0, 1)}</div>
            <div className="top-user-text"><strong>{profile.display_name}</strong><span>{roleLabel(profile.role)}</span></div>
            <button className="plain-icon" title="تسجيل الخروج" onClick={logout}><Icon name="logout"/></button>
          </div>
        </header>

        <section className="content">
          {tab === 'home' && <HomeDashboard profile={profile} settings={settings} notify={notify} refreshKey={refreshKey} onReceiptCreated={() => setRefreshKey((x) => x + 1)} onOpenSent={() => setTab('sent')} />}
          {tab === 'sent' && <Sent profile={profile} settings={settings} notify={notify} refreshKey={refreshKey} onChanged={() => setRefreshKey((x) => x + 1)} />}
          {tab === 'names' && <Names notify={notify} refreshKey={refreshKey} />}
          {tab === 'reports' && <Reports settings={settings} notify={notify} refreshKey={refreshKey} />}
          {tab === 'settings' && <Settings profile={profile} settings={settings} setSettings={setSettings} notify={notify} onDataChanged={() => setRefreshKey((x) => x + 1)} />}
        </section>
      </main>

      <div className="mobile-nav">{tabs.map((item) => <NavButton key={item.key} active={tab === item.key} icon={item.icon} label={item.label} onClick={() => setTab(item.key)} />)}</div>
      {showInstallHelp && <InstallHelp onClose={() => setShowInstallHelp(false)} />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

function InstallHelp({ onClose }: { onClose: () => void }) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isSamsung = /SamsungBrowser/i.test(ua);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal install-help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="install-help-icon"><Icon name="download"/></div>
        <h3>تثبيت النظام كتطبيق</h3>
        {isIOS ? (
          <p>في Safari اضغط زر المشاركة، ثم اختر <b>إضافة إلى الشاشة الرئيسية</b>، وبعدها اضغط <b>إضافة</b>.</p>
        ) : isSamsung ? (
          <p>إذا لم تظهر نافذة التثبيت تلقائيًا، افتح قائمة متصفح Samsung Internet ثم اختر <b>إضافة الصفحة إلى</b> ← <b>الشاشة الرئيسية</b> أو <b>التطبيقات</b>.</p>
        ) : (
          <p>إذا لم تظهر نافذة التثبيت تلقائيًا، افتح قائمة المتصفح ثم اختر <b>تثبيت التطبيق</b> أو <b>إضافة إلى الشاشة الرئيسية</b>.</p>
        )}
        <div className="modal-actions"><button className="primary-button" onClick={onClose}>حسنًا</button></div>
      </div>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: IconName; label: string; onClick: () => void }) {
  return <button type="button" className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}><Icon name={icon}/><span>{label}</span></button>;
}

function Splash() {
  return <div className="center-screen"><div className="loader"/><p>جاري تشغيل النظام المحلي...</p></div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="center-screen"><div className="empty-icon">!</div><h2>تعذر تشغيل التخزين المحلي</h2><p>{message}</p><button className="primary-button" onClick={onRetry}>إعادة المحاولة</button></div>;
}

function FirstSetup({ onDone, notify }: { onDone: (profile: Profile) => void; notify: (m:string,k?:'ok'|'error') => void }) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErrorText('');
    try {
      const profile = await setupFirstAdmin(displayName, username, password);
      await requestPersistentStorage().catch(() => undefined);
      notify('تم إنشاء حساب المدير وقاعدة البيانات المحلية.');
      onDone(profile);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر إنشاء الحساب.';
      setErrorText(message); notify(message, 'error');
    } finally { setBusy(false); }
  }

  return <div className="login-page">
    <div className="login-glow one"/><div className="login-glow two"/>
    <form className="login-card setup-card" onSubmit={submit}>
      <div className="login-brand"><div className="login-logo"><Icon name="database"/></div><div><h1>إعداد النظام لأول مرة</h1><p>قاعدة البيانات ستُنشأ داخل هذا المتصفح</p></div></div>
      <div className="login-title"><h2>إنشاء حساب المدير</h2><p>لن تُرسل البيانات المالية إلى قاعدة بيانات خارجية. أنشئ حساب الدخول الذي سيظهر اسمه في عبارة «من قبل».</p></div>
      <label>اسم الموظف<input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="مثال: محمد حسن"/></label>
      <label>اسم المستخدم<input required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin"/></label>
      <label>كلمة المرور<input required minLength={6} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6 رموز أو أكثر"/></label>
      {errorText && <div className="login-error">{errorText}</div>}
      <button className="primary-button full login-submit" disabled={busy}>{busy ? 'جاري الإنشاء...' : 'إنشاء النظام والدخول'}</button>
      <div className="login-security"><Icon name="shield"/><span>احتفظ بنسخة احتياطية دورية. مسح بيانات الموقع من المتصفح يؤدي إلى حذف البيانات المحلية.</span></div>
    </form>
  </div>;
}

function Login({ onDone, notify }: { onDone: (profile: Profile) => void; notify: (m:string,k?:'ok'|'error') => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrorText('');
    try {
      const profile = await loginLocal(username, password);
      requestPersistentStorage().catch(() => undefined);
      onDone(profile);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر تسجيل الدخول.';
      setErrorText(message); notify(message, 'error');
    } finally { setBusy(false); }
  }

  return <div className="login-page">
    <div className="login-glow one"/><div className="login-glow two"/>
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand"><div className="login-logo"><Icon name="wallet"/></div><div><h1>نظام استلام المبالغ</h1><p>سريع • محلي • موثوق</p></div></div>
      <div className="login-title"><h2>تسجيل الدخول</h2><p>اسم الموظف في الرسالة يُؤخذ تلقائيًا من حساب الدخول المحلي.</p></div>
      <label>اسم المستخدم<input autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="اسم المستخدم"/></label>
      <label>كلمة المرور<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"/></label>
      {errorText && <div className="login-error">{errorText}</div>}
      <button className="primary-button full login-submit" disabled={busy}>{busy ? 'جاري الدخول...' : 'دخول إلى النظام'}</button>
      <div className="login-security"><Icon name="database"/><span>الأسماء والعمليات والإعدادات محفوظة داخل قاعدة IndexedDB في هذا المتصفح.</span></div>
    </form>
  </div>;
}

function HomeDashboard({ profile, settings, notify, refreshKey, onReceiptCreated, onOpenSent }: {
  profile: Profile;
  settings: AppSettings;
  notify: (m: string, k?: 'ok' | 'error') => void;
  refreshKey: number;
  onReceiptCreated: () => void;
  onOpenSent: () => void;
}) {
  const [dashboard, setDashboard] = useState<DashboardData>({ dailyTotal: 0, dailyCount: 0, namesCount: 0, monthTotal: 0, monthCount: 0, lastAmount: 0, recent: [] });
  const [dashLoading, setDashLoading] = useState(true);

  async function loadDashboard() {
    setDashLoading(true);
    try {
      const { start, end, monthStart, nextMonth } = baghdadDayRange();
      const [receipts, people] = await Promise.all([listReceipts(100000), listPeople('', 100000)]);
      const active = receipts.filter((r) => !r.canceled_at);
      const dailyRows = active.filter((r) => { const t = new Date(r.received_at).getTime(); return t >= start.getTime() && t < end.getTime(); });
      const monthRows = active.filter((r) => { const t = new Date(r.received_at).getTime(); return t >= monthStart.getTime() && t < nextMonth.getTime(); });
      const last = active[0];
      setDashboard({
        dailyTotal: dailyRows.reduce((sum, r) => sum + Number(r.amount || 0), 0),
        dailyCount: dailyRows.length,
        namesCount: people.length,
        monthTotal: monthRows.reduce((sum, r) => sum + Number(r.amount || 0), 0),
        monthCount: monthRows.length,
        lastAmount: Number(last?.amount || 0),
        recent: receipts.slice(0, 10),
      });
    } catch (e) { notify(e instanceof Error ? e.message : 'تعذر تحميل البيانات.', 'error'); }
    finally { setDashLoading(false); }
  }

  useEffect(() => { loadDashboard(); }, [refreshKey]);

  return <div className="dashboard-page">
    <div className="stats-grid">
      <StatCard tone="green" icon="wallet" value={dashLoading ? '—' : formatNumber(dashboard.dailyTotal)} label="إجمالي اليوم" suffix={settings.currency}/>
      <StatCard tone="blue" icon="file" value={dashLoading ? '—' : formatNumber(dashboard.dailyCount)} label="عدد العمليات"/>
      <StatCard tone="orange" icon="users" value={dashLoading ? '—' : formatNumber(dashboard.namesCount)} label="عدد الأسماء"/>
      <StatCard tone="purple" icon="clock" value={dashLoading ? '—' : money(dashboard.lastAmount, settings.currency)} label="آخر عملية"/>
    </div>
    <div className="dashboard-main-grid">
      <ReceiptComposer profile={profile} settings={settings} notify={notify} onReceiptCreated={() => { onReceiptCreated(); loadDashboard(); }}/>
      <RecentTransactions rows={dashboard.recent} settings={settings} onOpenSent={onOpenSent} loading={dashLoading}/>
    </div>
    <div className="summary-grid">
      <div className="summary-card green-summary"><div className="summary-icon"><Icon name="chart"/></div><div><span>إجمالي هذا الشهر</span><strong>{money(dashboard.monthTotal, settings.currency)}</strong></div></div>
      <div className="summary-card blue-summary"><div className="summary-icon"><Icon name="file"/></div><div><span>عدد العمليات هذا الشهر</span><strong>{formatNumber(dashboard.monthCount)}</strong></div></div>
    </div>
  </div>;
}

function StatCard({ tone, icon, value, label, suffix }: { tone: 'green'|'blue'|'orange'|'purple'; icon: IconName; value: string; label: string; suffix?: string }) {
  return <div className={`stat-card ${tone}`}><div className="stat-icon"><Icon name={icon}/></div><div><strong>{value}{suffix && !value.includes(suffix) ? <small> {suffix}</small> : null}</strong><span>{label}</span></div></div>;
}

function ReceiptComposer({ profile, settings, notify, onReceiptCreated }: {
  profile: Profile;
  settings: AppSettings;
  notify: (m: string, k?: 'ok'|'error') => void;
  onReceiptCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<'whatsapp'|'email'|'both'>(settings.send_mode === 'ask' ? 'whatsapp' : settings.send_mode);
  const [suggestions, setSuggestions] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const queryTimer = useRef<number | null>(null);

  useEffect(() => { if (settings.send_mode !== 'ask') setChannel(settings.send_mode); }, [settings.send_mode]);
  useEffect(() => {
    if (queryTimer.current) window.clearTimeout(queryTimer.current);
    if (name.trim().length < 2) { setSuggestions([]); return; }
    queryTimer.current = window.setTimeout(async () => {
      try { setSuggestions(await searchPeople(name.trim(), 7)); setShowSuggestions(true); } catch { setSuggestions([]); }
    }, 150);
    return () => { if (queryTimer.current) window.clearTimeout(queryTimer.current); };
  }, [name]);

  const numericAmount = Number(normalizeDigits(amount));
  const newNameLikely = name.trim().length >= 2 && suggestions.every((p) => normalizeName(p.name) !== normalizeName(name));
  const preview = buildMessage(name, numericAmount, profile.display_name, settings.currency, new Date().toISOString());

  async function submit() {
    if (profile.role === 'viewer') return notify('حسابك مخصص للمشاهدة فقط.', 'error');
    if (name.trim().length < 2) return notify('اكتب الاسم أولاً.', 'error');
    if (!numericAmount || numericAmount <= 0) return notify('أدخل مبلغًا صحيحًا.', 'error');
    if ((channel === 'email' || channel === 'both') && !settings.recipient_email) return notify('حدد بريد المستلم من الإعدادات أولًا.', 'error');
    if ((channel === 'whatsapp' || channel === 'both') && !settings.recipient_whatsapp) return notify('حدد رقم واتساب للمستلم من الإعدادات أولًا.', 'error');

    const whatsappWindow = (channel === 'whatsapp' || channel === 'both') ? window.open('about:blank', '_blank') : null;
    const emailWindow = (channel === 'email' || channel === 'both') ? window.open('about:blank', '_blank') : null;
    setBusy(true);
    try {
      const receipt = await createReceipt(name.trim(), numericAmount, channel, profile);
      setLastReceipt(receipt);
      const text = buildMessage(receipt.person_name, receipt.amount, receipt.created_by_name, settings.currency, receipt.received_at);

      if (channel === 'whatsapp' || channel === 'both') {
        const url = `https://wa.me/${cleanPhone(settings.recipient_whatsapp || '')}?text=${encodeURIComponent(text)}`;
        if (whatsappWindow) whatsappWindow.location.href = url; else window.open(url, '_blank');
        await markDelivery(receipt.id, 'whatsapp');
      }
      if (channel === 'email' || channel === 'both') {
        const subject = `استلام مبلغ - ${receipt.receipt_no}`;
        const url = `mailto:${encodeURIComponent(settings.recipient_email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
        if (emailWindow) emailWindow.location.href = url; else window.location.href = url;
        await markDelivery(receipt.id, 'email');
      }

      setName(''); setAmount(''); setSuggestions([]); setShowSuggestions(false);
      onReceiptCreated();
      notify('تم حفظ العملية محليًا وفتح وسيلة الإرسال.');
    } catch (e) {
      whatsappWindow?.close(); emailWindow?.close();
      notify(e instanceof Error ? e.message : 'تعذر تسجيل العملية.', 'error');
    } finally { setBusy(false); }
  }

  async function copyPreview() {
    try { await navigator.clipboard.writeText(preview); notify('تم نسخ نص الرسالة.'); }
    catch { notify('تعذر نسخ النص.', 'error'); }
  }

  return <section className="panel receipt-workspace">
    <div className="panel-title"><h2>استلام مبلغ جديد</h2><div className="title-icon"><Icon name="wallet"/></div></div>
    <div className="composer-body">
      <div className="field-wrap name-field-wrap">
        <label>الاسم</label>
        <div className="input-with-leading-icon"><input autoComplete="off" value={name} onFocus={() => name.trim().length >= 2 && setShowSuggestions(true)} onChange={(e) => setName(e.target.value)} placeholder="اكتب الاسم"/><Icon name="search"/></div>
        {showSuggestions && name.trim().length >= 2 && <div className="suggestions">
          {suggestions.map((p) => <button type="button" key={p.id} onClick={() => { setName(p.name); setShowSuggestions(false); }}>{p.name}<span>محفوظ</span></button>)}
          {newNameLikely && <div className="new-name-hint"><span>＋</span><b>سيتم إضافة الاسم تلقائيًا <em>(اسم جديد)</em></b></div>}
        </div>}
      </div>
      <div className="field-wrap">
        <label>المبلغ المستلم ({settings.currency})</label>
        <div className="simple-amount"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(normalizeDigits(e.target.value))} placeholder="0"/></div>
        <div className="quick-amounts">{settings.quick_amounts.map((q) => <button type="button" key={q} className={numericAmount === q ? 'selected' : ''} onClick={() => setAmount(String(q))}>{formatNumber(q)}</button>)}</div>
      </div>
      <div className="field-wrap">
        <label>طريقة الإرسال</label>
        <div className={`channel-options ${settings.send_mode !== 'ask' ? 'locked' : ''}`}>
          {(['whatsapp','email','both'] as const).map((value) => <button type="button" key={value} disabled={settings.send_mode !== 'ask'} className={channel === value ? 'selected' : ''} onClick={() => setChannel(value)}>
            <span className="radio-dot"/>{value === 'whatsapp' && <Icon name="whatsapp"/>}{value === 'email' && <Icon name="mail"/>}{value === 'both' && <span className="double-channel"><Icon name="whatsapp"/><Icon name="mail"/></span>}<b>{channelLabel(value)}</b>
          </button>)}
        </div>
        {settings.send_mode !== 'ask' && <small className="mode-hint">طريقة الإرسال محددة من الإعدادات.</small>}
      </div>
      <div className="message-box">
        <div className="message-box-head"><strong>معاينة الرسالة</strong><button type="button" title="نسخ" onClick={copyPreview}><Icon name="copy"/></button></div>
        <div className="message-text">{preview.split('\n').map((line, i) => <div key={i}>{line || <br/>}</div>)}</div>
      </div>
      <button className="primary-button send-button" type="button" onClick={submit} disabled={busy}><Icon name="send"/>{busy ? 'جاري التسجيل...' : 'إرسال وتسجيل'}</button>
      {lastReceipt && <div className="last-success"><span>✓</span><div><b>تم حفظ آخر عملية داخل المتصفح</b><small>{lastReceipt.receipt_no} — {lastReceipt.person_name}</small></div></div>}
    </div>
  </section>;
}

function buildMessage(name: string, amount: number, employee: string, currency: string, iso: string) {
  const { date, time } = localDateTime(iso);
  return `تم استلام مبلغ ${amount ? money(amount, currency) : '—'}\nمن ${name.trim() || '—'}\nبتاريخ ${date}\nالساعة ${time}\nمن قبل ${employee}`;
}

function RecentTransactions({ rows, settings, onOpenSent, loading }: { rows: Receipt[]; settings: AppSettings; onOpenSent: () => void; loading: boolean }) {
  return <section className="panel recent-panel">
    <div className="panel-title table-title"><h2>آخر العمليات المرسلة</h2><div className="title-icon"><Icon name="file"/></div><button type="button" className="outline-small" onClick={onOpenSent}>عرض الكل</button></div>
    <div className="table-scroll"><table className="dashboard-table"><thead><tr><th>#</th><th>الاسم</th><th>المبلغ</th><th>التاريخ والوقت</th><th>طريقة الإرسال</th><th>الحالة</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={6} className="empty-cell">جاري التحميل...</td></tr> : rows.length === 0 ? <tr><td colSpan={6} className="empty-cell">لا توجد عمليات بعد.</td></tr> : rows.map((r) => { const dt = localDateTime(r.received_at); return <tr key={r.id} className={r.canceled_at ? 'canceled-row' : ''}><td className="receipt-code">{r.receipt_no}</td><td>{r.person_name}</td><td className="amount-cell">{formatNumber(r.amount)}</td><td><div>{dt.date}</div><small>{dt.time}</small></td><td><ChannelDisplay channel={r.send_channel}/></td><td>{r.canceled_at ? <span className="status canceled">ملغي</span> : <span className="status ok">تم</span>}</td></tr>; })}
    </tbody></table></div>
  </section>;
}

function ChannelDisplay({ channel }: { channel: Receipt['send_channel'] }) {
  return <span className="channel-display">{channel === 'whatsapp' ? <Icon name="whatsapp"/> : channel === 'email' ? <Icon name="mail"/> : <span className="double-channel"><Icon name="whatsapp"/><Icon name="mail"/></span>}<span>{channelLabel(channel)}</span></span>;
}

function Sent({ profile, settings, notify, refreshKey, onChanged }: { profile: Profile; settings: AppSettings; notify: (m:string,k?:'ok'|'error') => void; refreshKey: number; onChanged: () => void }) {
  const [rows, setRows] = useState<Receipt[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function load() {
    setLoading(true);
    try { setRows(await listReceipts(5000)); }
    catch (e) { notify(e instanceof Error ? e.message : 'تعذر تحميل سجل المرسلة.', 'error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.person_name, r.receipt_no, r.created_by_name, String(r.amount)].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [rows, search]);

  async function cancel() {
    if (!cancelId) return;
    try {
      await cancelReceipt(cancelId, reason, profile);
      setCancelId(null); setReason(''); notify('تم إلغاء العملية مع حفظ السبب محليًا.'); onChanged(); load();
    } catch (e) { notify(e instanceof Error ? e.message : 'تعذر إلغاء العملية.', 'error'); }
  }

  return <section className="panel full-page-panel">
    <div className="page-heading"><div><h1>العمليات المرسلة</h1><p>سجل دائم داخل المتصفح لجميع عمليات الاستلام والإلغاء</p></div><div className="input-with-leading-icon compact"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو المبلغ أو رقم العملية"/><Icon name="search"/></div></div>
    <div className="table-scroll sent-table-wrap"><table className="dashboard-table wide-table"><thead><tr><th>#</th><th>الاسم</th><th>المبلغ</th><th>التاريخ والوقت</th><th>من قبل</th><th>طريقة الإرسال</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={8} className="empty-cell">جاري التحميل...</td></tr> : filtered.length === 0 ? <tr><td colSpan={8} className="empty-cell">لا توجد نتائج.</td></tr> : filtered.map((r) => { const dt = localDateTime(r.received_at); return <tr key={r.id} className={r.canceled_at ? 'canceled-row' : ''}><td className="receipt-code">{r.receipt_no}</td><td>{r.person_name}</td><td className="amount-cell">{money(r.amount, settings.currency)}</td><td><div>{dt.date}</div><small>{dt.time}</small></td><td>{r.created_by_name}</td><td><ChannelDisplay channel={r.send_channel}/></td><td>{r.canceled_at ? <span className="status canceled" title={r.cancel_reason || ''}>ملغي</span> : <span className="status ok">تم</span>}</td><td>{!r.canceled_at && (profile.role === 'admin' || r.created_by === profile.id) ? <button type="button" className="danger-ghost" onClick={() => setCancelId(r.id)}><Icon name="cancel"/>إلغاء</button> : <span className="muted-dash">—</span>}</td></tr>; })}
    </tbody></table></div>
    {cancelId && <div className="modal-backdrop" onMouseDown={() => setCancelId(null)}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-icon"><Icon name="cancel"/></div><h3>إلغاء العملية</h3><p>لن يتم حذف العملية. سيُحفظ سبب الإلغاء واسم المستخدم والتاريخ والوقت داخل قاعدة البيانات المحلية.</p><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اكتب سبب الإلغاء..." rows={4}/><div className="modal-actions"><button className="secondary-button" onClick={() => { setCancelId(null); setReason(''); }}>رجوع</button><button className="danger-button" onClick={cancel}>تأكيد الإلغاء</button></div></div></div>}
  </section>;
}

function Names({ notify, refreshKey }: { notify: (m:string,k?:'ok'|'error') => void; refreshKey: number }) {
  const [rows, setRows] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function load(q = '') {
    setLoading(true);
    try { setRows(await listPeople(q, 5000)); }
    catch (e) { notify(e instanceof Error ? e.message : 'تعذر تحميل الأسماء.', 'error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(search); }, [refreshKey]);
  useEffect(() => { const t = window.setTimeout(() => load(search), 160); return () => window.clearTimeout(t); }, [search]);

  async function importFile(file: File) {
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
      const names = data.flatMap((row) => row.slice(0, 1)).map((v) => String(v ?? '').trim()).filter((v) => v.length >= 2).slice(0, 10000);
      if (!names.length) return notify('لم يتم العثور على أسماء في العمود الأول.', 'error');
      const count = await importPeople(names);
      notify(`تم استيراد ${count} اسم جديد إلى هذا المتصفح.`); load(search);
    } catch (e) { notify(e instanceof Error ? e.message : 'تعذر قراءة الملف.', 'error'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  }

  return <section className="panel full-page-panel">
    <div className="page-heading"><div><h1>قاعدة الأسماء</h1><p>تُضاف الأسماء الجديدة تلقائيًا عند تسجيل أول عملية لها</p></div><div className="page-actions"><div className="input-with-leading-icon compact"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم"/><Icon name="search"/></div><input ref={fileRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}/><button className="secondary-button" onClick={() => fileRef.current?.click()}><Icon name="upload"/>استيراد ملف</button></div></div>
    <div className="auto-name-note"><span>＋</span><div><b>لا تحتاج إلى إضافة الأسماء يدويًا</b><small>اكتب أي اسم في الصفحة الرئيسية، وإذا لم يكن موجودًا فسيُحفظ تلقائيًا في IndexedDB عند تسجيل العملية.</small></div></div>
    {loading ? <div className="empty-cell block-empty">جاري التحميل...</div> : <div className="names-grid">{rows.map((p, i) => <div className="name-card" key={p.id}><span>{i + 1}</span><strong>{p.name}</strong></div>)}</div>}
  </section>;
}

function Reports({ settings, notify, refreshKey }: { settings: AppSettings; notify: (m:string,k?:'ok'|'error') => void; refreshKey: number }) {
  const [rows, setRows] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { monthStart, nextMonth } = baghdadDayRange();
        const receipts = await listReceipts(100000);
        setRows(receipts.filter((r) => { const t = new Date(r.received_at).getTime(); return t >= monthStart.getTime() && t < nextMonth.getTime(); }));
      } catch (e) { notify(e instanceof Error ? e.message : 'تعذر تحميل التقرير.', 'error'); }
      finally { setLoading(false); }
    })();
  }, [refreshKey]);

  const active = rows.filter((r) => !r.canceled_at);
  const total = active.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const canceled = rows.filter((r) => r.canceled_at).length;
  const whatsappCount = active.filter((r) => r.send_channel === 'whatsapp' || r.send_channel === 'both').length;
  const emailCount = active.filter((r) => r.send_channel === 'email' || r.send_channel === 'both').length;
  const byEmployee = Object.entries(active.reduce<Record<string, { count:number; total:number }>>((acc, r) => {
    const key = r.created_by_name || 'غير معروف';
    acc[key] ||= { count: 0, total: 0 };
    acc[key].count += 1; acc[key].total += Number(r.amount || 0); return acc;
  }, {})) as [string, { count:number; total:number }][];
  byEmployee.sort((a, b) => b[1].total - a[1].total);

  return <div className="reports-page">
    <div className="page-heading report-heading"><div><h1>التقارير</h1><p>ملخص الشهر الحالي من قاعدة البيانات المحلية</p></div></div>
    <div className="report-cards">
      <StatCard tone="green" icon="wallet" value={loading ? '—' : money(total, settings.currency)} label="إجمالي المقبوضات"/>
      <StatCard tone="blue" icon="file" value={loading ? '—' : formatNumber(active.length)} label="العمليات المكتملة"/>
      <StatCard tone="orange" icon="cancel" value={loading ? '—' : formatNumber(canceled)} label="العمليات الملغاة"/>
      <StatCard tone="purple" icon="sent" value={loading ? '—' : formatNumber(whatsappCount + emailCount)} label="قنوات الإرسال المستخدمة"/>
    </div>
    <div className="reports-grid">
      <section className="panel report-panel"><div className="panel-title"><h2>حسب الموظف</h2><div className="title-icon"><Icon name="users"/></div></div>{loading ? <div className="empty-cell block-empty">جاري التحميل...</div> : byEmployee.length === 0 ? <div className="empty-cell block-empty">لا توجد بيانات.</div> : <div className="employee-report-list">{byEmployee.map(([name, v], i) => <div className="employee-report-row" key={name}><span className="rank">{i + 1}</span><div className="employee-report-name"><b>{name}</b><small>{v.count} عملية</small></div><strong>{money(v.total, settings.currency)}</strong></div>)}</div>}</section>
      <section className="panel report-panel"><div className="panel-title"><h2>قنوات الإرسال</h2><div className="title-icon"><Icon name="sent"/></div></div><div className="channel-report"><div><span className="channel-report-icon whatsapp"><Icon name="whatsapp"/></span><div><b>واتساب</b><small>يتضمن العمليات المرسلة بالاثنين</small></div><strong>{whatsappCount}</strong></div><div><span className="channel-report-icon email"><Icon name="mail"/></span><div><b>البريد الإلكتروني</b><small>يتضمن العمليات المرسلة بالاثنين</small></div><strong>{emailCount}</strong></div></div></section>
    </div>
  </div>;
}

type StorageView = { persisted: boolean | null; usage: number | null; quota: number | null; lastSnapshotAt: string | null; snapshotCount: number };
type UserView = { id: string; username: string; display_name: string; role: Role; active: boolean };

function Settings({ profile, settings, setSettings, notify, onDataChanged }: {
  profile: Profile;
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  notify: (m:string,k?:'ok'|'error') => void;
  onDataChanged: () => void;
}) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<StorageView>({ persisted: null, usage: null, quota: null, lastSnapshotAt: null, snapshotCount: 0 });
  const [users, setUsers] = useState<UserView[]>([]);
  const [userForm, setUserForm] = useState({ displayName: '', username: '', password: '', role: 'staff' as Role });
  const backupInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => setDraft(settings), [settings]);
  const canEdit = profile.role === 'admin';

  async function loadLocalInfo() {
    const [s, b, u] = await Promise.all([getStorageInfo(), getBackupInfo(), listUsers()]);
    setStorage({ ...s, ...b }); setUsers(u);
  }
  useEffect(() => { loadLocalInfo().catch(() => undefined); }, []);

  async function save() {
    if (!canEdit) return notify('الإعدادات متاحة للمدير فقط.', 'error');
    setBusy(true);
    try {
      const saved = await saveSettings(draft, profile);
      setSettings(saved); notify('تم حفظ الإعدادات داخل المتصفح.');
    } catch (e) { notify(e instanceof Error ? e.message : 'تعذر حفظ الإعدادات.', 'error'); }
    finally { setBusy(false); }
  }

  function updateQuick(index: number, value: string) {
    const next = [...draft.quick_amounts]; next[index] = Math.max(0, Number(normalizeDigits(value))); setDraft({ ...draft, quick_amounts: next });
  }

  async function makePersistent() {
    try { const info = await requestPersistentStorage(); const backup = await getBackupInfo(); setStorage({ ...info, ...backup }); notify(info.persisted ? 'تم طلب التخزين الدائم ووافق المتصفح.' : 'المتصفح لم يمنح التخزين الدائم حاليًا.', info.persisted ? 'ok' : 'error'); }
    catch { notify('تعذر طلب التخزين الدائم.', 'error'); }
  }

  async function localSnapshot() {
    try { await createLocalSnapshot(); await loadLocalInfo(); notify('تم إنشاء نسخة احتياطية محلية داخل المتصفح.'); }
    catch (e) { notify(e instanceof Error ? e.message : 'تعذر إنشاء النسخة.', 'error'); }
  }

  async function downloadBackup() {
    try {
      const payload = await exportBackup();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());
      a.href = url; a.download = `receipt-backup-${date}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      notify('تم تجهيز النسخة الاحتياطية للتنزيل.');
    } catch (e) { notify(e instanceof Error ? e.message : 'تعذر تصدير النسخة.', 'error'); }
  }

  async function restoreFromFile(file: File) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!window.confirm('سيتم استبدال البيانات المحلية الحالية بالنسخة المختارة. هل تريد المتابعة؟')) return;
      await restoreBackup(payload);
      notify('تمت الاستعادة. سيتم إعادة تحميل النظام.');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (e) { notify(e instanceof Error ? e.message : 'تعذر استعادة النسخة.', 'error'); }
    finally { if (backupInput.current) backupInput.current.value = ''; }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createLocalUser(userForm.displayName, userForm.username, userForm.password, userForm.role, profile);
      setUserForm({ displayName: '', username: '', password: '', role: 'staff' });
      await loadLocalInfo(); notify('تمت إضافة المستخدم المحلي.');
    } catch (e) { notify(e instanceof Error ? e.message : 'تعذر إضافة المستخدم.', 'error'); }
  }

  const lastBackupLabel = storage.lastSnapshotAt ? `${localDateTime(storage.lastSnapshotAt).date} - ${localDateTime(storage.lastSnapshotAt).time}` : 'لا توجد نسخة بعد';

  return <div className="settings-page">
    <div className="page-heading"><div><h1>الإعدادات</h1><p>الإرسال، المبالغ السريعة، التخزين المحلي، النسخ الاحتياطي والمستخدمون</p></div>{!canEdit && <span className="readonly-badge">عرض فقط</span>}</div>
    <div className="settings-grid">
      <section className="panel settings-card"><div className="panel-title"><h2>إعدادات الإرسال</h2><div className="title-icon"><Icon name="sent"/></div></div>
        <label className="settings-field">بريد المستلم<input disabled={!canEdit} type="email" value={draft.recipient_email || ''} onChange={(e) => setDraft({ ...draft, recipient_email: e.target.value })} placeholder="receiver@example.com"/><small>عند الإرسال يفتح النظام تطبيق البريد الافتراضي والنص جاهزًا.</small></label>
        <label className="settings-field">رقم واتساب<input disabled={!canEdit} inputMode="tel" value={draft.recipient_whatsapp || ''} onChange={(e) => setDraft({ ...draft, recipient_whatsapp: e.target.value })} placeholder="9647XXXXXXXXX"/><small>اكتب الرقم مع رمز الدولة من دون علامة +.</small></label>
        <label className="settings-field">طريقة الإرسال الافتراضية<select disabled={!canEdit} value={draft.send_mode} onChange={(e) => setDraft({ ...draft, send_mode: e.target.value as AppSettings['send_mode'] })}><option value="ask">اختيار عند كل عملية</option><option value="whatsapp">واتساب</option><option value="email">البريد الإلكتروني</option><option value="both">الاثنان معًا</option></select></label>
        <label className="settings-field">العملة<input disabled={!canEdit} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}/></label>
        {canEdit && <button className="primary-button full" disabled={busy} onClick={save}>{busy ? 'جاري الحفظ...' : 'حفظ الإعدادات'}</button>}
      </section>

      <section className="panel settings-card"><div className="panel-title"><h2>المبالغ السريعة</h2><div className="title-icon"><Icon name="wallet"/></div></div>
        <p className="settings-note">تظهر هذه الأرقام كأزرار مباشرة أسفل خانة المبلغ.</p>
        <div className="quick-settings">{draft.quick_amounts.map((q, i) => <label key={i}>مبلغ {i + 1}<input disabled={!canEdit} inputMode="numeric" value={q || ''} onChange={(e) => updateQuick(i, e.target.value)}/></label>)}</div>
        <div className="security-note"><Icon name="shield"/><div><strong>حماية السجل المالي</strong><span>لا يوجد حذف نهائي للعمليات. الإلغاء يحتاج سببًا ويبقى محفوظًا في قاعدة المتصفح.</span></div></div>
      </section>

      <section className="panel settings-card local-storage-card"><div className="panel-title"><h2>البيانات والنسخ الاحتياطي</h2><div className="title-icon"><Icon name="database"/></div></div>
        <div className="storage-status-grid">
          <div><span>مكان الحفظ</span><strong>هذا المتصفح / IndexedDB</strong></div>
          <div><span>التخزين الدائم</span><strong className={storage.persisted ? 'good-text' : 'warn-text'}>{storage.persisted === null ? 'غير معروف' : storage.persisted ? 'مفعّل' : 'غير مفعّل'}</strong></div>
          <div><span>المساحة المستخدمة</span><strong>{formatBytes(storage.usage)}</strong></div>
          <div><span>آخر نسخة محلية</span><strong>{lastBackupLabel}</strong></div>
          <div><span>عدد النسخ المحلية</span><strong>{storage.snapshotCount}</strong></div>
          <div><span>السعة المتاحة</span><strong>{formatBytes(storage.quota)}</strong></div>
        </div>
        <div className="backup-actions">
          <button className="secondary-button" onClick={makePersistent}><Icon name="shield"/>طلب التخزين الدائم</button>
          <button className="secondary-button" onClick={localSnapshot}><Icon name="database"/>نسخة محلية الآن</button>
          <button className="primary-button" onClick={downloadBackup}><Icon name="download"/>تنزيل نسخة JSON</button>
          <input ref={backupInput} hidden type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && restoreFromFile(e.target.files[0])}/>
          <button className="secondary-button" onClick={() => backupInput.current?.click()}><Icon name="restore"/>استعادة نسخة</button>
        </div>
        <div className="local-warning"><Icon name="shield"/><span>النسخ المحلية التلقائية تُحفظ داخل نفس المتصفح، لذلك لا تكفي وحدها إذا تم مسح بيانات الموقع. نزّل نسخة JSON دورية واحتفظ بها خارج الجهاز.</span></div>
      </section>

      <section className="panel settings-card"><div className="panel-title"><h2>المستخدمون المحليون</h2><div className="title-icon"><Icon name="users"/></div></div>
        {canEdit ? <>
          <form className="local-user-form" onSubmit={addUser}>
            <input required value={userForm.displayName} onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })} placeholder="اسم الموظف"/>
            <input required value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} placeholder="اسم المستخدم"/>
            <input required minLength={6} type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} placeholder="كلمة المرور"/>
            <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value as Role })}><option value="staff">موظف</option><option value="viewer">مشاهدة فقط</option><option value="admin">مدير</option></select>
            <button className="primary-button"><Icon name="userplus"/>إضافة مستخدم</button>
          </form>
          <div className="local-users-list">{users.map((u) => <div key={u.id}><span className="user-list-avatar">{u.display_name.slice(0,1)}</span><div><b>{u.display_name}</b><small>{u.username} • {roleLabel(u.role)}</small></div>{u.id === profile.id && <em>الحالي</em>}</div>)}</div>
        </> : <p className="settings-note">إدارة المستخدمين متاحة للمدير فقط.</p>}
      </section>
    </div>
  </div>;
}
