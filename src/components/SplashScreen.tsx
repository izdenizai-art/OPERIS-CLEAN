import { ListTodo } from 'lucide-react';

export default function SplashScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 text-white flex items-center justify-center px-6">
      <div className="flex flex-col items-center text-center animate-splash-in">
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-3xl bg-sky-500/20 blur-xl animate-pulse-soft" />
          <div className="relative w-20 h-20 rounded-3xl bg-sky-500/20 ring-1 ring-sky-500/40 flex items-center justify-center shadow-2xl shadow-sky-950/60">
            <ListTodo className="w-10 h-10 text-sky-400" aria-hidden="true" />
          </div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Az bekle…</h1>
        <p className="mt-2 text-sm text-slate-400">Operis yenileniyor...</p>
        <div className="mt-8 flex items-center gap-2 text-xs text-slate-500" role="status" aria-live="polite">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          Uygulama hazırlanıyor
        </div>
        <footer className="mt-10 text-xs text-slate-500">
          <span className="block">Hazırlayan</span>
          <span className="font-semibold text-slate-300">Balamir Kütan</span>
          <span className="mt-1 block text-[11px] tracking-wide">v6.3.62</span>
        </footer>
      </div>
    </div>
  );
}
