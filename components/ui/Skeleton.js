export default function Skeleton({ className = '' }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-lg bg-warm motion-reduce:animate-none ${className}`} />;
}
