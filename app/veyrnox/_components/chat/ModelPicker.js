'use client';
import { useMemo } from 'react';
import { TIERS, makerGroups, tierOf, tierLabel } from '../../_lib/chatModels';

const credits = (n) => `${n} Credit${n === 1 ? '' : 's'}`;
const sel = 'w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm text-vx-fg disabled:opacity-60';

/** Three filled or empty dots: how much a reply costs, as a picture. Decorative; the words carry the meaning. */
export function Dots({ count }) {
  return (
    <span aria-hidden="true" className="inline-flex gap-0.5 align-middle">
      {[1, 2, 3].map((i) => <span key={i} className={`h-1.5 w-3 rounded-full ${i <= count ? 'bg-vx-money' : 'bg-vx-border'}`} />)}
    </span>
  );
}

// The cost filter narrows the list; the maker is the first choice and the model the second. The model in use always stays listed.
export function CostFilter({ tiers, onTiers }) {
  const toggle = (id) => { const next = new Set(tiers); if (next.has(id)) next.delete(id); else next.add(id); onTiers(next); };
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Filter models by cost per reply">
      {TIERS.map((t) => (
        <button key={t.id} type="button" aria-pressed={tiers.has(t.id)} onClick={() => toggle(t.id)}
          className="flex items-center justify-center gap-2 rounded-lg border border-vx-border px-2 py-1.5 text-sm aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/10">
          {t.label} <Dots count={t.dots} />
        </button>
      ))}
    </div>
  );
}

export function ModelPicker({ models, model, tiers, busy, onSelect }) {
  const groups = useMemo(() => makerGroups(models, tiers, model.id), [models, tiers, model.id]);
  const group = groups.find((g) => g.maker === model.maker) || groups[0];
  const pickMaker = (maker) => { const g = groups.find((x) => x.maker === maker); if (g) onSelect(g.models[0].id); };
  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor="chat-maker">Model family</label>
      <select id="chat-maker" disabled={busy} value={group.maker} onChange={(e) => pickMaker(e.target.value)} className={sel}>
        {groups.map((g) => <option key={g.maker} value={g.maker}>{g.label} ({g.models.length})</option>)}
      </select>
      <label className="sr-only" htmlFor="chat-model">Model</label>
      <select id="chat-model" disabled={busy} value={model.id} onChange={(e) => onSelect(e.target.value)} className={sel}>
        {group.models.map((m) => <option key={m.id} value={m.id}>{m.name}, {credits(m.credits_per_reply)} ({tierLabel(tierOf(m.credits_per_reply))})</option>)}
      </select>
    </div>
  );
}
