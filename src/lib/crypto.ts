const AUTH_KEY = 'yi-auth-v2';
const VAULT_KEY = 'yi-vault-v2';
const ITERATIONS = 310_000;

export interface AuthRecord {
  version: 2;
  salt: string;
  verifier: string;
  iterations: number;
}

interface EncryptedPayload {
  version: 1;
  iv: string;
  ciphertext: string;
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

async function deriveKey(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function keyVerifier(key: CryptoKey): Promise<string> {
  const probe = new TextEncoder().encode('yaklasan-isler-auth-verifier-v2');
  const iv = new Uint8Array(12);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, probe);
  return bytesToBase64(new Uint8Array(encrypted));
}

export function readAuthRecord(): AuthRecord | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthRecord;
    return parsed.version === 2 ? parsed : null;
  } catch {
    return null;
  }
}

export function hasSecureAuth(): boolean {
  return readAuthRecord() !== null;
}

export async function createSecureAuth(password: string): Promise<CryptoKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const record: AuthRecord = {
    version: 2,
    salt: bytesToBase64(salt),
    verifier: await keyVerifier(key),
    iterations: ITERATIONS,
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(record));
  return key;
}

export async function unlockSecureAuth(password: string): Promise<CryptoKey | null> {
  const record = readAuthRecord();
  if (!record) return null;
  const key = await deriveKey(password, base64ToBytes(record.salt), record.iterations);
  const verifier = await keyVerifier(key);
  return verifier === record.verifier ? key : null;
}

export async function encryptJson<T>(value: T, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const payload: EncryptedPayload = {
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(payload);
}

export async function decryptJson<T>(raw: string, key: CryptoKey): Promise<T> {
  const payload = JSON.parse(raw) as EncryptedPayload;
  if (payload.version !== 1) throw new Error('Desteklenmeyen kasa sürümü.');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(payload.iv)) },
    key,
    toArrayBuffer(base64ToBytes(payload.ciphertext))
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

export async function saveEncryptedVault<T>(value: T, key: CryptoKey): Promise<void> {
  localStorage.setItem(VAULT_KEY, await encryptJson(value, key));
}

export async function loadEncryptedVault<T>(key: CryptoKey, fallback: T): Promise<T> {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return fallback;
  return decryptJson<T>(raw, key);
}

export function clearLegacyPassword(): void {
  localStorage.removeItem('yi-pass');
}
