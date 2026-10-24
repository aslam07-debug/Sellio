import Card from '@/components/ui/Card';
import { money } from '@/lib/reportView';
export default function FinancialCards({ data }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
    ['Сумма завершённых заказов', money(data?.value), 'Не выплата Kaspi; только известные суммы завершённых заказов.'],
    ['Комиссия', 'Нет данных', 'Нет модели комиссии. Доставка продавца не равна комиссии.'],
    ['Чистая прибыль', 'Нет данных', 'Нет себестоимости, рекламы и расчётов.'],
    ['Средний чек', money(data?.average), `Только завершённые заказы с суммой: ${data?.priced ?? '—'}.`]
  ].map(([label, value, hint]) => <Card key={label} className="p-5"><p className="text-xs font-bold text-muted">{label}</p><p className="mt-3 break-words font-inter text-xl font-bold">{value}</p><p className="mt-3 text-xs leading-5 text-muted">{hint}</p></Card>)}</div>;
}
