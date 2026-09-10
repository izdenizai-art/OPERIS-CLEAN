import type { AppUser, SessionUser, UserPermissions, SectionPermissions } from './types';

const USERS_KEY = 'yi-users-v3';
const ITERATIONS = 310_000;

interface WrappedKey {
  iv: string;
  ciphertext: string;
}

interface StoredUser extends AppUser {
  salt: string;
  verifier: string;
  wrappedVaultKey: WrappedKey;
  isAdmin: boolean;
}

export interface AuthSession {
  user: SessionUser;
  vaultKey: CryptoKey;
}

const FULL_SECTION_PERMISSIONS: SectionPermissions = {
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canExcel: true,
};

const EMPTY_ASSET_PERMISSIONS = {
  dashboardView: false, cardsView: false, cardsCreate: false, cardsEdit: false, cardsDelete: false,
  assignmentsView: false, assignmentsCreate: false, assignmentsReturn: false,
  transfersView: false, transfersCreate: false, transfersApprove: false,
  countsView: false, countsCreate: false, countsScan: false, countsReview: false, countsCorrect: false, countsComplete: false, countsApprove: false,
  locationsView: false, locationsManage: false,
  labelsView: false, labelsDesign: false, labelsPrint: false,
  documentsView: false, documentsPrint: false,
  reportsView: false, reportsExport: false,
  integrationsView: false, integrationsManage: false,
};

const ADMIN_PERMISSIONS: UserPermissions = {
  tasks: { ...FULL_SECTION_PERMISSIONS },
  credentials: { ...FULL_SECTION_PERMISSIONS },
  tracking: { ...FULL_SECTION_PERMISSIONS },
  network: { ...FULL_SECTION_PERMISSIONS },
  canAccessSettings: true,
  canManageUsers: true,
  canManageBranches: true,
  canAssignUserBranches: true,
  canSendBranchAnnouncements: true,
  canAccessAssets: true,
  assets: Object.fromEntries(Object.keys(EMPTY_ASSET_PERMISSIONS).map(key => [key, true])) as unknown as UserPermissions['assets'],
};

const DEFAULT_SECTION_PERMISSIONS: SectionPermissions = {
  canView: true,
  canCreate: true,
  canEdit: false,
  canDelete: false,
  canExcel: false,
};

function normalizePermissions(value: unknown): UserPermissions {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const legacyCanView = typeof source.canView === 'boolean' ? source.canView : true;
  const legacyCanCreate = typeof source.canCreate === 'boolean' ? source.canCreate : false;
  const legacyCanDelete = typeof source.canDelete === 'boolean' ? source.canDelete : false;

  const normalizeSection = (section: unknown): SectionPermissions => {
    const current = (section && typeof section === 'object' ? section : {}) as Record<string, unknown>;
    return {
      canView: typeof current.canView === 'boolean' ? current.canView : legacyCanView,
      canCreate: typeof current.canCreate === 'boolean' ? current.canCreate : legacyCanCreate,
      canEdit: typeof current.canEdit === 'boolean' ? current.canEdit : legacyCanCreate,
      canDelete: typeof current.canDelete === 'boolean' ? current.canDelete : legacyCanDelete,
      canExcel: typeof current.canExcel === 'boolean' ? current.canExcel : legacyCanCreate,
    };
  };

  return {
    tasks: normalizeSection(source.tasks ?? DEFAULT_SECTION_PERMISSIONS),
    credentials: normalizeSection(source.credentials ?? DEFAULT_SECTION_PERMISSIONS),
    tracking: normalizeSection(source.tracking ?? DEFAULT_SECTION_PERMISSIONS),
    network: normalizeSection(source.network ?? { canView: false, canCreate: false, canEdit: false, canDelete: false, canExcel: false }),
    canAccessSettings: typeof source.canAccessSettings === 'boolean' ? source.canAccessSettings : false,
    canManageUsers: typeof source.canManageUsers === 'boolean' ? source.canManageUsers : false,
    canManageBranches: typeof source.canManageBranches === 'boolean' ? source.canManageBranches : false,
    canAssignUserBranches: typeof source.canAssignUserBranches === 'boolean' ? source.canAssignUserBranches : false,
    canSendBranchAnnouncements: typeof source.canSendBranchAnnouncements === 'boolean' ? source.canSendBranchAnnouncements : false,
    canAccessAssets: typeof source.canAccessAssets === 'boolean' ? source.canAccessAssets : false,
    assets: {
      ...EMPTY_ASSET_PERMISSIONS,
      ...((source.assets && typeof source.assets === 'object') ? source.assets as Partial<UserPermissions['assets']> : {}),
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveUserKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function verifierFor(key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(12);
  const probe = new TextEncoder().encode('yaklasan-isler-user-verifier-v3');
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, probe);
  return bytesToBase64(new Uint8Array(encrypted));
}

async function wrapVaultKey(rawVaultKey: Uint8Array, userKey: CryptoKey): Promise<WrappedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, userKey, toArrayBuffer(rawVaultKey));
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
}

