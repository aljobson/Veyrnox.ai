'use client';

// Muon buttons — pill (999px), cost rides the primary. Aqua = action, Amber = money.
export function Button({ variant = 'primary', size = 'md', cost, children, className = '', ...props }) {
  const base = 'inline-flex items-center gap-3 rounded-full font-muon font-extrabold cursor-pointer transition-colors duration-200 ease-out disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-muon-accent';
  const sizes = { sm: 'text-xs px-4 py-2', md: 'text-sm px-6 py-3', lg: 'text-base px-7 py-4' };
  const variants = {
    primary: 'bg-muon-accent text-muon-accent-ink hover:bg-muon-accent-hover',
    money:   'bg-muon-money  text-muon-money-ink  hover:brightness-110',
    ghost:   'bg-transparent text-muon-fg border border-muon-border hover:border-muon-accent',
    danger:  'bg-muon-danger text-white hover:brightness-110',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      <span>{children}</span>
      {cost != null && (
        <span className="font-muon-mono text-[13px] font-bold muon-num">−{cost} cr</span>
      )}
    </button>
  );
}
