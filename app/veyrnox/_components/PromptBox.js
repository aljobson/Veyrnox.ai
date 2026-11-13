'use client';
import { DictateButton, EnhanceButton, appendSpoken } from './PromptTools';

// The one prompt box every studio uses: a bordered field with a toolbar under it (dictate, optional
// "improve with the Prompt writer", then whatever the studio passes as children: option chips, and a primary action with ms-auto).
// It takes the same props as a <textarea>, so a studio swaps it in without changing its handlers.
export function PromptBox({ value = '', onChange, maxLength, disabled = false, enhance = false, rows = 4, className = 'mt-2', children, ...rest }) {
  const dictated = (spoken) => {
    const next = appendSpoken(value, spoken);
    onChange?.({ target: { value: maxLength ? next.slice(0, maxLength) : next } });
  };
  return (
    <div className={`rounded-2xl border border-vx-field bg-vx-panel focus-within:border-vx-accent ${className}`}>
      <textarea {...rest} value={value} onChange={onChange} maxLength={maxLength} disabled={disabled} rows={rows}
        className="block w-full resize-none bg-transparent p-3.5 text-sm text-vx-fg outline-hidden placeholder:text-vx-fg-faint disabled:opacity-60" />
      <div className="flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-vx-border/60 bg-vx-base/40 px-2 py-1.5">
        <span className="flex items-center gap-1">
          <DictateButton disabled={disabled} onText={dictated} />
          {enhance && <EnhanceButton disabled={disabled} text={value} />}
        </span>
        {children}
      </div>
    </div>
  );
}
