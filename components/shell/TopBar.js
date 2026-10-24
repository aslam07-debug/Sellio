import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { usePathname } from 'next/navigation';

export default function TopBar({ stores, storeId, selectStore, period, setPeriod, refresh, menu }) {
  const pathname = usePathname();
  const reports = pathname === '/dashboard' || pathname === '/orders';
  return <header className="flex flex-wrap items-end gap-3 border-b border-warm bg-paper px-4 py-4 sm:px-6">
    <Button id="open-app-menu" variant="ghost" className="lg:hidden" onClick={menu} aria-label="Открыть меню">Меню</Button>
    <label className="min-w-0 flex-1 text-xs font-bold">Магазин<select className="mt-1 block min-h-11 w-full rounded-lg border border-warm bg-surface px-3 text-sm" value={storeId} onChange={e => selectStore(e.target.value)} disabled={!stores.length}><option value="">Выберите магазин</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
    {reports && <div className="grid w-full grid-cols-2 gap-2 sm:w-auto"><Input id="period-start" type="date" label="С даты" value={period.start} onChange={e => setPeriod(p => ({ ...p, start: e.target.value }))} /><Input id="period-end" type="date" label="По дату" value={period.end} onChange={e => setPeriod(p => ({ ...p, end: e.target.value }))} /></div>}
    <span className="py-3 font-inter text-xs text-muted">KZT • Алматы</span><Button variant="ghost" onClick={refresh}>Обновить</Button>
  </header>;
}
