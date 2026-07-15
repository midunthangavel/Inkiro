// src/components/ink.jsx — Inkiro shared primitives (web)
import { useLanguage } from '../hooks/useLanguage';

export function InkCard({ children, className = '', tone = 'elev', style, ...rest }) {
  const bg = { elev: 'bg-paper-elev', sunk: 'bg-paper-sunk', plain: 'bg-paper' }[tone] || 'bg-paper-elev';
  return (
    <div className={`rounded-[18px] border border-hair ${bg} ${className}`} style={style} {...rest}>
      {children}
    </div>
  );
}

export function InkButton({ children, variant = 'accent', size = 'md', full = false, disabled, className = '', ...rest }) {
  const V = {
    accent: 'bg-accent text-paper-elev hover:opacity-90',
    ghost:  'bg-paper-elev border border-hair-strong text-ink hover:bg-paper-sunk',
    mint:   'bg-mint text-paper-elev hover:opacity-90',
    rose:   'bg-rose text-paper-elev hover:opacity-90',
    dark:   'bg-ink text-paper hover:opacity-90',
  }[variant] || 'bg-accent text-paper-elev';
  const S = { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2', lg: 'text-base px-5 py-3' }[size];
  return (
    <button
      disabled={disabled}
      className={`rounded-full font-semibold transition inline-flex items-center justify-center gap-2 ${V} ${S} ${full ? 'w-full' : ''} ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function InkPill({ children, color = 'ink', className = '' }) {
  const P = {
    ink:    'bg-ink text-paper',
    accent: 'bg-accent-soft text-accent-ink',
    mint:   'bg-mint-soft text-mint',
    rose:   'bg-rose-soft text-rose',
    amber:  'bg-amber-soft text-amber',
    sky:    'bg-sky-soft text-sky',
  }[color] || 'bg-ink text-paper';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${P} ${className}`}>
      {children}
    </span>
  );
}

export function Tamil({ children, size = 13, className = '', style }) {
  const { lang } = useLanguage();
  if (lang === 'en') return null;
  return (
    <span className={`font-tamil text-ink-soft block mt-0.5 ${className}`} style={{ fontSize: size, ...style }}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, color = 'ink', hint, className = '' }) {
  const tone = { ink: 'text-ink', mint: 'text-mint', rose: 'text-rose', amber: 'text-amber' }[color] || 'text-ink';
  return (
    <div className={`rounded-[14px] border border-hair bg-paper-elev p-3 ${className}`}>
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">{label}</div>
      <div className={`font-mono text-2xl font-extrabold mt-0.5 ${tone}`}>{value}</div>
      {hint && <div className="text-[11px] text-ink-muted mt-1">{hint}</div>}
    </div>
  );
}

export function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  const cycle = () => setLang(lang === 'en' ? 'ta' : lang === 'ta' ? 'both' : 'en');
  const label = lang === 'en' ? 'EN' : lang === 'ta' ? 'த' : 'EN/த';
  return (
    <button onClick={cycle} className="bg-paper-elev rounded-full px-3 py-1 border border-hair text-xs font-bold text-ink hover:bg-paper-sunk">
      {label}
    </button>
  );
}
