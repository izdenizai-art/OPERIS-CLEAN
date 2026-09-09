import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronDown, ChevronUp, Pencil, Save, Trash2, UserRoundCog, X } from 'lucide-react';
import { api } from '@/lib/api';
import type {
  AssetPermissions,
  BranchAdminItem,
  SectionPermissions,
  BranchHelpDeskPermissions,
  BranchRole,
  SessionUser,
  UserBranchAssignment,
  UserPermissions,
} from '@/lib/types';
import {
  BRANCH_MANAGER_HELPDESK,
  BRANCH_MANAGER_PERMISSIONS,
  EMPTY_BRANCH_HELPDESK,
  cloneBranchHelpDesk,
  cloneUserPermissions,
} from '@/lib/branchRoles';

const isSuperAdminUsername = (value: string) =>
  value.trim().normalize('NFKC').replace(/[Iİı]/g, 'i').toLowerCase() === 'balamir';

const EMPTY_SECTION: SectionPermissions = {
  canView: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canExcel: false,
};

const EMPTY_ASSETS: AssetPermissions = {
  dashboardView: false,
  cardsView: false,
  cardsCreate: false,
  cardsEdit: false,
  cardsDelete: false,
  assignmentsView: false,
  assignmentsCreate: false,
  assignmentsReturn: false,
  transfersView: false,
  transfersCreate: false,
  transfersApprove: false,
  countsView: false,
  countsCreate: false,
  countsScan: false,
  countsReview: false,
  countsCorrect: false,
  countsComplete: false,
  countsApprove: false,
  locationsView: false,
  locationsManage: false,
  labelsView: false,
  labelsDesign: false,
  labelsPrint: false,
  documentsView: false,
  documentsPrint: false,
  reportsView: false,
  reportsExport: false,
  integrationsView: false,
  integrationsManage: false,
};

const EMPTY_PERMISSIONS: UserPermissions = {
  tasks: { ...EMPTY_SECTION },
  credentials: { ...EMPTY_SECTION },
  tracking: { ...EMPTY_SECTION },
  network: { ...EMPTY_SECTION },
  canAccessSettings: false,
  canManageUsers: false,
  canManageBranches: false,
  canAssignUserBranches: false,
  canSendBranchAnnouncements: false,
  canAccessAssets: false,
  assets: { ...EMPTY_ASSETS },
};

type AssignmentDraft = Record<string, UserPermissions>;
type RoleDraft = Record<string, BranchRole>;
type HelpDeskDraft = Record<string, BranchHelpDeskPermissions>;

