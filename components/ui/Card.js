export default function Card({ children, hover = false, className = '', ...props }) {
  return (
    <div {...props} className={`rounded-xl border border-warm bg-paper ${hover ? 'transition-shadow hover:shadow-md' : ''} ${className}`}>
      {children}
    </div>
  );
}
