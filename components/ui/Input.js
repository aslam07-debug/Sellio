import { forwardRef } from 'react';

const Input = forwardRef(function Input({ id, label, error, hint, trailing, className = '', ...props }, ref) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-bold leading-4">{label}</label>
      <div className="relative">
        <input
          {...props}
          ref={ref}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`min-h-11 w-full rounded-lg border bg-paper px-4 py-3 font-inter text-sm leading-4 placeholder:text-light focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-panel ${error ? 'border-danger' : 'border-warm'} ${trailing ? 'pr-14' : ''} ${className}`}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-xs text-danger">{error}</p>}
    </div>
  );
});

export default Input;
