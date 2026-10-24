import Hero from '@/components/landing/Hero';
import { TrustStrip, Comparison, HowItWorks, UseCases } from '@/components/landing/Sections';
import Features from '@/components/landing/Features';
import Demo from '@/components/landing/Demo';
import Calculator from '@/components/landing/Calculator';
import Pricing from '@/components/landing/Pricing';
import FAQ from '@/components/landing/FAQ';
import FinalCTA from '@/components/landing/FinalCTA';

export const metadata = {
  title: 'Заказы Kaspi без лишних таблиц',
  description: 'Sellio: импорт заказов Kaspi за 14 дней, аналитика по городам, CSV и ручной учёт остатков. Посмотрите демо на синтетических данных.'
};

export default function HomePage() {
  return <><Hero /><TrustStrip /><Comparison /><Features /><HowItWorks /><Demo /><UseCases /><Calculator /><Pricing /><FAQ /><FinalCTA /></>;
}
