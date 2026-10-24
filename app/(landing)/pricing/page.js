import Pricing from '@/components/landing/Pricing';
import FAQ from '@/components/landing/FAQ';
import FinalCTA from '@/components/landing/FinalCTA';

export const metadata = {
  title: 'Тарифы',
  description: 'Стартовый тариф Sellio: 0 ₸. Цены Про и Бизнес ожидают подтверждения. Выбор тарифа не активирует платный доступ.'
};

export default function PricingPage() {
  return <><Pricing standalone /><FAQ /><FinalCTA /></>;
}
