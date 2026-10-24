import { money } from '@/lib/reportView';
export default function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border border-warm bg-paper p-3 text-xs text-dark shadow-xs"><p className="font-bold">{label ?? payload[0]?.name}</p>{payload.map((p, i) => <p key={i} className="mt-1 font-inter">{p.name}: {p.dataKey === 'amount' ? money(p.value) : p.value}</p>)}</div>;
}