async function unwrapVaultKey(wrapped: WrappedKey, userKey: CryptoKey): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(wrapped.iv)) },
    userKey,
    toArrayBuffer(base64ToBytes(wrapped.ciphertext)),
  );
  return new Uint8Array(decrypted);
}

async function importVaultKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

function readStoredUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredUser[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((user) => ({
      ...user,
      department: user.department ?? '',
      title: user.title ?? '',
      directoryGroups: user.directoryGroups ?? [],
      directoryUserPrincipalName: user.directoryUserPrincipalName ?? '',
      theme: user.theme ?? 'dark',
      mustChangePassword: user.mustChangePassword ?? false,
      directorySource: user.directorySource ?? 'LOCAL',
      directoryEnabled: user.directoryEnabled ?? false,
      permissions: user.isAdmin ? ADMIN_PERMISSIONS : normalizePermissions(user.permissions),
    }));
  } catch {
    return [];
  }
}

function writeStoredUsers(users: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function publicUser(user: StoredUser): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    department: user.department,
    title: user.title,
    directoryGroups: user.directoryGroups,
    directoryUserPrincipalName: user.directoryUserPrincipalName,
    theme: user.theme,
    mustChangePassword: user.mustChangePassword,
    directorySource: user.directorySource,
    directoryEnabled: user.directoryEnabled,
    directoryLastChangeAt: user.directoryLastChangeAt,
    directoryLastChanges: user.directoryLastChanges,
    directoryChangeUnread: user.directoryChangeUnread,
    permissions: user.isAdmin ? ADMIN_PERMISSIONS : user.permissions,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isAdmin: user.isAdmin,
  };
}

export function hasMultiUserAuth(): boolean {
  return readStoredUsers().length > 0;
}

export function listUsers(): SessionUser[] {
  return readStoredUsers().map(publicUser).sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.username.localeCompare(b.username, 'tr-TR'));
}

