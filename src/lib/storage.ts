import type { AppState, Task, Credential, TrackingRecord, Settings } from './types';

const STORAGE_KEY = 'yaklasan-isler-v1';

const DEFAULT_SETTINGS: Settings = {
  notifyMinutesBefore: 15,
  shakeEnabled: true,
  soundEnabled: true,
  theme: 'dark',
  mail: {
    mailProvider: 'smtp',
    smtpEnabled: false,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPasswordSet: false,
    smtpFrom: '',
    graphEnabled: false,
    graphTenantId: '',
    graphClientId: '',
    graphClientSecretSet: false,
    graphSenderUser: '',
    reminderEmailEnabled: false,
    reminderLeadMinutes: 60,
  },
  branding: {
    companyName: '',
    companyLogoDataUrl: '',
    quickLinks: [],
  },
  backup: {
    networkBackupEnabled: false,
    networkBackupPath: '',
    backupScheduleEnabled: false,
    backupScheduleType: 'daily',
    backupScheduleTime: '22:00',
    backupScheduleDay: 1,
    backupRetentionDays: 30,
  },
};

const DEFAULT_STATE: AppState = {
  tasks: [],
  credentials: [],
  trackingRecords: [],
  settings: DEFAULT_SETTINGS,
  passwordHash: null,
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      tasks: parsed.tasks ?? [],
      credentials: parsed.credentials ?? [],
      trackingRecords: parsed.trackingRecords ?? [],
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      passwordHash: parsed.passwordHash ?? null,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function savePublicState(state: AppState): void {
  const safeState: AppState = {
    ...state,
    credentials: [],
    passwordHash: null,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState));
}

export function uid(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function legacyHashPassword(pw: string): string {
  let hash = 0;
  for (let i = 0; i < pw.length; i++) {
    hash = (hash << 5) - hash + pw.charCodeAt(i);
    hash |= 0;
  }
  return 'h' + Math.abs(hash).toString(36);
}

export type { Task, Credential, TrackingRecord, Settings };
