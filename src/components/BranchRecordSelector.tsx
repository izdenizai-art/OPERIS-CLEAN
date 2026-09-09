import type { BranchInfo } from '@/lib/types';

interface Props {
  branches: BranchInfo[];
  value: string;
  onChange: (branchCode: string) => void;
  disabled?: boolean;
  className?: string;
}

export function defaultRecordBranch(branches: BranchInfo[], existingBranchCode = ''): string {
  if (existingBranchCode && branches.some(branch => branch.code === existingBranchCode)) return existingBranchCode;
  return branches.length === 1 ? branches[0].code : '';
}

export default function BranchRecordSelector({ branches, value, onChange, disabled = false, className = '' }: Props) {
  const singleBranch = branches.length === 1;
  const effectiveValue = singleBranch ? branches[0]?.code ?? '' : value;

  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.08em] text-slate-400">
        Kayıt Şubesi
      </span>

      {singleBranch ? (
        <div className="branch-record-selector branch-record-selector-locked">
          <span className="branch-record-code">{branches[0].code}</span>
          <span className="min-w-0 flex-1 truncate">{branches[0].name}</span>
          <span className="text-[10px] font-bold uppercase opacity-60">Otomatik</span>
        </div>
      ) : (
        <select
          required
          value={effectiveValue}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
          className="branch-record-selector w-full"
        >
          <option value="">Kayıt yapılacak şubeyi seçin</option>
          {branches.map(branch => (
            <option key={branch.code} value={branch.code}>
              {branch.code} — {branch.name}
            </option>
          ))}
        </select>
      )}

      {!singleBranch && !disabled && (
        <span className="mt-1 block text-[10px] text-slate-500">
          Yalnız yetkili olduğunuz şubeler seçilebilir.
        </span>
      )}
    </label>
  );
}
