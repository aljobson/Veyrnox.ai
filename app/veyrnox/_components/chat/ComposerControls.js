'use client';
import { optionsForReplyMode, REPLY_MODES, replyMode } from '../../_lib/chatComposer';

const credits = (n) => `${n} Credit${n === 1 ? '' : 's'}`;
const control = 'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-vx-border bg-vx-base px-3 text-xs font-semibold text-vx-fg-muted transition-colors hover:border-vx-accent hover:text-vx-fg focus-within:border-vx-accent focus-within:outline-solid focus-within:outline-2 focus-within:outline-vx-accent disabled:opacity-50';

function Chevron() {
  return <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>;
}

function ModelIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2" /><path d="M5 1.5v2M11 1.5v2M5 6.5h.01M11 6.5h.01M5.5 10h5" /></svg>;
}

function ModeIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M8 1.5 9.4 6.6 14.5 8l-5.1 1.4L8 14.5 6.6 9.4 1.5 8l5.1-1.4L8 1.5Z" /></svg>;
}

function WebIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M2.5 8h11M8 2c1.7 1.6 2.5 3.6 2.5 6S9.7 12.4 8 14C6.3 12.4 5.5 10.4 5.5 8S6.3 3.6 8 2Z" /></svg>;
}

function LibraryIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2" /><circle cx="5.25" cy="5.75" r="1" /><path d="m3.5 11 3-3 2.2 2.1 1.5-1.5 2.3 2.4" /></svg>;
}

function SelectControl({ label, ariaLabel, value, disabled, onChange, children, icon }) {
  return (
    <label className={`${control} ${disabled ? 'opacity-50' : ''}`}>
      {icon}
      <span className="max-w-36 truncate text-vx-fg">{label}</span>
      <Chevron />
      <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed">
        {children}
      </select>
    </label>
  );
}

export function ComposerControls({ models, model, offer, opts, busy, onSelectModel, onOpts, onLibrary, libraryDisabled }) {
  const mode = replyMode(opts);
  const modeLabel = mode === REPLY_MODES.RESEARCH ? 'Deep research' : mode === REPLY_MODES.THINKING ? 'Thinking' : 'Standard';

  return (
    <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-3 py-2" role="group" aria-label="Reply setup">
      <SelectControl label={model.name} ariaLabel="Model for next reply" value={model.id} disabled={busy} onChange={onSelectModel} icon={<ModelIcon />}>
        {models.map((item) => <option key={item.id} value={item.id}>{item.name} · {credits(item.credits_per_reply)}</option>)}
      </SelectControl>

      {(offer.thinking || offer.research) && (
        <SelectControl label={modeLabel} ariaLabel="Response mode" value={mode} disabled={busy} onChange={(next) => onOpts(optionsForReplyMode(next, opts))} icon={<ModeIcon />}>
          <option value={REPLY_MODES.STANDARD}>Standard</option>
          {offer.thinking && <option value={REPLY_MODES.THINKING}>Thinking · +{credits(offer.thinking.extra_credits)}</option>}
          {offer.research && <option value={REPLY_MODES.RESEARCH}>Deep research · +{credits(offer.research.extra_credits)}</option>}
        </SelectControl>
      )}

      {offer.web && (
        <button type="button" aria-pressed={opts.web && !opts.research} disabled={busy || opts.research}
          onClick={() => onOpts({ ...opts, web: !opts.web, research: false })}
          className={`${control} aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.08] aria-pressed:text-vx-accent`}>
          <WebIcon /> Web <span className="font-vx-mono text-[10px] text-vx-money">+{offer.web.extra_credits}</span>
        </button>
      )}

      {offer.images && (
        <button type="button" onClick={onLibrary} disabled={busy || libraryDisabled} className={control}
          title={libraryDisabled ? 'The most images for one reply' : 'Use an image you already made'}>
          <LibraryIcon /> Library
        </button>
      )}
    </div>
  );
}
