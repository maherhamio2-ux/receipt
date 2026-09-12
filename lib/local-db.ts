export type Role = 'admin' | 'staff' | 'viewer';

export type Profile = {
  id: string;
  display_name: string;
  role: Role;
};

export type LocalUser = Profile & {
  username: string;
  username_key: string;
  password_hash: string;
  salt: string;
  created_at: string;
  active: boolean;
};

export type AppSettings = {
  id: number;
  recipient_email: string | null;
  recipient_whatsapp: string | null;
  send_mode: 'whatsapp' | 'email' | 'both' | 'ask';
  currency: string;
  quick_amounts: number[];
  updated_at?: string;
  updated_by?: string;
};

export type Person = { id: string; name: string; name_key: string; created_at: string };

export type Receipt = {
  id: string;
  receipt_no: string;
  person_name: string;
  person_key: string;
  amount: number;
  received_at: string;
  created_by: string;
  created_by_name: string;
  send_channel: 'whatsapp' | 'email' | 'both';
  send_status: 'recorded' | 'sent' | 'partial' | 'failed';
  whatsapp_opened_at?: string | null;
  email_sent_at?: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  canceled_by_name: string | null;
  cancel_reason: string | null;
};

export type BackupPayload = {
  format: 'receipt-dispatcher-local-backup';
  version: 1;
  exported_at: string;
  data: {
    people: Person[];
    receipts: Receipt[];
    settings: AppSettings[];
    users: LocalUser[];
    audit: AuditEntry[];
    meta: MetaEntry[];
  };
};

export type StorageInfo = {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
};

type AuditEntry = {
  id: string;
  at: string;
  action: 'receipt_created' | 'receipt_canceled' | 'settings_updated' | 'user_created' | 'restore';
  by: string;
  by_name: string;
  target_id?: string;
  details?: string;
};

type MetaEntry = { key: string; value: unknown };
type LocalSnapshot = { id: string; created_at: string; payload: BackupPayload };

const DB_NAME = 'receipt-dispatcher-local-v1';
const DB_VERSION = 1;
const SESSION_KEY = 'receipt-dispatcher-current-user';
const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  recipient_email: null,
  recipient_whatsapp: null,
  send_mode: 'ask',
  currency: 'د.ع',
  quick_amounts: [10000, 25000, 50000, 100000],
};

let dbPromise: Promise<IDBDatabase> | null = null;

function id(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function normalizeName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .toLocaleLowerCase('ar-IQ');
}

function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}

function openDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') return Promise.reject(new Error('قاعدة البيانات المحلية متاحة داخل المتصفح فقط.'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('تعذر فتح قاعدة البيانات المحلية.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('people')) {
        const store = db.createObjectStore('people', { keyPath: 'id' });
        store.createIndex('name_key', 'name_key', { unique: true });
        store.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains('receipts')) {
        const store = db.createObjectStore('receipts', { keyPath: 'id' });
        store.createIndex('received_at', 'received_at');
        store.createIndex('person_key', 'person_key');
        store.createIndex('created_by', 'created_by');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('users')) {
        const store = db.createObjectStore('users', { keyPath: 'id' });
        store.createIndex('username_key', 'username_key', { unique: true });
      }
      if (!db.objectStoreNames.contains('audit')) {
        const store = db.createObjectStore('audit', { keyPath: 'id' });
        store.createIndex('at', 'at');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('backups')) {
        const store = db.createObjectStore('backups', { keyPath: 'id' });
        store.createIndex('created_at', 'created_at');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
  return dbPromise;
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('خطأ في قاعدة البيانات المحلية.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('فشلت العملية المحلية.'));
    tx.onabort = () => reject(tx.error || new Error('تم إلغاء العملية المحلية.'));
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hashPassword(password: string, saltBase64: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: base64ToBytes(saltBase64),
    iterations: 150000,
  }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function makePassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltBase64 = bytesToBase64(salt);
  return { salt: saltBase64, hash: await hashPassword(password, saltBase64) };
}

async function addAudit(entry: Omit<AuditEntry, 'id' | 'at'>, transaction?: IDBTransaction) {
  const db = await openDb();
  const tx = transaction || db.transaction('audit', 'readwrite');
  tx.objectStore('audit').put({ ...entry, id: id('audit'), at: new Date().toISOString() });
  if (!transaction) await txDone(tx);
}

export async function initLocalApp() {
  const db = await openDb();
  const [settings, userCount] = await Promise.all([
    req(db.transaction('settings', 'readonly').objectStore('settings').get(1)) as Promise<AppSettings | undefined>,
    req(db.transaction('users', 'readonly').objectStore('users').count()),
  ]);
  if (!settings) {
    const tx = db.transaction('settings', 'readwrite');
    const done = txDone(tx);
    tx.objectStore('settings').put(DEFAULT_SETTINGS);
    await done;
  }
  if (userCount > 0) await maybeCreateDailySnapshot().catch(() => undefined);
  return {
    needsSetup: userCount === 0,
    profile: await getCurrentProfile(),
    settings: settings || DEFAULT_SETTINGS,
  };
}

export async function setupFirstAdmin(displayName: string, username: string, password: string): Promise<Profile> {
  const db = await openDb();
  const existing = await req(db.transaction('users', 'readonly').objectStore('users').count());
  if (existing > 0) throw new Error('تم إنشاء حساب المدير مسبقًا.');
  if (displayName.trim().length < 2) throw new Error('اكتب اسم الموظف بوضوح.');
  if (username.trim().length < 3) throw new Error('اسم المستخدم يجب أن يكون 3 أحرف على الأقل.');
  if (password.length < 6) throw new Error('كلمة المرور يجب أن تكون 6 رموز على الأقل.');
  const pwd = await makePassword(password);
  const user: LocalUser = {
    id: id('user'),
    display_name: displayName.trim(),
    role: 'admin',
    username: username.trim(),
    username_key: normalizeUsername(username),
    password_hash: pwd.hash,
    salt: pwd.salt,
    created_at: new Date().toISOString(),
    active: true,
  };
  const tx = db.transaction(['users', 'audit'], 'readwrite');
  const done = txDone(tx);
  tx.objectStore('users').add(user);
  tx.objectStore('audit').add({ id: id('audit'), at: new Date().toISOString(), action: 'user_created', by: user.id, by_name: user.display_name, target_id: user.id, details: 'إنشاء أول حساب مدير' } satisfies AuditEntry);
  await done;
  localStorage.setItem(SESSION_KEY, user.id);
  return { id: user.id, display_name: user.display_name, role: user.role };
}

export async function loginLocal(username: string, password: string): Promise<Profile> {
  const db = await openDb();
  const index = db.transaction('users', 'readonly').objectStore('users').index('username_key');
  const user = await req(index.get(normalizeUsername(username))) as LocalUser | undefined;
  if (!user || !user.active) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.password_hash) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
  localStorage.setItem(SESSION_KEY, user.id);
  return { id: user.id, display_name: user.display_name, role: user.role };
}

export function logoutLocal() {
  localStorage.removeItem(SESSION_KEY);
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const userId = localStorage.getItem(SESSION_KEY);
  if (!userId) return null;
  const db = await openDb();
  const user = await req(db.transaction('users', 'readonly').objectStore('users').get(userId)) as LocalUser | undefined;
  if (!user || !user.active) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  return { id: user.id, display_name: user.display_name, role: user.role };
}

export async function getSettings(): Promise<AppSettings> {
  const db = await openDb();
  return (await req(db.transaction('settings', 'readonly').objectStore('settings').get(1)) as AppSettings | undefined) || DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings, profile: Profile): Promise<AppSettings> {
  if (profile.role !== 'admin') throw new Error('الإعدادات متاحة للمدير فقط.');
  const next: AppSettings = {
    ...settings,
    id: 1,
    recipient_email: settings.recipient_email?.trim() || null,
    recipient_whatsapp: settings.recipient_whatsapp?.trim() || null,
    currency: settings.currency.trim() || 'د.ع',
    quick_amounts: settings.quick_amounts.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 8),
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  };
  const db = await openDb();
  const tx = db.transaction(['settings', 'audit'], 'readwrite');
  const done = txDone(tx);
  tx.objectStore('settings').put(next);
  tx.objectStore('audit').add({ id: id('audit'), at: new Date().toISOString(), action: 'settings_updated', by: profile.id, by_name: profile.display_name, details: 'تحديث إعدادات النظام' } satisfies AuditEntry);
  await done;
  return next;
}

export async function searchPeople(query: string, limit = 20): Promise<Person[]> {
  const q = normalizeName(query);
  if (!q) return [];
  const db = await openDb();
  const rows = await req(db.transaction('people', 'readonly').objectStore('people').getAll()) as Person[];
  return rows.filter((p) => p.name_key.includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, limit);
}

export async function listPeople(query = '', limit = 5000): Promise<Person[]> {
  const db = await openDb();
  const rows = await req(db.transaction('people', 'readonly').objectStore('people').getAll()) as Person[];
  const q = normalizeName(query);
  return rows.filter((p) => !q || p.name_key.includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, limit);
}

function baghdadDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}`;
}

export async function createReceipt(personName: string, amount: number, channel: Receipt['send_channel'], profile: Profile): Promise<Receipt> {
  if (profile.role === 'viewer') throw new Error('حسابك مخصص للمشاهدة فقط.');
  const cleanName = personName.trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2) throw new Error('اكتب الاسم أولاً.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('أدخل مبلغًا صحيحًا.');
  const personKey = normalizeName(cleanName);
  const now = new Date().toISOString();
  const dayKey = baghdadDateKey();
  const metaKey = `counter:${dayKey}`;
  const db = await openDb();
  const existing = await req(db.transaction('people', 'readonly').objectStore('people').index('name_key').get(personKey)) as Person | undefined;
  const counterRow = await req(db.transaction('meta', 'readonly').objectStore('meta').get(metaKey)) as MetaEntry | undefined;
  const counter = Number(counterRow?.value || 0) + 1;
  const receipt: Receipt = {
    id: id('receipt'),
    receipt_no: `REC-${dayKey}-${String(counter).padStart(6, '0')}`,
    person_name: cleanName,
    person_key: personKey,
    amount,
    received_at: now,
    created_by: profile.id,
    created_by_name: profile.display_name,
    send_channel: channel,
    send_status: 'recorded',
    whatsapp_opened_at: null,
    email_sent_at: null,
    canceled_at: null,
    canceled_by: null,
    canceled_by_name: null,
    cancel_reason: null,
  };
  const tx = db.transaction(['people', 'receipts', 'meta', 'audit'], 'readwrite');
  const done = txDone(tx);
  if (!existing) tx.objectStore('people').add({ id: id('person'), name: cleanName, name_key: personKey, created_at: now } satisfies Person);
  tx.objectStore('meta').put({ key: metaKey, value: counter } satisfies MetaEntry);
  tx.objectStore('receipts').add(receipt);
  tx.objectStore('audit').add({ id: id('audit'), at: now, action: 'receipt_created', by: profile.id, by_name: profile.display_name, target_id: receipt.id, details: `${receipt.receipt_no} | ${cleanName} | ${amount}` } satisfies AuditEntry);
  await done;
  return receipt;
}

export async function markDelivery(receiptId: string, kind: 'whatsapp' | 'email') {
  const db = await openDb();
  const receipt = await req(db.transaction('receipts', 'readonly').objectStore('receipts').get(receiptId)) as Receipt | undefined;
  if (!receipt) throw new Error('لم يتم العثور على العملية.');
  const now = new Date().toISOString();
  if (kind === 'whatsapp') receipt.whatsapp_opened_at = now;
  if (kind === 'email') receipt.email_sent_at = now;
  const needsWhatsApp = receipt.send_channel === 'whatsapp' || receipt.send_channel === 'both';
  const needsEmail = receipt.send_channel === 'email' || receipt.send_channel === 'both';
  const whatsappOk = !needsWhatsApp || !!receipt.whatsapp_opened_at;
  const emailOk = !needsEmail || !!receipt.email_sent_at;
  receipt.send_status = whatsappOk && emailOk ? 'sent' : 'partial';
  const tx = db.transaction('receipts', 'readwrite');
  const done = txDone(tx);
  tx.objectStore('receipts').put(receipt);
  await done;
}

export async function listReceipts(limit = 500): Promise<Receipt[]> {
  const db = await openDb();
  const rows = await req(db.transaction('receipts', 'readonly').objectStore('receipts').getAll()) as Receipt[];
  return rows.sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, limit);
}

export async function receiptsBetween(start: Date, end: Date): Promise<Receipt[]> {
  const rows = await listReceipts(Number.MAX_SAFE_INTEGER);
  const startMs = start.getTime();
  const endMs = end.getTime();
  return rows.filter((r) => {
    const t = new Date(r.received_at).getTime();
    return t >= startMs && t < endMs;
  });
}

export async function cancelReceipt(receiptId: string, reason: string, profile: Profile) {
  if (reason.trim().length < 3) throw new Error('اكتب سبب الإلغاء بوضوح.');
  const db = await openDb();
  const receipt = await req(db.transaction('receipts', 'readonly').objectStore('receipts').get(receiptId)) as Receipt | undefined;
  if (!receipt) throw new Error('العملية غير موجودة.');
  if (receipt.canceled_at) throw new Error('العملية ملغاة مسبقًا.');
  if (profile.role !== 'admin' && receipt.created_by !== profile.id) throw new Error('لا تملك صلاحية إلغاء هذه العملية.');
  const now = new Date().toISOString();
  receipt.canceled_at = now;
  receipt.canceled_by = profile.id;
  receipt.canceled_by_name = profile.display_name;
  receipt.cancel_reason = reason.trim();
  const tx = db.transaction(['receipts', 'audit'], 'readwrite');
  const done = txDone(tx);
  tx.objectStore('receipts').put(receipt);
  tx.objectStore('audit').add({ id: id('audit'), at: now, action: 'receipt_canceled', by: profile.id, by_name: profile.display_name, target_id: receipt.id, details: reason.trim() } satisfies AuditEntry);
  await done;
}

export async function importPeople(names: string[]) {
  const db = await openDb();
  const current = await req(db.transaction('people', 'readonly').objectStore('people').getAll()) as Person[];
  const existing = new Set(current.map((p) => p.name_key));
  const pending: Person[] = [];
  for (const raw of names) {
    const name = String(raw || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2) continue;
    const nameKey = normalizeName(name);
    if (!existing.has(nameKey)) {
      existing.add(nameKey);
      pending.push({ id: id('person'), name, name_key: nameKey, created_at: new Date().toISOString() });
    }
  }
  if (!pending.length) return 0;
  const tx = db.transaction('people', 'readwrite');
  const done = txDone(tx);
  pending.forEach((person) => tx.objectStore('people').add(person));
  await done;
  return pending.length;
}

export async function listUsers(): Promise<Pick<LocalUser, 'id' | 'username' | 'display_name' | 'role' | 'active'>[]> {
  const db = await openDb();
  const rows = await req(db.transaction('users', 'readonly').objectStore('users').getAll()) as LocalUser[];
  return rows.map(({ id, username, display_name, role, active }) => ({ id, username, display_name, role, active })).sort((a, b) => a.display_name.localeCompare(b.display_name, 'ar'));
}

export async function createLocalUser(displayName: string, username: string, password: string, role: Role, profile: Profile) {
  if (profile.role !== 'admin') throw new Error('إدارة المستخدمين متاحة للمدير فقط.');
  if (displayName.trim().length < 2) throw new Error('اكتب اسم الموظف.');
  if (username.trim().length < 3) throw new Error('اسم المستخدم قصير.');
  if (password.length < 6) throw new Error('كلمة المرور يجب ألا تقل عن 6 رموز.');
  const db = await openDb();
  const existing = await req(db.transaction('users', 'readonly').objectStore('users').index('username_key').get(normalizeUsername(username))) as LocalUser | undefined;
  if (existing) throw new Error('اسم المستخدم مستخدم مسبقًا.');
  const pwd = await makePassword(password);
  const user: LocalUser = {
    id: id('user'), display_name: displayName.trim(), role, username: username.trim(), username_key: normalizeUsername(username), password_hash: pwd.hash, salt: pwd.salt, created_at: new Date().toISOString(), active: true,
  };
  const tx = db.transaction(['users', 'audit'], 'readwrite');
  const done = txDone(tx);
  tx.objectStore('users').add(user);
  tx.objectStore('audit').add({ id: id('audit'), at: new Date().toISOString(), action: 'user_created', by: profile.id, by_name: profile.display_name, target_id: user.id, details: `${user.display_name} (${user.role})` } satisfies AuditEntry);
  await done;
}

async function collectBackupPayload(): Promise<BackupPayload> {
  const db = await openDb();
  const tx = db.transaction(['people', 'receipts', 'settings', 'users', 'audit', 'meta'], 'readonly');
  const done = txDone(tx);
  const [people, receipts, settings, users, audit, meta] = await Promise.all([
    req(tx.objectStore('people').getAll()) as Promise<Person[]>,
    req(tx.objectStore('receipts').getAll()) as Promise<Receipt[]>,
    req(tx.objectStore('settings').getAll()) as Promise<AppSettings[]>,
    req(tx.objectStore('users').getAll()) as Promise<LocalUser[]>,
    req(tx.objectStore('audit').getAll()) as Promise<AuditEntry[]>,
    req(tx.objectStore('meta').getAll()) as Promise<MetaEntry[]>,
  ]);
  await done;
  return { format: 'receipt-dispatcher-local-backup', version: 1, exported_at: new Date().toISOString(), data: { people, receipts, settings, users, audit, meta } };
}

export async function exportBackup(): Promise<BackupPayload> {
  return collectBackupPayload();
}

export async function createLocalSnapshot() {
  const payload = await collectBackupPayload();
  const db = await openDb();
  const tx = db.transaction(['backups', 'meta'], 'readwrite');
  const done = txDone(tx);
  const backups = tx.objectStore('backups');
  const snapshot: LocalSnapshot = { id: id('backup'), created_at: payload.exported_at, payload };
  backups.add(snapshot);
  tx.objectStore('meta').put({ key: 'last_snapshot_at', value: payload.exported_at } satisfies MetaEntry);
  await done;
  await trimSnapshots(7);
  return snapshot.created_at;
}

async function trimSnapshots(keep: number) {
  const db = await openDb();
  const rows = await req(db.transaction('backups', 'readonly').objectStore('backups').getAll()) as LocalSnapshot[];
  const extra = rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(keep);
  if (!extra.length) return;
  const tx = db.transaction('backups', 'readwrite');
  const done = txDone(tx);
  extra.forEach((x) => tx.objectStore('backups').delete(x.id));
  await done;
}

export async function maybeCreateDailySnapshot() {
  const db = await openDb();
  const row = await req(db.transaction('meta', 'readonly').objectStore('meta').get('last_snapshot_at')) as MetaEntry | undefined;
  const last = typeof row?.value === 'string' ? new Date(row.value).getTime() : 0;
  if (!last || Date.now() - last >= 24 * 60 * 60 * 1000) return createLocalSnapshot();
  return typeof row?.value === 'string' ? row.value : null;
}

export async function getBackupInfo() {
  const db = await openDb();
  const [lastRow, count] = await Promise.all([
    req(db.transaction('meta', 'readonly').objectStore('meta').get('last_snapshot_at')) as Promise<MetaEntry | undefined>,
    req(db.transaction('backups', 'readonly').objectStore('backups').count()),
  ]);
  return { lastSnapshotAt: typeof lastRow?.value === 'string' ? lastRow.value : null, snapshotCount: count };
}

function validateBackup(payload: unknown): asserts payload is BackupPayload {
  if (!payload || typeof payload !== 'object') throw new Error('ملف النسخة الاحتياطية غير صالح.');
  const p = payload as Partial<BackupPayload>;
  if (p.format !== 'receipt-dispatcher-local-backup' || p.version !== 1 || !p.data) throw new Error('صيغة النسخة الاحتياطية غير مدعومة.');
  if (!Array.isArray(p.data.people) || !Array.isArray(p.data.receipts) || !Array.isArray(p.data.settings) || !Array.isArray(p.data.users)) throw new Error('محتوى النسخة الاحتياطية غير مكتمل.');
}

export async function restoreBackup(payload: unknown) {
  validateBackup(payload);
  if (!payload.data.users.length) throw new Error('النسخة الاحتياطية لا تحتوي على مستخدم صالح.');
  const db = await openDb();
  const stores = ['people', 'receipts', 'settings', 'users', 'audit', 'meta'] as const;
  const tx = db.transaction([...stores], 'readwrite');
  const done = txDone(tx);
  stores.forEach((name) => tx.objectStore(name).clear());
  payload.data.people.forEach((x) => tx.objectStore('people').put(x));
  payload.data.receipts.forEach((x) => tx.objectStore('receipts').put(x));
  payload.data.settings.forEach((x) => tx.objectStore('settings').put(x));
  payload.data.users.forEach((x) => tx.objectStore('users').put(x));
  payload.data.audit.forEach((x) => tx.objectStore('audit').put(x));
  payload.data.meta.forEach((x) => tx.objectStore('meta').put(x));
  tx.objectStore('audit').put({ id: id('audit'), at: new Date().toISOString(), action: 'restore', by: 'system', by_name: 'النظام', details: `استعادة نسخة ${payload.exported_at}` } satisfies AuditEntry);
  await done;
  localStorage.removeItem(SESSION_KEY);
  await createLocalSnapshot();
}

export async function requestPersistentStorage(): Promise<StorageInfo> {
  if (!navigator.storage) return { persisted: null, usage: null, quota: null };
  let persisted: boolean | null = null;
  if (navigator.storage.persist) {
    try { persisted = await navigator.storage.persist(); } catch { persisted = null; }
  }
  const estimate = await navigator.storage.estimate().catch(() => ({ usage: undefined, quota: undefined }));
  return { persisted, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
}

export async function getStorageInfo(): Promise<StorageInfo> {
  if (!navigator.storage) return { persisted: null, usage: null, quota: null };
  let persisted: boolean | null = null;
  if (navigator.storage.persisted) {
    try { persisted = await navigator.storage.persisted(); } catch { persisted = null; }
  }
  const estimate = await navigator.storage.estimate().catch(() => ({ usage: undefined, quota: undefined }));
  return { persisted, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
}
