import * as XLSX from 'xlsx';
import type { Task, Credential, TrackingRecord } from './types';
import { PRIORITY_LABELS } from './types';
import { formatTurkishDate } from './date';

export function exportTasksExcel(tasks: Task[]): void {
  const rows = tasks.map((t) => ({
    'Başlık': t.title,
    'Açıklama': t.description,
    'Tarih': t.date,
    'Saat': t.time,
    'Öncelik': PRIORITY_LABELS[t.priority],
    'Durum': t.completed ? 'Tamamlandı' : 'Bekliyor',
    'Oluşturma': formatTurkishDate(new Date(t.createdAt)),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 25 }, { wch: 40 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'İşler');
  XLSX.writeFile(wb, 'yaklasan-isler.xlsx');
}

export function exportCredentialsExcel(creds: Credential[]): void {
  const rows = creds.map((c) => ({
    'Grup': c.groupName,
    'Kullanıcı Adı': c.username,
    'Şifre': c.password,
    'IP / Network': c.ip,
    'Açıklama': c.description,
    'Son Değiştirilme': formatTurkishDate(new Date(c.lastChanged)),
    'Oluşturma': formatTurkishDate(new Date(c.createdAt)),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 35 }, { wch: 18 }, { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bilgiler');
  XLSX.writeFile(wb, 'kimlik-bilgileri.xlsx');
}


type ExcelRow = Record<string, unknown>;

function textValue(row: ExcelRow, names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null) return String(value).trim();
  }
  return '';
}

function excelDateToISO(value: unknown): string {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function normalizePriority(value: string): Task['priority'] {
  const normalized = value.toLocaleLowerCase('tr-TR');
  if (normalized.includes('yük') || normalized === 'yuksek' || normalized === 'high') return 'yuksek';
  if (normalized.includes('düş') || normalized === 'dusuk' || normalized === 'low') return 'dusuk';
  return 'orta';
}

function normalizeCompleted(value: string): boolean {
  const normalized = value.toLocaleLowerCase('tr-TR');
  return ['tamamlandı', 'tamamlandi', 'evet', 'true', '1', 'done'].includes(normalized);
}

export async function importExcelFile(file: File): Promise<{ tasks: Task[]; credentials: Credential[]; errors: string[] }> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  const tasks: Task[] = [];
  const credentials: Credential[] = [];
  const errors: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet, { defval: '' });

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const title = textValue(row, ['Başlık', 'Baslik', 'Title', 'İş', 'Is']);
      const groupName = textValue(row, ['Grup', 'Grup Adı', 'Grup Adi', 'Group']);
      const username = textValue(row, ['Kullanıcı Adı', 'Kullanici Adi', 'Kullanıcı', 'Kullanici', 'Username']);

      if (title) {
        const date = excelDateToISO(row['Tarih'] ?? row['Date']);
        const time = textValue(row, ['Saat', 'Time']) || '09:00';
        if (!date) {
          errors.push(`${sheetName} satır ${rowNumber}: geçerli tarih bulunamadı.`);
          return;
        }
        tasks.push({
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          title,
          description: textValue(row, ['Açıklama', 'Aciklama', 'Description']),
          date,
          time: /^\d{1,2}:\d{2}/.test(time) ? time.slice(0, 5).padStart(5, '0') : '09:00',
          priority: normalizePriority(textValue(row, ['Öncelik', 'Oncelik', 'Priority'])),
          completed: normalizeCompleted(textValue(row, ['Durum', 'Tamamlandı', 'Tamamlandi', 'Completed'])),
          createdAt: Date.now(),
        });
        return;
      }

      if (groupName || username) {
        credentials.push({
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          groupName,
          username,
          password: textValue(row, ['Şifre', 'Sifre', 'Password']),
          ip: textValue(row, ['IP / Network', 'IP', 'Network']),
          description: textValue(row, ['Açıklama', 'Aciklama', 'Description']),
          lastChanged: Date.now(),
          createdAt: Date.now(),
        });
      }
    });
  }

  if (tasks.length === 0 && credentials.length === 0 && errors.length === 0) {
    errors.push('Excel dosyasında tanınan Başlık veya Grup/Kullanıcı Adı sütunları bulunamadı.');
  }

  return { tasks, credentials, errors };
}

