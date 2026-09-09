import { ShieldAlert } from 'lucide-react';

export default function LicenseBlockedScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-red-500/50 bg-zinc-950 p-8 text-center shadow-2xl shadow-red-950/40">
        <ShieldAlert className="mx-auto h-16 w-16 text-red-500" />
        <p className="mt-6 text-sm font-black tracking-[0.32em] text-red-400">UYARI</p>
        <h1 className="mt-3 text-3xl font-black">ERİŞİM REDDEDİLDİ</h1>
        <p className="mt-5 text-base font-semibold text-zinc-300">Lütfen sistem yöneticiniz ile iletişime geçiniz.</p>
      </section>
    </div>
  );
}
