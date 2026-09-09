import { useMemo, useState } from 'react';
import { Download, Filter, Pencil, Pin, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { BranchInfo, TrackingRecord, SectionPermissions } from '@/lib/types';
import BranchRecordSelector, { defaultRecordBranch } from './BranchRecordSelector';
import { uid } from '@/lib/storage';
import { useRecordLock } from '@/lib/useRecordLock';

interface Props {
  records: TrackingRecord[];
  onSave: (record: TrackingRecord) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  isAdmin: boolean;
  onExport: (records: TrackingRecord[]) => void;
  permissions: SectionPermissions;
  branches: BranchInfo[];
}

const emptyForm = {
  groupName: '',
  serviceDate: new Date().toISOString().slice(0, 10),
  serviceNumber: '',
  serviceLocation: '',
  description: '',
  replacedPart1: '',
  replacedPart2: '',
  replacedPart3: '',
  note: '',
};

const emptyFilters = {
  groupName: '',
  dateFrom: '',
  dateTo: '',
  serviceNumber: '',
  serviceLocation: '',
  description: '',
  replacedPart1: '',
  replacedPart2: '',
  replacedPart3: '',
  note: '',
  pinned: 'all',
};

type FilterKey = keyof typeof emptyFilters;

export default function TrackingPanel({ records, onSave, onDelete, onRestore, isAdmin, onExport, permissions, branches }: Props) {
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [branchCode, setBranchCode] = useState(() => defaultRecordBranch(branches));
  const [filters, setFilters] = useState(emptyFilters);
  const recordLock = useRecordLock('TRACKING', editingId, showForm && Boolean(editingId));

  const groups = useMemo(
    () => Array.from(new Set(records.map((record) => record.groupName.trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'tr-TR')),
    [records],
  );

  const filteredRecords = useMemo(() => {
    const contains = (value: string, query: string) =>
      !query.trim() || value.toLocaleLowerCase('tr-TR').includes(query.trim().toLocaleLowerCase('tr-TR'));

    return records.filter((record) =>
      contains(record.groupName, filters.groupName) &&
      (!filters.dateFrom || record.serviceDate >= filters.dateFrom) &&
      (!filters.dateTo || record.serviceDate <= filters.dateTo) &&
      contains(record.serviceNumber, filters.serviceNumber) &&
      contains(record.serviceLocation, filters.serviceLocation) &&
      contains(record.description, filters.description) &&
      contains(record.replacedPart1, filters.replacedPart1) &&
      contains(record.replacedPart2, filters.replacedPart2) &&
      contains(record.replacedPart3, filters.replacedPart3) &&
      contains(record.note, filters.note) &&
      (filters.pinned === 'all' || record.pinned === (filters.pinned === 'yes'))
    );
  }, [records, filters]);

  const orderedRecords = useMemo(
    () => filteredRecords.slice().sort((a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      b.serviceDate.localeCompare(a.serviceDate) ||
      b.updatedAt - a.updatedAt
    ),
    [filteredRecords],
  );

  const pinnedRecords = orderedRecords.filter((record) => record.pinned);
  const regularRecords = orderedRecords.filter((record) => !record.pinned);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateFilter = (field: FilterKey, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const openNew = () => {
    if (!permissions.canCreate) return;
    setEditingId(null);
    setBranchCode(defaultRecordBranch(branches));
    setForm({ ...emptyForm, serviceDate: new Date().toISOString().slice(0, 10) });
    setShowForm(true);
  };

  const openEdit = (record: TrackingRecord) => {
    if (!permissions.canEdit) return;
    setEditingId(record.id);
    setBranchCode(record.branchCode ?? defaultRecordBranch(branches));
    setForm({
      groupName: record.groupName,
      serviceDate: record.serviceDate,
      serviceNumber: record.serviceNumber,
      serviceLocation: record.serviceLocation,
      description: record.description,
      replacedPart1: record.replacedPart1,
      replacedPart2: record.replacedPart2,
      replacedPart3: record.replacedPart3,
      note: record.note,
    });
    setShowForm(true);
  };

  const togglePinned = (record: TrackingRecord) => {
    if (!permissions.canEdit) return;
    onSave({ ...record, pinned: !record.pinned, updatedAt: Date.now() });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (editingId && !recordLock.editable) return alert(recordLock.error || 'Kayıt düzenleme kilidi alınamadı.');
    if (!form.groupName.trim()) return alert('Grup adı zorunludur.');
    if (!form.serviceDate) return alert('Servis tarihi zorunludur.');
    if (!editingId && !branchCode) return alert('Kayıt yapılacak şubeyi seçin.');

    const previous = editingId ? records.find((record) => record.id === editingId) : undefined;
    const now = Date.now();
    onSave({
      id: previous?.id ?? uid(),
      branchCode: previous?.branchCode ?? branchCode,
      groupName: form.groupName.trim(),
      serviceDate: form.serviceDate,
      serviceNumber: form.serviceNumber.trim(),
      serviceLocation: form.serviceLocation.trim(),
      description: form.description.trim(),
      replacedPart1: form.replacedPart1.trim(),
      replacedPart2: form.replacedPart2.trim(),
      replacedPart3: form.replacedPart3.trim(),
      note: form.note.trim(),
      pinned: previous?.pinned ?? false,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const renderRecord = (record: TrackingRecord, highlighted = false) => {
    const parts = [record.replacedPart1, record.replacedPart2, record.replacedPart3].filter(Boolean);
    return (
      <article
        key={record.id}
        className={`grid min-h-12 grid-cols-[28px_minmax(110px,0.8fr)_minmax(120px,0.9fr)_minmax(150px,1.4fr)_minmax(130px,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition ${
          record.deletedAt ? 'border-2 border-red-500 bg-red-950/30' :
          highlighted ? 'border border-red-500 bg-red-950/20' : 'bg-slate-800/70 ring-1 ring-slate-700'
        }`}
      >
        <label className="flex cursor-pointer items-center justify-center" title="Kaydı üste sabitle">
          <input type="checkbox" checked={Boolean(record.pinned)} disabled={!permissions.canEdit}
            onChange={() => togglePinned(record)} className="h-4 w-4 accent-red-500 disabled:opacity-50" />
        </label>

        <div className="min-w-0">
          <p className={`truncate font-semibold ${record.deletedAt ? 'text-red-200 line-through' : highlighted ? 'text-red-300' : 'text-sky-300'}`}>{record.groupName || 'Grup yok'} {record.deletedAt && <span className="ml-1 rounded bg-red-500 px-1.5 py-0.5 text-[9px] text-white">SİLİNDİ</span>}</p>
          <span className="record-branch-badge mt-1">{record.branchCode || '---'}</span>
          <p className="truncate text-[10px] text-slate-500">{new Date(`${record.serviceDate}T00:00:00`).toLocaleDateString('tr-TR')}</p>
        </div>

        <div className="min-w-0">
          <p className="truncate font-medium text-white">{record.serviceNumber || 'Servis no yok'}</p>
          <p className="truncate text-[10px] text-slate-500">{record.serviceLocation || 'Yer belirtilmedi'}</p>
        </div>

        <p className="line-clamp-2 min-w-0 whitespace-pre-wrap text-slate-300" title={record.description}>{record.description || 'Açıklama yok'}</p>

        <div className="min-w-0">
          <p className="truncate text-orange-300" title={parts.join(', ')}>{parts.length ? parts.join(' · ') : 'Parça yok'}</p>
          <p className="truncate text-[10px] text-slate-500" title={record.note}>{record.note || 'Not yok'}</p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {highlighted && <Pin className="h-3.5 w-3.5 text-red-400" />}
          {!record.deletedAt && permissions.canEdit && <button onClick={() => openEdit(record)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-sky-300" aria-label="Düzenle"><Pencil className="h-3.5 w-3.5" /></button>}
          {record.deletedAt && isAdmin ? <button onClick={() => onRestore(record.id)} className="rounded-md p-1.5 text-emerald-300 hover:bg-emerald-500/15" aria-label="Geri yükle"><RotateCcw className="h-3.5 w-3.5" /></button> : permissions.canDelete && <button onClick={() => onDelete(record.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/15 hover:text-red-400" aria-label="Sil"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      </article>
    );
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl bg-slate-800/70 p-2 ring-1 ring-slate-700">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Takip</h2>
            <p className="mt-0.5 text-xs text-slate-400">Kayıtları işaretleyerek üste sabitleyin; tüm alanlara göre rapor oluşturun.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowFilters((value) => !value)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-600">
              <Filter className="h-4 w-4" /> Rapor Filtreleri
            </button>
            {permissions.canCreate && (
              <button type="button" onClick={openNew}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400">
                <Plus className="h-4 w-4" /> Yeni Takip Kaydı
              </button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 rounded-xl bg-slate-900/50 p-2 ring-1 ring-slate-700">
            <div className="grid gap-1.5 sm:grid-cols-2">
              <FilterField label="Grup Adı" value={filters.groupName} onChange={(v) => updateFilter('groupName', v)} list="tracking-groups" />
              <FilterField label="Servis Numarası" value={filters.serviceNumber} onChange={(v) => updateFilter('serviceNumber', v)} />
              <FilterField label="Başlangıç Tarihi" type="date" value={filters.dateFrom} onChange={(v) => updateFilter('dateFrom', v)} />
              <FilterField label="Bitiş Tarihi" type="date" value={filters.dateTo} onChange={(v) => updateFilter('dateTo', v)} />
              <FilterField label="Servis Yeri" value={filters.serviceLocation} onChange={(v) => updateFilter('serviceLocation', v)} />
              <FilterField label="Açıklama" value={filters.description} onChange={(v) => updateFilter('description', v)} />
              <FilterField label="Değişilen Parça 1" value={filters.replacedPart1} onChange={(v) => updateFilter('replacedPart1', v)} />
              <FilterField label="Değişilen Parça 2" value={filters.replacedPart2} onChange={(v) => updateFilter('replacedPart2', v)} />
              <FilterField label="Değişilen Parça 3" value={filters.replacedPart3} onChange={(v) => updateFilter('replacedPart3', v)} />
              <FilterField label="Not" value={filters.note} onChange={(v) => updateFilter('note', v)} />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-400">Sabitleme Durumu</span>
                <select value={filters.pinned} onChange={(e) => updateFilter('pinned', e.target.value)}
                  className="w-full rounded-xl bg-slate-800 px-2 py-1.5.5 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500">
                  <option value="all">Tümü</option>
                  <option value="yes">Sabitlenenler</option>
                  <option value="no">Sabitlenmeyenler</option>
                </select>
              </label>
            </div>
            <datalist id="tracking-groups">{groups.map((group) => <option key={group} value={group} />)}</datalist>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => setFilters(emptyFilters)}
                className="rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-600">
                Filtreleri Temizle
              </button>
              {permissions.canExcel && (
                <button type="button" disabled={filteredRecords.length === 0} onClick={() => onExport(filteredRecords)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
                  <Download className="h-4 w-4" /> Filtrelenmiş Raporu Excel'e Aktar ({filteredRecords.length})
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {pinnedRecords.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-400">
            <Pin className="h-4 w-4" /> Sabitlenen Kayıtlar ({pinnedRecords.length})
          </div>
          <div className="overflow-hidden"><div className=" space-y-1.5">{pinnedRecords.map((record) => renderRecord(record, true))}</div></div>
        </div>
      )}

      {regularRecords.length === 0 && pinnedRecords.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          {records.length === 0 ? 'Henüz takip kaydı bulunmuyor.' : 'Filtrelere uyan kayıt bulunmuyor.'}
        </div>
      ) : (
        regularRecords.length > 0 && <div className="space-y-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpenMonths(new Set(Array.from(new Set(regularRecords.map(r => r.serviceDate.slice(0, 7))))))} className="action-button secondary-button flex-1">Tüm Sekmeleri Aç</button>
            <button type="button" onClick={() => setOpenMonths(new Set())} className="action-button secondary-button flex-1">Tüm Sekmeleri Kapat</button>
          </div>
          {Array.from(new Set(regularRecords.map(r => r.serviceDate.slice(0, 7)))).sort().reverse().map(monthKey => {
            const monthRecords = regularRecords.filter(r => r.serviceDate.startsWith(monthKey));
            const isOpen = openMonths.has(monthKey);
            const [year, month] = monthKey.split('-').map(Number);
            const label = new Date(year, month - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
            return <section key={monthKey} className="rounded-xl bg-slate-900/40 ring-1 ring-slate-700">
              <button type="button" onClick={() => setOpenMonths(current => { const next = new Set(current); next.has(monthKey) ? next.delete(monthKey) : next.add(monthKey); return next; })}
                className="flex w-full items-center justify-between px-2 py-1.5 text-left">
                <span className="text-sm font-semibold capitalize text-white">{label}</span><span className="text-xs text-slate-500">{monthRecords.length} kayıt · {isOpen ? 'Kapat' : 'Aç'}</span>
              </button>
              {isOpen && <div className="overflow-hidden border-t border-slate-700 p-2"><div className=" space-y-1.5">{monthRecords.map(record => renderRecord(record))}</div></div>}
            </section>;
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-2">
          <form onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-slate-900 p-5 ring-1 ring-slate-700 sm:rounded-3xl">
            <BranchRecordSelector
              branches={branches}
              value={editingId ? (records.find(record => record.id === editingId)?.branchCode ?? branchCode) : branchCode}
              onChange={setBranchCode}
              disabled={Boolean(editingId)}
              className="mb-4"
            />
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">{editingId ? 'Takip Kaydını Düzenle' : 'Yeni Takip Kaydı'}</h3>
                <p className="text-sm text-slate-400">Servis bilgilerini eksiksiz girin.</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {editingId && (recordLock.loading || recordLock.error) && (
              <div className={`mb-3 rounded-xl p-3 text-sm ${recordLock.error ? 'bg-red-500/15 text-red-200 ring-1 ring-red-500/40' : 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30'}`}>
                {recordLock.error || 'Düzenleme kilidi alınıyor…'}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Grup Adı *" value={form.groupName} onChange={(v) => updateField('groupName', v)} />
              <Field label="Servis Tarihi *" type="date" value={form.serviceDate} onChange={(v) => updateField('serviceDate', v)} />
              <Field label="Servis Numarası" value={form.serviceNumber} onChange={(v) => updateField('serviceNumber', v)} />
              <Field label="Servis Yeri" value={form.serviceLocation} onChange={(v) => updateField('serviceLocation', v)} />
              <div className="sm:col-span-2"><TextArea label="Açıklama" value={form.description} onChange={(v) => updateField('description', v)} /></div>
              <Field label="Değişilen Parça 1" value={form.replacedPart1} onChange={(v) => updateField('replacedPart1', v)} />
              <Field label="Değişilen Parça 2" value={form.replacedPart2} onChange={(v) => updateField('replacedPart2', v)} />
              <Field label="Değişilen Parça 3" value={form.replacedPart3} onChange={(v) => updateField('replacedPart3', v)} />
              <div className="sm:col-span-2"><TextArea label="Not" value={form.note} onChange={(v) => updateField('note', v)} /></div>
            </div>

            <button type="submit" disabled={Boolean(editingId) && !recordLock.editable} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50">
              <Save className="h-4 w-4" /> Kaydet
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function FilterField({ label, value, onChange, type = 'text', list }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; list?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-400">{label}</span>
      <input type={type} value={value} list={list} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-slate-800 px-2 py-1.5.5 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500" />
    </label>
  );
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (value: string) => void; type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-300">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-slate-800 px-2 py-1.5.5 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500" />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-300">{label}</span>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-xl bg-slate-800 px-2 py-1.5.5 text-sm text-white ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500" />
    </label>
  );
}
