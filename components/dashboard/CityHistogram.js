'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import Card from '@/components/ui/Card';
import ChartTooltip from './ChartTooltip';
export default function CityHistogram({ data = [] }) {
  return <Card className="min-w-0 p-5"><h2 className="font-bold">Заказы по городам</h2><p className="mt-1 text-xs text-muted">Включая неизвестный город; доля от всех заказов.</p><div className="mt-3 h-56">{data.length ? <ResponsiveContainer><BarChart layout="vertical" data={data.slice(0, 6)}><XAxis type="number" allowDecimals={false} hide /><YAxis dataKey="label" type="category" width={110} tick={{ fontSize: 10 }} stroke="var(--chart-muted)" /><Tooltip content={<ChartTooltip />} /><Bar dataKey="value" name="Заказы" fill="var(--chart-primary)" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer> : <p className="pt-16 text-center text-sm text-muted">Нет данных</p>}</div><details className="text-xs"><summary className="cursor-pointer text-primary-dark">Все города ({data.length})</summary>{data.map(d => <p key={d.label} className="mt-2">{d.label}: {d.value} · {d.percent.toFixed(1)}%</p>)}</details></Card>;
}
