import ActionLink from './ActionLink';

export default function FinalCTA() {
  return <section className="bg-primary-dark text-paper"><div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-8 px-6 py-16 lg:flex-row lg:items-center"><div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-wider">Следующий шаг — ваш магазин</p><h2 className="mt-4 text-3xl font-extrabold sm:text-4xl">Соберите картину заказов.<br />Без лишних обещаний.</h2><p className="mt-5 text-sm leading-7">Создайте аккаунт, подключите Kaspi и запустите импорт после настройки сервера.</p></div><ActionLink href="/register" secondary className="shrink-0">Создать аккаунт</ActionLink></div></section>;
}
