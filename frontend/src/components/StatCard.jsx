import { createElement, isValidElement } from 'react';
import { ArrowUpRight, ArrowDownRight, Minus, Sparkles } from 'lucide-react';

function TrendPill({ trend }) {
  const { delta, invert = false, suffix = '' } = trend;
  if (delta === null || delta === undefined || Number.isNaN(delta)) return null;
  const flat = delta === 0;
  const up = delta > 0;
  const good = flat ? null : invert ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const tone = flat ? 'bg-slate-100 text-slate-500' : good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700';
  return <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tone}`}><Icon size={11} />{Math.abs(delta)}{suffix}</span>;
}

export default function StatCard({ label, value, sub, icon, tone = 'brand', trend, onClick }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-800 ring-brand-100',
    accent: 'bg-amber-50 text-amber-800 ring-amber-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
    sky: 'bg-sky-50 text-sky-700 ring-sky-100',
    cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`group card flex items-start gap-3.5 w-full text-left ${onClick ? 'cursor-pointer card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2' : ''}`}
    >
      <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ring-1 ${tones[tone] || tones.brand}`}>
        {isValidElement(icon) ? icon : typeof icon === 'string' ? icon : icon ? createElement(icon, { size: 18 }) : <Sparkles size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 truncate">{label}</p>
            <p className="metric-number text-2xl mt-0.5 truncate">{value}</p>
          </div>
          {trend && <TrendPill trend={trend} />}
        </div>
        {sub && <p className="text-[11px] text-slate-400 mt-1 truncate">{sub}</p>}
      </div>
    </Tag>
  );
}
