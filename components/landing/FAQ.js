import { faqs } from './model';

export default function FAQ() {
  return <section id="faq" className="scroll-mt-6 border-t border-warm bg-paper"><div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-16 sm:py-20 lg:grid-cols-[1fr_1.7fr]"><div><p className="text-xs font-bold uppercase tracking-wider text-primary-dark">До подключения</p><h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">Вопросы?<br />Ответим по делу.</h2><p className="mt-5 text-sm leading-7 text-muted">Что уже работает, что нужно настроить и чего пока нет.</p></div><div>{faqs.map(([question, answer]) => <details key={question} className="group border-b border-warm py-5"><summary className="cursor-pointer text-base font-bold leading-6 marker:text-primary-dark">{question}</summary><p className="mt-4 pl-4 text-sm leading-7 text-muted">{answer}</p></details>)}</div></div></section>;
}
