import Link from 'next/link';

export default function ActionLink({ href, secondary = false, children, className = '', ...props }) {
  return <Link {...props} href={href} className={`inline-flex min-h-12 items-center justify-center rounded-lg border px-5 py-3 text-sm font-bold transition-colors ${secondary ? 'border-warm bg-paper text-dark hover:bg-panel' : 'border-primary-dark bg-primary-dark text-paper hover:bg-dark hover:border-dark'} ${className}`}>{children}</Link>;
}
