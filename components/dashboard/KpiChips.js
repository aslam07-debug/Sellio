import Card from '@/components/ui/Card';
import { statuses } from '@/lib/reportView';
export default function KpiChips({ summary }) {
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">{[['total', 'Все заказы'], ...Object.entries(statuses)].map(([key, label]) => <Card key={key} className="p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 font-inter text-2xl font-bold">{summary ? key === 'total' ? summary.total : summary.count[key] : '—'}</p></Card>)}</div>;
}
