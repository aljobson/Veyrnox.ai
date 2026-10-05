'use client';
import { useId, useState } from 'react';
import { CostFilter, Dots, ModelPicker } from './ModelPicker';
import { tierLabel, tierOf } from '../../_lib/chatModels';

const credits = (n) => `${n} Credit${n === 1 ? '' : 's'}`;
// About three words for every four tokens, rounded to ten, from the model's own reply cap.
const words = (tokens) => Math.round(((tokens || 1024) * 0.75) / 10) * 10;
const SECTIONS = ['filter', 'model', 'caps', 'tools', 'prompt', 'about'];
const NOT_YET = ['Code interpreter', 'Shell', 'Files', 'Charts', 'Deep research'];

function Section({ id, title, open, onToggle, children }) {
  const uid = useId();
  return (
    <section className="rounded-xl border border-vx-border bg-vx-panel">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={`${uid}-${id}`} onClick={() => onToggle(id)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold">
          {title}<span aria-hidden="true" className="text-vx-fg-muted">{open ? '▴' : '▾'}</span>
        </button>
      </h3>
      {open && <div id={`${uid}-${id}`} className="space-y-3 px-4 pb-4 text-sm">{children}</div>}
    </section>
  );
}

function Toggle({ label, extra, checked, disabled, onChange, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-vx-accent">
      <input type="checkbox" className="mt-1 accent-[var(--vx-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1">
        <span className="font-semibold">{label}</span> <span className="font-vx-mono text-xs text-vx-money vx-num">+{credits(extra)}</span>
        <span className="block text-vx-fg-muted">{hint}</span>
      </span>
    </label>
  );
}

// Everything that shapes the next reply, in one place: which model, what it may do, and its instructions. Nothing here is
// sent until the person sends a message, and the price of the choices always shows under the message box.
export function SettingsPanel({ models, model, busy, onSelectModel, tiers, onTiers, offer, opts, onOpts, canSaveInstr, instr, onInstr, instrSaved, onSaveInstr, saved, maxPrompt, hasThread }) {
  const [open, setOpen] = useState({ filter: false, model: true, caps: true, tools: false, prompt: false, about: false });
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const allOpen = SECTIONS.every((id) => open[id]);
  const tier = tierOf(model.credits_per_reply);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3" aria-label="Chat settings" role="region">
      <Section id="filter" title="Model filter" open={open.filter} onToggle={toggle}>
        <p className="text-vx-fg-muted">Show only models at these prices per reply. Pick none to see them all.</p>
        <CostFilter tiers={tiers} onTiers={onTiers} />
      </Section>

      <Section id="model" title="Model" open={open.model} onToggle={toggle}>
        <ModelPicker models={models} model={model} tiers={tiers} busy={busy} onSelect={onSelectModel} />
      </Section>

      <Section id="caps" title="Capabilities" open={open.caps} onToggle={toggle}>
        {offer.thinking
          ? <Toggle label="Thinking" extra={offer.thinking.extra_credits} checked={opts.thinking} disabled={busy} onChange={(v) => onOpts({ ...opts, thinking: v })}
              hint="Let the model reason step by step before it answers. Slower, and better on hard questions." />
          : <p className="text-vx-fg-muted">This model does not offer Thinking.</p>}
        {offer.images
          ? <p><span className="font-semibold">Images</span> <span className="font-vx-mono text-xs text-vx-money vx-num">+{credits(offer.images.extra_credits)}</span>
              <span className="block text-vx-fg-muted">Attach pictures with the paperclip. The extra applies only to replies that include images.</span></p>
          : <p className="text-vx-fg-muted">This model cannot read images.</p>}
      </Section>

      <Section id="tools" title="Tools" open={open.tools} onToggle={toggle}>
        {offer.web
          ? <Toggle label="Web search" extra={offer.web.extra_credits} checked={opts.web} disabled={busy} onChange={(v) => onOpts({ ...opts, web: v })}
              hint="Search the web and answer with sources." />
          : <p className="text-vx-fg-muted">This model does not offer Web search.</p>}
        <div>
          <p className="font-semibold">Not available yet</p>
          <ul className="mt-1 list-disc pl-5 text-vx-fg-muted">{NOT_YET.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </Section>

      <Section id="prompt" title="System prompt" open={open.prompt} onToggle={toggle}>
        <label htmlFor="chat-instr" className="sr-only">Instructions for this chat</label>
        <textarea id="chat-instr" value={instr} maxLength={maxPrompt} onChange={(e) => onInstr(e.target.value)}
          placeholder="For example: answer in plain English and keep it short."
          className="min-h-28 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-vx-fg placeholder:text-vx-fg-faint" />
        <div className="flex items-center gap-3">
          {hasThread ? (
            <button type="button" disabled={!canSaveInstr} onClick={onSaveInstr}
              className="rounded-full bg-vx-accent px-4 py-1.5 font-semibold text-vx-accent-ink disabled:opacity-50">Save</button>
          ) : <span className="text-vx-fg-muted">Used from your first message.</span>}
          {saved && <span role="status" className="text-vx-accent">Saved</span>}
          <span className="ml-auto font-vx-mono text-vx-fg-muted vx-num">{instr.length}/{maxPrompt}</span>
        </div>
      </Section>

      <Section id="about" title="About this model" open={open.about} onToggle={toggle}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-vx-fg-muted">Model</dt><dd>{model.name}</dd>
          <dt className="text-vx-fg-muted">Family</dt><dd>{model.maker_label}</dd>
          <dt className="text-vx-fg-muted">Price</dt>
          <dd><span className="font-vx-mono vx-num">{credits(model.credits_per_reply)}</span> per reply <Dots count={['low', 'medium', 'high'].indexOf(tier) + 1} /> <span className="text-vx-fg-muted">{tierLabel(tier)}</span></dd>
          <dt className="text-vx-fg-muted">Reply length</dt><dd>Up to about {words(model.max_reply_tokens)} words</dd>
          <dt className="text-vx-fg-muted">Thinking</dt><dd>{offer.thinking ? `+${credits(offer.thinking.extra_credits)}` : 'Not offered'}</dd>
          <dt className="text-vx-fg-muted">Web search</dt><dd>{offer.web ? `+${credits(offer.web.extra_credits)}` : 'Not offered'}</dd>
          <dt className="text-vx-fg-muted">Images</dt><dd>{offer.images ? `+${credits(offer.images.extra_credits)}` : 'Not offered'}</dd>
        </dl>
        <p className="text-vx-fg-muted">The price is fixed per reply. It shows before you send, and a failed reply returns the Credits.</p>
      </Section>

      <div className="mt-auto flex gap-2 pt-1">
        <button type="button" disabled={busy} onClick={() => { onTiers(new Set()); onOpts({ thinking: false, web: false }); }}
          className="flex-1 rounded-lg border border-vx-border px-3 py-2 text-sm hover:border-vx-accent disabled:opacity-50">Reset all</button>
        <button type="button" onClick={() => setOpen(Object.fromEntries(SECTIONS.map((id) => [id, !allOpen])))}
          className="flex-1 rounded-lg border border-vx-border px-3 py-2 text-sm hover:border-vx-accent">{allOpen ? 'Close all' : 'Open all'}</button>
      </div>
    </div>
  );
}