export default function BranchManagementPanel({
  users,
  currentUser,
  canManageBranches,
  canAssignUserBranches,
  onBranchConfigurationChanged,
}: {
  users: SessionUser[];
  currentUser: SessionUser;
  canManageBranches: boolean;
  canAssignUserBranches: boolean;
  onBranchConfigurationChanged: () => Promise<void>;
}) {
  const [branches, setBranches] = useState<BranchAdminItem[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [assignments, setAssignments] = useState<UserBranchAssignment[]>([]);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [permissionDraft, setPermissionDraft] = useState<AssignmentDraft>({});
  const [roleDraft,setRoleDraft]=useState<RoleDraft>({});
  const [helpDeskDraft,setHelpDeskDraft]=useState<HelpDeskDraft>({});
  const [primary, setPrimary] = useState('');
  const [expandedBranch, setExpandedBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingBranchCode,setEditingBranchCode]=useState('');
  const [editingBranchName,setEditingBranchName]=useState('');
  const [editingBranchActive,setEditingBranchActive]=useState(true);

  const loadBranches = async () => setBranches(await api.getBranches());

  useEffect(() => { void loadBranches(); }, []);

  const selectedUser = useMemo(
    () => users.find(user => user.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );
  const selectedUserIsSuperAdmin=Boolean(selectedUser&&isSuperAdminUsername(selectedUser.username));

  const chooseUser = async (userId: string) => {
    setSelectedUserId(userId);
    setExpandedBranch('');
    if (!userId) {
      setAssignments([]);
      setSelectedCodes([]);
      setPermissionDraft({});
      setRoleDraft({});
      setHelpDeskDraft({});
      setPrimary('');
      return;
    }

    const rows = await api.getUserBranches(userId);
    setAssignments(rows);
    setSelectedCodes(rows.map(row => row.branchCode));
    setPermissionDraft(Object.fromEntries(rows.map(row => [row.branchCode, row.permissions])));
    setRoleDraft(Object.fromEntries(rows.map(row => [row.branchCode, row.role])));
    setHelpDeskDraft(Object.fromEntries(rows.map(row => [row.branchCode, row.helpDesk])));
    setPrimary(rows.find(row => row.isPrimary)?.branchCode ?? rows[0]?.branchCode ?? '');
  };

  const create = async () => {
    if (!/^\d{3}$/.test(code) || !name.trim()) {
      alert('Şube kodu 3 haneli sayı ve şube adı zorunludur.');
      return;
    }
    setBusy(true);
    try {
      await api.createBranch({ code, name: name.trim(), active: true });
      setCode('');
      setName('');
      await loadBranches();
      await onBranchConfigurationChanged();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Şube oluşturulamadı.');
    } finally {
      setBusy(false);
    }
  };

  const beginEditBranch=(branch:BranchAdminItem)=>{
    setEditingBranchCode(branch.code);
    setEditingBranchName(branch.name);
    setEditingBranchActive(branch.active);
  };

  const saveBranchEdit=async()=>{
    const branch=branches.find(item=>item.code===editingBranchCode);
    if(!branch)return;
    const nextName=editingBranchName.trim();
    if(nextName.length<2){alert('Şube adı en az 2 karakter olmalıdır.');return;}
    setBusy(true);
    try{
      await api.updateBranch(branch.code,{name:nextName,active:branch.isHeadOffice?true:editingBranchActive});
      await loadBranches();
      await onBranchConfigurationChanged();
      setEditingBranchCode('');
    }catch(error){
      alert(error instanceof Error?error.message:'Şube güncellenemedi.');
    }finally{
      setBusy(false);
    }
  };

  const toggleBranch = (branchCode: string, checked: boolean) => {
    if (!selectedUser || selectedUserIsSuperAdmin) return;

    if (checked) {
      setSelectedCodes(current => [...new Set([...current, branchCode])]);
      setPermissionDraft(current => ({
        ...current,
        [branchCode]: current[branchCode] ?? structuredClone(selectedUser.permissions ?? EMPTY_PERMISSIONS),
      }));
      setPrimary(current => current || branchCode);
      setExpandedBranch(branchCode);
      return;
    }

    setSelectedCodes(current => current.filter(code => code !== branchCode));
    setPermissionDraft(current => {
      const next = { ...current };
      delete next[branchCode];
      return next;
    });
    setPrimary(current => current === branchCode ? selectedCodes.find(code => code !== branchCode) ?? '' : current);
    if (expandedBranch === branchCode) setExpandedBranch('');
  };

  const updateBranchPermissions = (branchCode: string, permissions: UserPermissions) => {
    if(selectedUserIsSuperAdmin)return;
    setPermissionDraft(current => ({ ...current, [branchCode]: permissions }));
  };

  const updateBranchRole=(branchCode:string,role:BranchRole)=>{
    if(selectedUserIsSuperAdmin)return;
    setRoleDraft(current=>({...current,[branchCode]:role}));
    if(role==='BRANCH_MANAGER'){
      setPermissionDraft(current=>({...current,[branchCode]:cloneUserPermissions(BRANCH_MANAGER_PERMISSIONS)}));
      setHelpDeskDraft(current=>({...current,[branchCode]:cloneBranchHelpDesk(BRANCH_MANAGER_HELPDESK)}));
    }
  };

  const updateHelpDeskPermissions=(branchCode:string,permissions:BranchHelpDeskPermissions)=>{
    if(selectedUserIsSuperAdmin)return;
    setHelpDeskDraft(current=>({...current,[branchCode]:permissions}));
  };

  const saveUserBranches = async () => {
    if(selectedUserIsSuperAdmin){alert('balamir Süper Admin hesabının şube ve yetki atamaları değiştirilemez.');return;}
    if (!selectedUserId || selectedCodes.length === 0 || !primary) {
      alert('Kullanıcı, en az bir şube ve birincil şube seçilmelidir.');
      return;
    }

    const missingPermissions = selectedCodes.some(code => !permissionDraft[code]);
    if (missingPermissions) {
      alert('Her yetkili şube için şube bazlı yetkiler tanımlanmalıdır.');
      return;
    }

    setBusy(true);
    try {
      const rows = await api.updateUserBranches(selectedUserId, {
        assignments: selectedCodes.map(branchCode => ({
          branchCode,
          isPrimary: branchCode === primary,
          role: roleDraft[branchCode] ?? 'USER',
          permissions: permissionDraft[branchCode],
          helpDesk: helpDeskDraft[branchCode] ?? cloneBranchHelpDesk(EMPTY_BRANCH_HELPDESK),
        })),
      });
      setAssignments(rows);
      setPermissionDraft(Object.fromEntries(rows.map(row => [row.branchCode, row.permissions])));
      setRoleDraft(Object.fromEntries(rows.map(row => [row.branchCode, row.role])));
      setHelpDeskDraft(Object.fromEntries(rows.map(row => [row.branchCode, row.helpDesk])));
      await onBranchConfigurationChanged();
      alert('Kullanıcının şube ve şube bazlı yetkileri kaydedildi.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Şube yetkileri kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel-card space-y-4">
      <div>
        <h3 className="panel-title"><Building2 className="h-5 w-5" /> Şube Yönetimi</h3>
        <p className="mt-1 text-sm opacity-70">
          Şube tanımı ve kullanıcı–şube ataması ayrı yetkilerdir. Her kullanıcı için her şubede Operasyon ve İş Yönetimi ile Demirbaş modülü yetkileri ayrı ayrı verilebilir.
        </p>
      </div>

      {canManageBranches && (
        <div className="grid gap-3 md:grid-cols-[140px_1fr_auto]">
          <input
            value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 3))}
            placeholder="3 haneli kod"
            className="rounded-xl bg-slate-800 px-3 py-2"
          />
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Şube adı"
            className="rounded-xl bg-slate-800 px-3 py-2"
          />
          <button disabled={busy} onClick={() => void create()} className="action-button primary-button">
            <Save className="h-4 w-4" /> Şube Ekle
          </button>
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {branches.map(branch => (
          <article key={branch.code} className="rounded-xl border border-slate-700 bg-slate-900/40 p-3">
            {editingBranchCode===branch.code ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Şube {branch.code}</p>
                  <input
                    value={editingBranchName}
                    onChange={event=>setEditingBranchName(event.target.value)}
                    className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-white ring-1 ring-slate-700"
                    maxLength={120}
                  />
                </div>
                {!branch.isHeadOffice&&<label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={editingBranchActive} onChange={event=>setEditingBranchActive(event.target.checked)} />
                  Şube aktif
                </label>}
                <p className="text-xs text-slate-500">İşlem/veri bulunan şube silinmez; gerektiğinde pasife alınır.</p>
                <div className="flex gap-2">
                  <button disabled={busy} onClick={()=>void saveBranchEdit()} className="action-button primary-button flex-1"><Save className="h-4 w-4" /> Kaydet</button>
                  <button disabled={busy} onClick={()=>setEditingBranchCode('')} className="action-button secondary-button"><X className="h-4 w-4" /> Vazgeç</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-black">{branch.code} — {branch.name}</p>
                  <p className="text-xs opacity-60">
                    {branch.isHeadOffice ? 'Merkez Şube' : 'Şube'} · {branch.userCount} kullanıcı · {branch.active?'Aktif':'Pasif'}
                  </p>
                </div>
                {canManageBranches&&<div className="flex gap-1">
                  <button onClick={()=>beginEditBranch(branch)} className="rounded-lg p-2 text-sky-300 hover:bg-sky-500/10" aria-label="Şubeyi düzenle">
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!branch.isHeadOffice&&<button
                    onClick={async () => {
                      if (!confirm(`${branch.code} ${branch.name} silinsin mi? Yalnız hiç veri/işlem bulunmayan şube silinebilir.`)) return;
                      try {
                        await api.deleteBranch(branch.code);
                        await loadBranches();
                        await onBranchConfigurationChanged();
                      } catch (error) {
                        alert(error instanceof Error ? error.message : 'Şube silinemedi.');
                      }
                    }}
                    className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                    aria-label="Boş şubeyi sil"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>}
                </div>}
              </div>
            )}
          </article>
        ))}
      </div>

      {canAssignUserBranches && (
        <div className="rounded-xl border border-slate-700 p-3">
          <h4 className="mb-3 flex items-center gap-2 font-bold">
            <UserRoundCog className="h-4 w-4" /> Kullanıcı – Şube Bazlı Yetkilendirme
          </h4>

          <select
            value={selectedUserId}
            onChange={event => void chooseUser(event.target.value)}
            className="w-full rounded-xl bg-slate-800 px-3 py-2"
          >
            <option value="">Kullanıcı seçin</option>
            {users.map(user => (
              <option key={user.id} value={user.id}>{user.username} — {user.displayName}</option>
            ))}
          </select>

          {selectedUser && (
            <>
              {!selectedUserIsSuperAdmin&&<p className="mt-3 rounded-lg bg-cyan-950/20 p-2 text-xs text-cyan-200 ring-1 ring-cyan-800/50">
                Aynı kullanıcı birden fazla şubede Şube Yetkilisi olabilir. Her şubenin rolü ve ayrıntılı yetkileri bağımsız kaydedilir.
                <span className="ml-2 font-black">Şube Yetkilisi olduğu şube sayısı: {selectedCodes.filter(code=>(roleDraft[code]??'USER')==='BRANCH_MANAGER').length}</span>
              </p>}
              {selectedUserIsSuperAdmin&&<p className="mt-3 rounded-lg bg-violet-950/40 p-2 text-xs text-violet-200 ring-1 ring-violet-700/50">Süper Admin balamir şube ve yetki atamaları korumalıdır; yalnız görüntülenebilir.</p>}
              <div className="mt-3 space-y-2">
                {branches.filter(branch => branch.active).map(branch => {
                  const checked = selectedCodes.includes(branch.code);
                  const expanded = expandedBranch === branch.code;
                  return (
                    <article key={branch.code} className="rounded-xl border border-slate-700 bg-slate-900/35">
                      <div className="flex flex-wrap items-center gap-3 p-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={event => toggleBranch(branch.code, event.target.checked)}
                        />
                        <span className="min-w-0 flex-1 font-semibold">
                          {branch.code} — {branch.name}
                        </span>

                        {checked && (
                          <>
                            <label className="flex items-center gap-1.5 text-xs">
                              <input
                                type="radio"
                                name="primaryBranch"
                                checked={primary === branch.code}
                                onChange={() => setPrimary(branch.code)}
                              />
                              Birincil
                            </label>
                            <button
                              type="button"
                              onClick={() => setExpandedBranch(expanded ? '' : branch.code)}
                              className="action-button secondary-button py-1.5"
                            >
                              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              Yetkiler
                            </button>
                          </>
                        )}
                      </div>

                      {checked && expanded && (
                        <div className="border-t border-slate-700 p-3 space-y-3">
                          <label className="block text-xs font-semibold text-slate-300">
                            Şube Rolü
                            <select
                              value={roleDraft[branch.code] ?? 'USER'}
                              onChange={event=>updateBranchRole(branch.code,event.target.value as BranchRole)}
                              className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-white ring-1 ring-slate-700"
                            >
                              <option value="USER">Standart Kullanıcı</option>
                              <option value="BRANCH_MANAGER">Şube Yetkilisi</option>
                            </select>
                          </label>
                          {(roleDraft[branch.code]??'USER')==='BRANCH_MANAGER'&&<p className="rounded-lg bg-cyan-950/30 p-2 text-xs text-cyan-200 ring-1 ring-cyan-700/50">
                            Şube Yetkilisi başlangıçta bu şubenin operasyon, demirbaş, Network, Dashboard, Help Desk ve şube duyuru yetkilerini tam alır. Rol Şube Yetkilisi olarak kalsa bile bu şubedeki tekil yetkiler Admin tarafından ayrı ayrı azaltılabilir veya artırılabilir; diğer şubelerdeki rol ve yetkiler değişmez.
                          </p>}
                          <p className="text-xs text-slate-400">
                            Standart Kullanıcı ve Şube Yetkilisi için OPERİS ve Help Desk yetkileri bu şubeye özeldir. Aynı kullanıcının başka şubedeki yetkileri bağımsızdır ve ayrı güncellenir.
                          </p>
                          <BranchPermissionEditor
                            value={permissionDraft[branch.code] ?? EMPTY_PERMISSIONS}
                            onChange={permissions => updateBranchPermissions(branch.code, permissions)}
                            protectHeadOfficeAdministration={true}
                          />
                          <HelpDeskPermissionEditor
                            value={helpDeskDraft[branch.code] ?? EMPTY_BRANCH_HELPDESK}
                            onChange={permissions=>updateHelpDeskPermissions(branch.code,permissions)}
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <button
                disabled={busy || selectedUserIsSuperAdmin}
                onClick={() => void saveUserBranches()}
                className="action-button primary-button mt-4 w-full"
              >
                <Save className="h-4 w-4" /> Şube ve Yetkileri Kaydet
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function BranchPermissionEditor({
  value,
  onChange,
  protectHeadOfficeAdministration,
}: {
  value: UserPermissions;
  onChange: (value: UserPermissions) => void;
  protectHeadOfficeAdministration: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Bu ayarlar yalnız bu şube için geçerlidir. Başka bir şubedeki aynı kullanıcıya farklı yetkiler verilebilir.
      </p>

      <SectionEditor title="İşler / Takvim" value={value.tasks} onChange={tasks => onChange({ ...value, tasks })} />
      <SectionEditor title="Bilgiler" value={value.credentials} onChange={credentials => onChange({ ...value, credentials })} />
      <SectionEditor title="Takip" value={value.tracking} onChange={tracking => onChange({ ...value, tracking })} />
      <SectionEditor title="Network İzleme" value={value.network} onChange={network => onChange({ ...value, network })} />

      <fieldset className="rounded-xl border border-slate-700 p-3">
        <legend className="px-2 text-xs font-black uppercase tracking-wide text-cyan-300">Genel / Yönetim</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <Toggle label="Ayarlara erişim" checked={value.canAccessSettings} onChange={checked => onChange({ ...value, canAccessSettings: checked })} />
          <Toggle label="Kullanıcı yönetimi" checked={value.canManageUsers} onChange={checked => onChange({ ...value, canManageUsers: checked })} />
          <Toggle
            label="Şube oluşturma / düzenleme / silme"
            checked={value.canManageBranches}
            disabled={protectHeadOfficeAdministration}
            onChange={checked => onChange({ ...value, canManageBranches: checked })}
          />
          <Toggle
            label="Kullanıcıyı şubeye atama"
            checked={value.canAssignUserBranches}
            disabled={protectHeadOfficeAdministration}
            onChange={checked => onChange({ ...value, canAssignUserBranches: checked })}
          />
          <Toggle
            label="Şube içinde duyuru gönder"
            checked={value.canSendBranchAnnouncements}
            onChange={checked=>onChange({...value,canSendBranchAnnouncements:checked})}
          />
          <Toggle
            label="Demirbaş Yönetimi erişimi"
            checked={value.canAccessAssets}
            onChange={checked => onChange({
              ...value,
              canAccessAssets: checked,
              assets: checked ? value.assets : { ...EMPTY_ASSETS },
            })}
          />
        </div>
      </fieldset>

      {value.canAccessAssets && (
        <fieldset className="rounded-xl border border-slate-700 p-3">
          <legend className="px-2 text-xs font-black uppercase tracking-wide text-cyan-300">Demirbaş Ayrıntılı Yetkiler</legend>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ASSET_ENTRIES.map(([key, label]) => (
              <Toggle
                key={key}
                label={label}
                checked={Boolean(value.assets[key])}
                onChange={checked => onChange({ ...value, assets: { ...value.assets, [key]: checked } })}
              />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function HelpDeskPermissionEditor({
  value,
  onChange,
}: {
  value: BranchHelpDeskPermissions;
  onChange: (value: BranchHelpDeskPermissions) => void;
}) {
  const entries: Array<[keyof BranchHelpDeskPermissions,string]> = [
    ['canOpen','Ticket açma'],
    ['canCoordinate','Koordinasyon'],
    ['canRespond','Ticket cevaplama'],
    ['canViewAll','Şubenin tüm ticketlarını görme'],
    ['canAssign','Ticket atama'],
    ['canChangeStatus','Durum değiştirme'],
    ['canClose','Ticket kapatma'],
    ['canReopen','Kapanan ticketı açma'],
    ['canReport','Help Desk dashboard / rapor'],
    ['canTopics','Kategori / konu yönetimi'],
    ['canCannedReplies','Hazır cevap yönetimi'],
    ['canKnowledge','Bilgi bankası yönetimi'],
  ];
  return (
    <fieldset className="rounded-xl border border-slate-700 p-3">
      <legend className="px-2 text-xs font-black uppercase tracking-wide text-cyan-300">Help Desk Şube Yetkileri</legend>
      <p className="mb-2 text-[11px] text-slate-500">Help Desk aktif/pasif durumu bu rolden bağımsızdır ve yalnız Admin tarafından yönetilir.</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map(([key,label])=>(
          <Toggle
            key={key}
            label={label}
            checked={value[key]}
            onChange={checked=>{
              const next={...value,[key]:checked};
              if(key==='canAssign'&&checked)next.canCoordinate=true;
              if(key==='canViewAll'&&checked)next.canCoordinate=true;
              onChange(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function SectionEditor({
  title,
  value,
  onChange,
}: {
  title: string;
  value: SectionPermissions;
  onChange: (value: SectionPermissions) => void;
}) {
  const entries: Array<[keyof SectionPermissions, string]> = [
    ['canView', 'Görüntüle'],
    ['canCreate', 'Kayıt Ekle'],
    ['canEdit', 'Düzelt'],
    ['canDelete', 'Sil'],
    ['canExcel', 'Excel / Ek İşlem'],
  ];

  return (
    <fieldset className="rounded-xl border border-slate-700 p-3">
      <legend className="px-2 text-xs font-black uppercase tracking-wide text-cyan-300">{title}</legend>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {entries.map(([key, label]) => (
          <Toggle
            key={key}
            label={label}
            checked={value[key]}
            onChange={checked => {
              const next = { ...value, [key]: checked };
              if (key !== 'canView' && checked) next.canView = true;
              if (key === 'canView' && !checked) {
                next.canCreate = false;
                next.canEdit = false;
                next.canDelete = false;
                next.canExcel = false;
              }
              onChange(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-sm ${disabled ? 'opacity-45' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const ASSET_ENTRIES: Array<[keyof AssetPermissions, string]> = [
  ['dashboardView', 'Dashboard gör'],
  ['cardsView', 'Demirbaş kartlarını gör'],
  ['cardsCreate', 'Demirbaş kartı oluştur'],
  ['cardsEdit', 'Demirbaş kartı düzenle'],
  ['cardsDelete', 'Demirbaş kartı sil'],
  ['assignmentsView', 'Zimmetleri gör'],
  ['assignmentsCreate', 'Zimmet oluştur'],
  ['assignmentsReturn', 'Zimmet iadesi'],
  ['transfersView', 'Transferleri gör'],
  ['transfersCreate', 'Transfer oluştur'],
  ['transfersApprove', 'Transfer onayla'],
  ['countsView', 'Sayımları gör'],
  ['countsCreate', 'Sayım başlat'],
  ['countsScan', 'Sayım okut'],
  ['countsReview', 'Sayım kayıtlarını gör'],
  ['countsCorrect', 'Sayım düzelt'],
  ['countsComplete', 'Sayımı tamamla'],
  ['countsApprove', 'Sayım onayla'],
  ['locationsView', 'Kişi / birim / lokasyon gör'],
  ['locationsManage', 'Kişi / birim / lokasyon yönet'],
  ['labelsView', 'Etiketleri gör'],
  ['labelsDesign', 'Etiket tasarla'],
  ['labelsPrint', 'Etiket / QR bas'],
  ['documentsView', 'Evrakları gör'],
  ['documentsPrint', 'Evrak yazdır'],
  ['reportsView', 'Raporları gör'],
  ['reportsExport', 'Rapor dışa aktar'],
  ['integrationsView', 'Harici kaynakları gör'],
  ['integrationsManage', 'Harici kaynak yapılandır'],
];
