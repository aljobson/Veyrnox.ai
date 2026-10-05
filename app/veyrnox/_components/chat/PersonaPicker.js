'use client';

// Choose a persona for the chat about to start (ADR-0072). It fills the model, the options and the instructions; the person can change any of them.
export function PersonaPicker({ personas, value, disabled, onSelect, onManage }) {
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="chat-persona">Persona</label>
      <select id="chat-persona" disabled={disabled || personas.length === 0} value={value} onChange={(e) => onSelect(e.target.value)}
        className="min-w-0 max-w-[200px] truncate rounded-lg border border-vx-border bg-vx-base px-3 py-1.5 text-sm text-vx-fg disabled:opacity-60">
        <option value="">{personas.length ? 'No persona' : 'No personas yet'}</option>
        {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" onClick={onManage} className="rounded-full border border-vx-border px-3 py-1.5 text-sm">Personas</button>
    </div>
  );
}