export function downloadImportTemplate(): void {
  const taskRows = [{
    'Başlık': 'Örnek görev',
    'Açıklama': 'Toplu yükleme örneği',
    'Tarih': new Date().toISOString().slice(0, 10),
    'Saat': '09:00',
    'Öncelik': 'Orta',
    'Durum': 'Bekliyor',
  }];
  const credentialRows = [{
    'Grup': 'Örnek Sistem',
    'Kullanıcı Adı': 'kullanici',
    'Şifre': '',
    'IP / Network': '',
    'Açıklama': 'Örnek bilgi kaydı',
  }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(taskRows), 'İşler');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(credentialRows), 'Bilgiler');
  XLSX.writeFile(workbook, 'yaklasan-isler-toplu-yukleme-sablonu.xlsx');
}


export async function importCredentialsExcelFile(file: File): Promise<{ credentials: Credential[]; errors: string[] }> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  const credentials: Credential[] = [];
  const errors: string[] = [];

  const preferredSheets = workbook.SheetNames.filter((name) =>
    ['bilgiler', 'bilgi', 'credentials', 'kimlik bilgileri'].includes(name.toLocaleLowerCase('tr-TR').trim())
  );
  const sheetNames = preferredSheets.length > 0 ? preferredSheets : workbook.SheetNames;

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet, { defval: '' });

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const groupName = textValue(row, ['Grup', 'Grup Adı', 'Grup Adi', 'Group']);
      const username = textValue(row, ['Kullanıcı Adı', 'Kullanici Adi', 'Kullanıcı', 'Kullanici', 'Username']);
      const password = textValue(row, ['Şifre', 'Sifre', 'Password']);
      const ip = textValue(row, ['IP / Network', 'IP', 'Network']);
      const description = textValue(row, ['Açıklama', 'Aciklama', 'Description']);

      if (!groupName && !username && !password && !ip && !description) return;
      if (!username && !password && !ip) {
        errors.push(`${sheetName} satır ${rowNumber}: kullanıcı adı, şifre veya IP alanlarından en az biri gerekli.`);
        return;
      }

      credentials.push({
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        groupName: groupName || 'Genel',
        username,
        password,
        ip,
        description,
        lastChanged: Date.now(),
        createdAt: Date.now(),
      });
    });
  }

  if (credentials.length === 0 && errors.length === 0) {
    errors.push('Excel dosyasında yüklenebilir bilgi kaydı bulunamadı.');
  }

  return { credentials, errors };
}

export function downloadCredentialsImportTemplate(): void {
  const rows = [
    {
      'Grup': 'Sunucular',
      'Kullanıcı Adı': 'admin',
      'Şifre': '',
      'IP / Network': '192.168.1.10',
      'Açıklama': 'Ana sunucu',
    },
    {
      'Grup': 'Veritabanı',
      'Kullanıcı Adı': 'db_user',
      'Şifre': '',
      'IP / Network': '192.168.1.20',
      'Açıklama': 'Üretim veritabanı',
    },
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 18 },
    { wch: 22 },
    { wch: 22 },
    { wch: 20 },
    { wch: 35 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Bilgiler');
  XLSX.writeFile(workbook, 'bilgiler-toplu-yukleme-sablonu.xlsx');
}


export function exportTrackingExcel(records: TrackingRecord[], groupName: string): void {
  const selected = groupName === 'Tümü'
    ? records
    : records.filter((record) => record.groupName === groupName);

  const rows = selected
    .slice()
    .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate))
    .map((record) => ({
      'Grup Adı': record.groupName,
      'Servis Tarihi': record.serviceDate,
      'Servis Numarası': record.serviceNumber,
      'Servis Yeri': record.serviceLocation,
      'Açıklama': record.description,
      'Değişilen Parça 1': record.replacedPart1,
      'Değişilen Parça 2': record.replacedPart2,
      'Değişilen Parça 3': record.replacedPart3,
      'Not': record.note,
      'Üste Sabitlenmiş': record.pinned ? 'Evet' : 'Hayır',
      'Oluşturulma Tarihi': new Date(record.createdAt).toLocaleString('tr-TR'),
      'Güncellenme Tarihi': new Date(record.updatedAt).toLocaleString('tr-TR'),
    }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 22 },
    { wch: 14 },
    { wch: 20 },
    { wch: 24 },
    { wch: 40 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
    { wch: 40 },
    { wch: 16 },
    { wch: 22 },
    { wch: 22 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Takip');

  const safeGroup = groupName === 'Tümü'
    ? 'tum-gruplar'
    : groupName
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'grup';

  XLSX.writeFile(workbook, `takip-${safeGroup}.xlsx`);
}
