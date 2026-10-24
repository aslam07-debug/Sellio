const variants = {
  primary: 'border-primary bg-primary text-paper hover:border-primary-dark hover:bg-primary-dark',
  ghost: 'border-warm bg-paper text-dark hover:bg-panel',
  danger: 'border-danger bg-danger text-paper hover:opacity-90',
  icon: 'border-transparent bg-transparent text-muted hover:text-dark'
};

export default function Button({
  variant = 'primary', loading = false, disabled = false, type = 'button',
  className = '', children, ...props
}) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant] ?? variants.primary} ${className}`}
    >
      {loading && (
        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />
      )}
      {children}
    </button>
  );
}
