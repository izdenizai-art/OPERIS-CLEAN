import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Mail, Printer, Send, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { api } from '@/lib/api';

interface Props {
  title: string;
  rows: Record<string, unknown>[];
  companyName?: string;
  logoDataUrl?: string;
  compact?: boolean;
}

const FIELD_LABELS_TR: Record<string, string> = {
  branchCode: 'Şube Kodu',
  id: 'Kayıt No',
  title: 'Başlık',
  description: 'Açıklama',
  priority: 'Öncelik',
  status: 'Durum',
  dueDate: 'Bitiş Tarihi',
  startDate: 'Başlangıç Tarihi',
  completedAt: 'Tamamlanma Tarihi',
  createdAt: 'Oluşturma Tarihi',
  updatedAt: 'Güncelleme Tarihi',
  deletedAt: 'Silinme Tarihi',
  createdById: 'Oluşturan Kullanıcı No',
  createdByName: 'Oluşturan',
  updatedById: 'Güncelleyen Kullanıcı No',
  updatedByName: 'Güncelleyen',
  groupName: 'Grup Adı',
  serviceDate: 'Servis Tarihi',
  serviceNumber: 'Servis Numarası',
  serviceLocation: 'Servis Yeri',
  replacedPart1: 'Değiştirilen Parça 1',
  replacedPart2: 'Değiştirilen Parça 2',
  replacedPart3: 'Değiştirilen Parça 3',
  note: 'Not',
  username: 'Kullanıcı Adı',
  displayName: 'Ad Soyad',
  department: 'Birim / Departman',
  email: 'E-posta',
  active: 'Aktif',
  category: 'Kategori',
  name: 'Ad',
  label: 'Etiket',
  value: 'Değer',
  url: 'Web Adresi',
  host: 'IP / Hostname',
  ipAddress: 'IP Adresi',
  macAddress: 'MAC Adresi',
  deviceName: 'Cihaz Adı',
  computerName: 'Bilgisayar Adı',
  operatingSystem: 'İşletim Sistemi',
  operatingSystemVersion: 'İşletim Sistemi Sürümü',
  vendor: 'Üretici',
  location: 'Lokasyon',
  deviceType: 'Cihaz Tipi',
  lastCheckedAt: 'Son Kontrol',
  lastSuccessAt: 'Son Başarılı Erişim',
  lastFailureAt: 'Son Başarısız Erişim',
  lastLatencyMs: 'Son Gecikme (ms)',
  consecutiveFailures: 'Ardışık Hata',
  intervalSeconds: 'Kontrol Aralığı (sn)',
  failureThreshold: 'Başarısızlık Eşiği',
  timeoutMs: 'Zaman Aşımı (ms)',
  emailTo: 'Bildirim E-postaları',
  action: 'İşlem',
  module: 'Modül',
  recordId: 'Kayıt No',
  recordLabel: 'Kayıt',
  userAgent: 'Tarayıcı / İstemci',
  message: 'Mesaj',
  senderName: 'Gönderen',
  senderUsername: 'Gönderen Kullanıcı',
  recipientName: 'Alıcı',
  readAt: 'Okunma Tarihi',
  acknowledgedAt: 'Onay Tarihi',
  color: 'Renk',
  isImportant: 'Önemli',
  type: 'Tür',
  code: 'Kod',
  branchName: 'Şube Adı',
  permissions: 'Yetkiler',
};

const HIDDEN_REPORT_KEYS = new Set([
  'password',
  'passwordHash',
  'resetToken',
  'token',
  'createdById',
  'updatedById',
]);

function safeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'rapor';
}

function humanizeKey(key: string) {
  if (FIELD_LABELS_TR[key]) return FIELD_LABELS_TR[key];
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-zçğıöşü])([A-ZÇĞİÖŞÜ])/g, '$1 $2')
    .trim();
  return spaced
    ? spaced.charAt(0).toLocaleUpperCase('tr-TR') + spaced.slice(1)
    : key;
}

function formatValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (value instanceof Date) return value.toLocaleString('tr-TR');
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    try {
      return Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => `${humanizeKey(key)}: ${formatValue(item)}`)
        .join(' · ');
    } catch {
      return String(value);
    }
  }

  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('tr-TR');
  }
  return text;
}

