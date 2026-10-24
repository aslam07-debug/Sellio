import AuthAside from './AuthAside';

export default function AuthLayout({ children }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[40%_60%]">
      <AuthAside />
      <section className="flex min-w-0 justify-center px-6 py-10 sm:px-10 lg:px-12 lg:py-16 xl:px-[120px]">
        <div className="min-w-0 w-full max-w-[480px]">{children}</div>
      </section>
    </main>
  );
}
