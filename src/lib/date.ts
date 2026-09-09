export function todayStr(): string {
  return dateStr(new Date());
}

export function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

export function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86400000);
}

export function isOverdue(dateStr: string, time: string, completed: boolean): boolean {
  if (completed) return false;
  const now = new Date();
  const taskDate = parseDate(dateStr);
  taskDate.setHours(0, 0, 0, 0);
  const today = startOfDay(now);
  if (taskDate.getTime() < today.getTime()) return true;
  if (taskDate.getTime() === today.getTime()) {
    const [h, m] = time.split(':').map(Number);
    const taskTime = new Date();
    taskTime.setHours(h, m, 0, 0);
    return taskTime.getTime() < now.getTime();
  }
  return false;
}

export function remainingTime(dateStr: string, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const target = parseDate(dateStr);
  target.setHours(h, m, 0, 0);
  const now = new Date();
  const diff = target.getTime() - now.getTime();

  if (diff < 0) {
    const past = Math.abs(diff);
    const days = Math.floor(past / 86400000);
    const hours = Math.floor((past % 86400000) / 3600000);
    const mins = Math.floor((past % 3600000) / 60000);
    if (days > 0) return `${days}g ${hours}sa geçti`;
    if (hours > 0) return `${hours}sa ${mins}dk geçti`;
    return `${mins}dk geçti`;
  }

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}g ${hours}sa kaldı`;
  if (hours > 0) return `${hours}sa ${mins}dk kaldı`;
  return `${mins}dk kaldı`;
}

export function sectionOf(dateStr: string): 'today' | 'tomorrow' | 'week' | 'later' {
  const diff = daysBetween(new Date(), parseDate(dateStr));
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= 7) return 'week';
  return 'later';
}

export const SECTION_LABELS = {
  today: 'Bugün',
  tomorrow: 'Yarın',
  week: 'Bu Hafta',
  later: 'Daha Sonra',
} as const;

export const TURKISH_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

export const TURKISH_DAYS = [
  'Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi',
];

export function formatTurkishDate(d: Date): string {
  return `${d.getDate()} ${TURKISH_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatTurkishDay(d: Date): string {
  return `${TURKISH_DAYS[d.getDay()]}, ${d.getDate()} ${TURKISH_MONTHS[d.getMonth()]}`;
}