function normalizeRows(rows: Record<string, unknown>[]) {
  return rows.map(row => {
    const translated: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (HIDDEN_REPORT_KEYS.has(key)) continue;
      translated[humanizeKey(key)] = formatValue(value);
    }
    return translated;
  });
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export default function PrintMailToolbar({
  title,
  rows,
  companyName = '',
  logoDataUrl = '',
  compact = false,
}: Props) {
  const normalized = useMemo(() => normalizeRows(rows), [rows]);
  const columns = useMemo(() => {
    const result: string[] = [];
    for (const row of normalized) {
      for (const key of Object.keys(row)) {
        if (!result.includes(key)) result.push(key);
      }
    }
    return result;
  }, [normalized]);

  const [mailOpen, setMailOpen] = useState(false);
  const [format, setFormat] = useState<'pdf' | 'xlsx'>('pdf');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(`${companyName || 'Operis'} - ${title}`);
  const [body, setBody] = useState('Operis uygulamasından oluşturulan rapor ektedir.');
  const [busy, setBusy] = useState(false);

  const buildPrintHtml = () => {
    const columnGroups = chunks(columns, 8);
    const groups = columnGroups.length ? columnGroups : [['Bilgi']];

    const tables = groups.map((group, groupIndex) => {
      const header = group.map(column => `<th>${escapeHtml(column)}</th>`).join('');
      const bodyRows = normalized.map(row =>
        `<tr>${group.map(column => `<td>${escapeHtml(row[column] ?? '')}</td>`).join('')}</tr>`,
      ).join('');

      return `
<section class="report-block">
  ${groups.length > 1 ? `<div class="group-title">Kolon Grubu ${groupIndex + 1} / ${groups.length}</div>` : ''}
  <div class="table-scroll">
    <table>
      <thead><tr>${header}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="${group.length}">Kayıt bulunamadı.</td></tr>`}</tbody>
    </table>
  </div>
</section>`;
    }).join('');

    return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
@page { size: A4 landscape; margin: 7mm; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:#fff; }
body { font-family: "Segoe UI", Arial, sans-serif; color:#111827; font-size:8px; }
.header { display:flex; align-items:center; gap:10px; margin-bottom:8px; border-bottom:2px solid #334155; padding-bottom:7px; }
.logo { max-height:36px; max-width:100px; object-fit:contain; }
h1 { margin:0; font-size:15px; color:#0f172a; }
.meta { margin-top:3px; color:#475569; font-size:8px; }
.report-block { margin-bottom:10px; break-inside:avoid; }
.group-title { margin:0 0 4px; font-size:8px; font-weight:700; color:#475569; }
.table-scroll { width:100%; overflow:visible; }
table { width:100%; border-collapse:collapse; table-layout:auto; }
thead { display:table-header-group; }
tr { break-inside:avoid; }
th, td { border:1px solid #94a3b8; padding:3px 4px; vertical-align:top; text-align:left; }
th { background:#e2e8f0; color:#0f172a; font-weight:700; white-space:nowrap; }
td { max-width:58mm; overflow-wrap:anywhere; word-break:break-word; }
tr:nth-child(even) td { background:#f8fafc; }
.footer { margin-top:5px; text-align:right; color:#64748b; font-size:7px; }
@media screen {
  body { padding:12px; background:#e2e8f0; }
  .header, .report-block, .footer { max-width:1500px; margin-left:auto; margin-right:auto; background:#fff; }
  .header, .footer { padding-left:10px; padding-right:10px; }
  .report-block { padding:10px; box-shadow:0 1px 3px rgba(0,0,0,.15); }
}
</style>
</head>
<body>
<div class="header">
${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="">` : ''}
<div>
<h1>${escapeHtml(companyName || 'Operis')} — ${escapeHtml(title)}</h1>
<div class="meta">Operasyon ve İş Yönetim Sistemi · Toplam kayıt: ${normalized.length} · ${new Date().toLocaleString('tr-TR')}</div>
</div>
</div>
${tables}
<div class="footer">BalamirK. · Operis v6.3.62</div>
</body>
</html>`;
  };

  const openPrintableReport = (autoPrint = true) => {
    const popup = window.open('', '_blank', 'width=1300,height=900');
    if (!popup) {
      alert('Rapor penceresi engellendi. Tarayıcı açılır pencere iznini etkinleştirin.');
      return;
    }
    popup.document.open();
    popup.document.write(buildPrintHtml());
    popup.document.close();
    if (autoPrint) {
      window.setTimeout(() => {
        popup.focus();
        popup.print();
      }, 600);
    }
  };

  const printReport = () => openPrintableReport(true);
  const exportPdf = () => {
    // Tarayıcı baskı motoru Türkçe karakterleri ve geniş tabloları jsPDF varsayılan
    // fontlarından daha güvenilir işler. Açılan pencerede "PDF olarak kaydet" seçilebilir.
    openPrintableReport(true);
  };

  const makeExcel = () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(
      normalized.length ? normalized : [{ Bilgi: 'Kayıt bulunamadı' }],
      { header: columns.length ? columns : undefined },
    );

    const widths = (columns.length ? columns : ['Bilgi']).map(column => {
      const maxValue = Math.max(
        column.length,
        ...normalized.slice(0, 500).map(row => String(row[column] ?? '').length),
      );
      return { wch: Math.max(12, Math.min(42, maxValue + 2)) };
    });
    sheet['!cols'] = widths;
    if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };

    XLSX.utils.book_append_sheet(workbook, sheet, 'Rapor');
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new File([data], `${safeFileName(title)}.xlsx`, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  };

  const downloadExcel = () => {
    const file = makeExcel();
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const makePdf = () => {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    if (logoDataUrl) {
      try { pdf.addImage(logoDataUrl, 'JPEG', 8, 7, 26, 16); } catch {}
    }
    pdf.setFontSize(13);
    pdf.text(companyName || 'Operis', logoDataUrl ? 38 : 8, 13);
    pdf.setFontSize(9);
    pdf.text(title, logoDataUrl ? 38 : 8, 19);
    pdf.setFontSize(7);
    pdf.text(`Toplam kayıt: ${normalized.length} - ${new Date().toLocaleString('tr-TR')}`, 8, 25);

    const groups = chunks(columns, 5);
    let firstGroup = true;
    for (const group of groups.length ? groups : [['Bilgi']]) {
      if (!firstGroup) pdf.addPage();
      firstGroup = false;

      const pageWidth = 281;
      const colWidth = pageWidth / group.length;
      let y = 31;

      pdf.setFontSize(6.5);
      for (let index = 0; index < group.length; index += 1) {
        pdf.setFillColor(226, 232, 240);
        pdf.rect(8 + index * colWidth, y, colWidth, 8, 'F');
        pdf.rect(8 + index * colWidth, y, colWidth, 8);
        const label = pdf.splitTextToSize(group[index], colWidth - 3).slice(0, 2);
        pdf.text(label, 9.5 + index * colWidth, y + 3);
      }
      y += 8;

      for (const row of normalized.slice(0, 1000)) {
        const cellLines = group.map(column =>
          pdf.splitTextToSize(String(row[column] ?? ''), colWidth - 3).slice(0, 3),
        );
        const height = Math.max(7, Math.max(...cellLines.map(lines => lines.length)) * 2.8 + 2);

        if (y + height > 198) {
          pdf.addPage();
          y = 12;
          for (let index = 0; index < group.length; index += 1) {
            pdf.setFillColor(226, 232, 240);
            pdf.rect(8 + index * colWidth, y, colWidth, 8, 'F');
            pdf.rect(8 + index * colWidth, y, colWidth, 8);
            pdf.text(pdf.splitTextToSize(group[index], colWidth - 3).slice(0, 2), 9.5 + index * colWidth, y + 3);
          }
          y += 8;
        }

        for (let index = 0; index < group.length; index += 1) {
          pdf.rect(8 + index * colWidth, y, colWidth, height);
          pdf.text(cellLines[index], 9.5 + index * colWidth, y + 3);
        }
        y += height;
      }
    }

    return new File([pdf.output('blob')], `${safeFileName(title)}.pdf`, { type: 'application/pdf' });
  };

  const sendMail = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const file = format === 'pdf' ? makePdf() : makeExcel();
      await api.sendReportMail({ to, subject, body, file });
      alert('E-posta başarıyla gönderildi.');
      setMailOpen(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'E-posta gönderilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={`no-print flex flex-wrap gap-2 ${compact ? '' : 'mb-3'}`}>
        <button type="button" onClick={downloadExcel} className="action-button secondary-button" title="Türkçe kolonlarla Excel dosyası oluşturur">
          <FileSpreadsheet className="h-4 w-4" /> Excel'e Aktar
        </button>
        <button type="button" onClick={exportPdf} className="action-button secondary-button" title="Türkçe karakterleri koruyan PDF baskı görünümünü açar">
          <FileText className="h-4 w-4" /> PDF'e Aktar
        </button>
        <button type="button" onClick={printReport} className="action-button secondary-button">
          <Printer className="h-4 w-4" /> Yazdır
        </button>
        <button type="button" onClick={() => setMailOpen(true)} className="action-button secondary-button">
          <Mail className="h-4 w-4" /> Mail Gönder
        </button>
      </div>

      {mailOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 sm:items-center sm:p-4">
          <form onSubmit={sendMail} className="w-full max-w-lg rounded-t-3xl bg-slate-900 p-5 ring-1 ring-slate-700 sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white">Raporu E-posta ile Gönder</h3>
                <p className="text-xs text-slate-500">SMTP/Exchange ayarları kullanılır.</p>
              </div>
              <button type="button" onClick={() => setMailOpen(false)} className="p-2 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <input required type="email" value={to} onChange={event => setTo(event.target.value)} placeholder="Alıcı e-posta adresi" className="form-control" />
              <input required value={subject} onChange={event => setSubject(event.target.value)} placeholder="Konu" className="form-control" />
              <textarea rows={4} value={body} onChange={event => setBody(event.target.value)} placeholder="Mesaj" className="form-control resize-y" />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setFormat('pdf')} className={`action-button ${format === 'pdf' ? 'primary-button' : 'secondary-button'}`}>
                  <FileText className="h-4 w-4" /> PDF
                </button>
                <button type="button" onClick={() => setFormat('xlsx')} className={`action-button ${format === 'xlsx' ? 'primary-button' : 'secondary-button'}`}>
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </button>
              </div>
              <button disabled={busy} className="action-button primary-button w-full">
                <Send className="h-4 w-4" /> {busy ? 'Gönderiliyor…' : 'E-postayı Gönder'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
