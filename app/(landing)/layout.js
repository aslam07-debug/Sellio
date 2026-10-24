import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';

export default function LandingLayout({ children }) {
  return <><a href="#main" className="sr-only focus:not-sr-only focus:block focus:bg-paper focus:p-4">Перейти к содержимому</a><Navbar /><main id="main">{children}</main><Footer /></>;
}
