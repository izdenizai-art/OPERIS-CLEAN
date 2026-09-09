export default function SectionLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <span className="w-5 h-5 rounded-full border-2 border-slate-700 border-t-sky-400 animate-spin" />
        Bölüm yükleniyor
      </div>
    </div>
  );
}
