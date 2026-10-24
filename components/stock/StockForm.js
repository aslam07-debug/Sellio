'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import useMutation from '@/components/shell/useMutation';
import { validPrice, validUnits } from '@/lib/stockData';

export default function StockForm({ session, storeId, row, action = 'add', close, saved }) {
  const mutation = useMutation(session);
  const [sku, setSku] = useState(''), [model, setModel] = useState('');
  const [quantity, setQuantity] = useState(''), [price, setPrice] = useState(row?.price === null || !row ? '' : String(row.price));
  const [available, setAvailable] = useState(true), [confirmed, setConfirmed] = useState(false), [validation, setValidation] = useState('');
  const submit = event => {
    event.preventDefault(); setValidation('');
    const baseStock = quantity.trim() ? Number(quantity) : NaN, localPrice = price.trim() ? Number(price) : NaN;
    if ((action === 'add' || action === 'rebase') && !validUnits(baseStock) || (action === 'add' || action === 'set-price') && !validPrice(localPrice)) { setValidation('Введите допустимые числа. Остаток — целые ед. 0–1 млрд; цена — 0–1 трлн ₸.'); return; }
    if (action === 'add' && (!sku.trim() || !model.trim()) || action === 'rebase' && !confirmed) { setValidation('Заполните поля и подтвердите действие.'); return; }
    const input = action === 'add' ? { storeId, sku, model, baseStock, price: localPrice, available } : { storeId, id: row.id, expectedUpdatedAt: row.updatedAt, ...(action === 'rebase' ? { baseStock, confirmed } : { price: localPrice }) };
    mutation.run(action === 'add' ? '/api/stock' : `/api/stock/${action}`, input, saved);
  };
  return <Card className="p-5 sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-primary-dark">Только Sellio</p><h2 className="mt-2 text-xl font-extrabold">{action === 'add' ? 'Добавить товар вручную' : action === 'rebase' ? 'Новый физический остаток' : 'Изменить локальную цену'}</h2>{row && <p className="mt-1 break-words font-inter text-sm text-muted">{row.sku} · {row.model}</p>}</div><Button variant="ghost" onClick={close} disabled={mutation.busy}>Закрыть</Button></div>
    <form onSubmit={submit} className="mt-5 space-y-4">
      <fieldset disabled={mutation.busy} className="grid min-w-0 gap-4 sm:grid-cols-2"><legend className="sr-only">Локальные данные товара</legend>
        {action === 'add' && <><Input id="stock-sku" label="Ваш SKU / код продавца" value={sku} onChange={e => setSku(e.target.value)} maxLength={100} required hint="Не код каталога Kaspi. Введите собственный код." /><Input id="stock-model" label="Название товара" value={model} onChange={e => setModel(e.target.value)} maxLength={200} required /></>}
        {action !== 'set-price' && <Input id="stock-baseline" label="Физический остаток, ед." type="number" min="0" max="1000000000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required />}
        {action !== 'rebase' && <Input id="stock-price" label="Локальная цена, ₸" type="number" min="0" max="1000000000000" step="any" value={price} onChange={e => setPrice(e.target.value)} required />}
        {action === 'add' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)} className="h-4 w-4 accent-primary" />Активен в Sellio</label>}
        {action === 'rebase' && <label className="flex items-start gap-3 text-sm leading-6 sm:col-span-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />Подтверждаю измеренный физический остаток. Сохранение заменит базовый остаток и обнулит sold_since_base. История заказов не изменится; отменить автоматически нельзя.</label>}
      </fieldset>
      <p className="text-xs leading-5 text-muted">Ед. — ваша ручная единица учёта без метаданных Kaspi. Цена и активность не публикуются в Kaspi. Автоматическое списание по заказам ещё не настроено.</p>
      {(validation || mutation.error) && <p role="alert" className="rounded-lg bg-danger/5 p-3 text-sm text-danger">{validation || mutation.error}{mutation.error && ' При конфликте закройте форму и обновите список.'}</p>}
      <Button type="submit" loading={mutation.busy} disabled={action === 'rebase' && !confirmed}>Сохранить в Sellio</Button>
    </form>
  </Card>;
}
