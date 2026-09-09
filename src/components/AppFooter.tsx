interface Props {
  version?: string;
  compact?: boolean;
}

export default function AppFooter({ version = 'v6.3.62', compact = false }: Props) {
  return (
    <footer className={`${compact ? 'py-1.5' : 'mt-auto pt-8 pb-1'} text-center text-[10px] leading-tight app-footer`}>
      <span className="balamir-signature font-semibold">BalamirK.</span>
      <span className="ml-2 text-[9px] tracking-wide text-zinc-600">{version}</span>
    </footer>
  );
}
