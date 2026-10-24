'use client';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import Card from '@/components/ui/Card';
import { statuses } from '@/lib/reportView';
import ChartTooltip from './ChartTooltip';
const colors = ['var(--chart-success)', 'var(--chart-danger)', 'var(--chart-warning)', 'var(--chart-primary)', 'var(--chart-muted)'];
export default function StatusDonut({ count = {}, total = 0 }) {
  const data = Object.entries(statuses).map(([key, name]) => ({ key, name, value: count[key] ?? 0 }));
  return <Card className="min-w-0 p-5"><h2 className="font-bold">Статусы заказов</h2><div className="h-48">{total ? <ResponsiveContainer><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%">{data.map((d, i) => <Cell key={d.key} fill={colors[i]} />)}</Pie><Tooltip content={<ChartTooltip />} /></PieChart></ResponsiveContainer> : <p className="pt-16 text-center text-sm text-muted">Нет заказов</p>}</div><dl className="space-y-2 text-xs">{data.map(d => <div key={d.key} className="flex justify-between gap-2"><dt>{d.name}</dt><dd className="font-inter">{d.value} · {total ? (d.value / total * 100).toFixed(1) : '0'}%</dd></div>)}</dl></Card>;
}
