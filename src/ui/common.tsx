import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div className={cn('flex max-h-[92vh] sm:max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl sm:rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl transition-all', wide ? 'max-w-5xl' : 'max-w-2xl')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 sm:px-5 py-3 bg-zinc-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <div className="sm:hidden w-8 h-1 bg-zinc-600 rounded-full mx-auto -mt-1 mb-1 block" />
            <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-zinc-200">{title}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white active:scale-95 transition" aria-label="Kapat">
            <span className="text-lg leading-none">✕</span>
          </button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-5 overscroll-contain">{children}</div>
      </div>
    </div>
  );
}

export function Btn({ children, onClick, variant = 'default', disabled, className, title, size = 'md' }: { children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean; className?: string; title?: string; size?: 'sm' | 'md' }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
        variant === 'default' && 'border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700',
        variant === 'primary' && 'bg-emerald-500 text-black hover:bg-emerald-400',
        variant === 'danger' && 'border border-red-900/60 bg-red-950/50 text-red-300 hover:bg-red-900/50',
        variant === 'ghost' && 'text-zinc-300 hover:bg-zinc-800',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <span>{label}</span>
        {hint && <span className="font-normal normal-case tracking-normal text-zinc-600">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export const inputCls = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500';

export function Select({ value, onChange, options, disabled }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; disabled?: boolean }[]; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ on, onChange, label, big }: { on: boolean; onChange: (v: boolean) => void; label?: string; big?: boolean }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className={cn('flex items-center gap-2', big && 'w-full justify-between rounded-md border px-3 py-2', big && (on ? 'border-emerald-600/60 bg-emerald-950/40' : 'border-zinc-700 bg-zinc-900'))}>
      {label && <span className={cn('font-semibold', big ? 'text-xs text-zinc-100' : 'text-xs text-zinc-300')}>{label}</span>}
      <span className={cn('inline-flex h-5 w-10 items-center rounded-full border px-0.5 transition', on ? 'border-emerald-400 bg-emerald-500' : 'border-zinc-600 bg-zinc-800')}>
        <span className={cn('h-4 w-4 rounded-full bg-white transition', on ? 'translate-x-5' : 'translate-x-0')} />
      </span>
      {big && <span className={cn('w-8 text-right text-[10px] font-bold', on ? 'text-emerald-400' : 'text-zinc-500')}>{on ? 'ON' : 'OFF'}</span>}
    </button>
  );
}

export function Badge({ children, tone = 'zinc' }: { children: ReactNode; tone?: 'zinc' | 'green' | 'red' | 'amber' | 'blue' }) {
  const map = { zinc: 'bg-zinc-800 text-zinc-300 border-zinc-700', green: 'bg-emerald-950 text-emerald-300 border-emerald-800', red: 'bg-red-950 text-red-300 border-red-800', amber: 'bg-amber-950 text-amber-300 border-amber-800', blue: 'bg-sky-950 text-sky-300 border-sky-800' };
  return <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', map[tone])}>{children}</span>;
}

export function LocalityBadge({ locality }: { locality: 'LOCAL' | 'REMOTE' }) {
  return <Badge tone={locality === 'LOCAL' ? 'green' : 'red'}>{locality}</Badge>;
}

export function Textarea({ value, onChange, rows = 3, placeholder, disabled }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; disabled?: boolean }) {
  return <textarea value={value} rows={rows} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'resize-y leading-relaxed')} />;
}
