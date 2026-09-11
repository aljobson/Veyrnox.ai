'use client';

// Veyrnox buttons — pill (999px), cost rides the primary. Aqua = action, Amber = money.
export function Button({ variant = 'primary', size = 'md', cost, children, className = '', ...props }) {
  const base = 'inline-flex items-center gap-3 rounded-full font-vx font-extrabold cursor-pointer transition-colors duration-200 ease-out disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent';
  const sizes = { sm: 'text-xs px-4 py-2', md: 'text-sm px-6 py-3', lg: 'text-base px-7 py-4' };
  const variants = {
    primary: 'bg-vx-accent text-vx-accent-ink hover:bg-vx-accent-hover',
    money:   'bg-vx-money  text-vx-money-ink  hover:brightness-110',
    ghost:   'bg-transparent text-vx-fg border border-vx-border hover:border-vx-accent',
    danger:  'bg-vx-danger text-white hover:brightness-110',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      <span>{children}</span>
      {cost != null && (
        <span className="font-vx-mono text-[13px] font-bold vx-num">−{cost} cr</span>
      )}
    </button>
  );
}
