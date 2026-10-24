import Card from '@/components/ui/Card';
import { orderDate, money, statuses } from '@/lib/reportView';
export default function ActivityFeed({ data = [] }) {
  return <Card className="p-5"><h2 className="font-bold">Последние импортированные заказы</h2><p className="mt-1 text-xs text-muted">По дате создания в Kaspi, не лента событий.</p><ul className="mt-4 divide-y divide-warm">{data.map(o => <li key={o.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><p className="font-inter font-semibold">№ {o.code}</p><p className="mt-1 text-xs text-muted">{orderDate(o.creationDate)} · {o.city}</p></div><div className="text-right"><p className="font-inter">{money(o.totalPrice)}</p><p className="mt-1 text-xs text-primary-dark">{statuses[o.bucket]}</p></div></li>)}</ul>{!data.length && <p className="py-6 text-sm text-muted">Нет заказов</p>}</Card>;
}
