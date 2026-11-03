'use client';
import { useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { VEY_CHARACTER_IDS } from '../../../lib/veyCharacterChoice';

const label = (id) => id.charAt(0).toUpperCase() + id.slice(1);

// The menu fills the helper panel's body (the panel is the positioned ancestor), so its small height cannot clip it.
// A small "change character" control in the helper header; names are the characters' own, so they are not translated.
export default function VeyCharacterPicker({ character, onPick }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const title = t('public.vey.character');
  return <div>
    <button type="button" onClick={() => setOpen(v => !v)} aria-label={title} title={title} aria-expanded={open}
      className="min-h-8 min-w-8 shrink-0 rounded-full text-xs text-vx-fg-muted hover:text-vx-fg focus-visible:outline-2 focus-visible:outline-vx-accent">
      <span aria-hidden="true">☺</span>
    </button>
    {open && <ul role="listbox" aria-label={title}
      className="absolute inset-x-1 bottom-1 top-9 z-10 grid grid-cols-4 content-start gap-1 overflow-y-auto rounded-lg border border-vx-border bg-vx-panel p-1.5 shadow-xl">
      {VEY_CHARACTER_IDS.map(id => <li key={id} role="presentation">
        <button type="button" role="option" aria-selected={id === character}
          onClick={() => { onPick(id); setOpen(false); }}
          className={`min-h-8 w-full rounded-md px-1 text-[10px] font-semibold focus-visible:outline-2 focus-visible:outline-vx-accent ${id === character ? 'bg-vx-accent text-white' : 'text-vx-fg-muted hover:text-vx-fg'}`}>
          {label(id)}
        </button>
      </li>)}
    </ul>}
  </div>;
}