export async function initializeMultiUser(username: string, displayName: string, password: string): Promise<AuthSession> {
  if (hasMultiUserAuth()) throw new Error('Kullanıcı sistemi zaten kurulu.');
  const normalized = username.trim().toLocaleLowerCase('tr-TR');
  if (!normalized) throw new Error('Kullanıcı adı zorunludur.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const userKey = await deriveUserKey(password, salt);
  const rawVaultKey = crypto.getRandomValues(new Uint8Array(32));
  const now = Date.now();
  const stored: StoredUser = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random()}`,
    username: normalized,
    displayName: displayName.trim() || username.trim(),
    email: null,
    department: '',
    title: '',
    directoryGroups: [],
    directoryUserPrincipalName: '',
    theme: 'dark',
    mustChangePassword: false,
    directorySource: 'LOCAL',
    directoryEnabled: false,
    permissions: ADMIN_PERMISSIONS,
    active: true,
    createdAt: now,
    updatedAt: now,
    salt: bytesToBase64(salt),
    verifier: await verifierFor(userKey),
    wrappedVaultKey: await wrapVaultKey(rawVaultKey, userKey),
    isAdmin: true,
  };
  writeStoredUsers([stored]);
  return { user: publicUser(stored), vaultKey: await importVaultKey(rawVaultKey) };
}

export async function loginUser(username: string, password: string): Promise<AuthSession | null> {
  const normalized = username.trim().toLocaleLowerCase('tr-TR');
  const user = readStoredUsers().find((item) => item.username === normalized);
  if (!user || !user.active) return null;
  try {
    const userKey = await deriveUserKey(password, base64ToBytes(user.salt));
    if (await verifierFor(userKey) !== user.verifier) return null;
    const rawVaultKey = await unwrapVaultKey(user.wrappedVaultKey, userKey);
    return { user: publicUser(user), vaultKey: await importVaultKey(rawVaultKey) };
  } catch {
    return null;
  }
}

export async function addUser(
  actor: SessionUser,
  vaultKey: CryptoKey,
  input: { username: string; displayName: string; password: string; permissions: UserPermissions },
): Promise<SessionUser> {
  if (!actor.isAdmin && !actor.permissions.canManageUsers) throw new Error('Kullanıcı ekleme yetkiniz yok.');
  const users = readStoredUsers();
  const normalized = input.username.trim().toLocaleLowerCase('tr-TR');
  if (!normalized) throw new Error('Kullanıcı adı zorunludur.');
  if (users.some((item) => item.username === normalized)) throw new Error('Bu kullanıcı adı zaten mevcut.');
  if (input.password.length < 8) throw new Error('Şifre en az 8 karakter olmalıdır.');
  const rawVaultKey = new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const userKey = await deriveUserKey(input.password, salt);
  const now = Date.now();
  const stored: StoredUser = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random()}`,
    username: normalized,
    displayName: input.displayName.trim() || input.username.trim(),
    email: null,
    department: '',
    title: '',
    directoryGroups: [],
    directoryUserPrincipalName: '',
    theme: 'dark',
    mustChangePassword: false,
    directorySource: 'LOCAL',
    directoryEnabled: false,
    permissions: normalizePermissions(input.permissions),
    active: true,
    createdAt: now,
    updatedAt: now,
    salt: bytesToBase64(salt),
    verifier: await verifierFor(userKey),
    wrappedVaultKey: await wrapVaultKey(rawVaultKey, userKey),
    isAdmin: false,
  };
  writeStoredUsers([...users, stored]);
  return publicUser(stored);
}

export function updateUser(
  actor: SessionUser,
  id: string,
  changes: { displayName: string; active: boolean; permissions: UserPermissions },
): SessionUser {
  if (!actor.isAdmin && !actor.permissions.canManageUsers) throw new Error('Kullanıcı düzenleme yetkiniz yok.');
  const users = readStoredUsers();
  const target = users.find((item) => item.id === id);
  if (!target) throw new Error('Kullanıcı bulunamadı.');
  if (target.isAdmin) throw new Error('Yönetici kullanıcının yetkileri değiştirilemez.');
  const updated: StoredUser = {
    ...target,
    displayName: changes.displayName.trim() || target.username,
    active: changes.active,
    permissions: normalizePermissions(changes.permissions),
    updatedAt: Date.now(),
  };
  writeStoredUsers(users.map((item) => item.id === id ? updated : item));
  return publicUser(updated);
}

export async function resetUserPassword(
  actor: SessionUser,
  vaultKey: CryptoKey,
  id: string,
  password: string,
): Promise<void> {
  if (!actor.isAdmin && actor.id !== id) throw new Error('Bu kullanıcının şifresini değiştirme yetkiniz yok.');
  if (password.length < 8) throw new Error('Şifre en az 8 karakter olmalıdır.');
  const users = readStoredUsers();
  const target = users.find((item) => item.id === id);
  if (!target) throw new Error('Kullanıcı bulunamadı.');
  const rawVaultKey = new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const userKey = await deriveUserKey(password, salt);
  const updated: StoredUser = {
    ...target,
    salt: bytesToBase64(salt),
    verifier: await verifierFor(userKey),
    wrappedVaultKey: await wrapVaultKey(rawVaultKey, userKey),
    updatedAt: Date.now(),
  };
  writeStoredUsers(users.map((item) => item.id === id ? updated : item));
}

export function deleteUser(actor: SessionUser, id: string): void {
  if (!actor.isAdmin && !actor.permissions.canManageUsers) throw new Error('Kullanıcı silme yetkiniz yok.');
  const users = readStoredUsers();
  const target = users.find((item) => item.id === id);
  if (!target) return;
  if (target.isAdmin) throw new Error('Yönetici kullanıcı silinemez.');
  writeStoredUsers(users.filter((item) => item.id !== id));
}
