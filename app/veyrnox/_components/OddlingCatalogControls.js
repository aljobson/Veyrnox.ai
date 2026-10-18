'use client';

import { characterOptionLabel } from '../_lib/characterOptions';
import { CATEGORY_ICONS, SLIDER_SCALES, SWATCHES, sliderPosition, sliderValue, tileFocus, tileKind } from '../_lib/oddlingCatalog';
import { hairTileSrc } from '../_lib/oddlingHairTiles';
import { OddlingMannequin } from './OddlingMannequin';

const legend = 'font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-fg-muted';
const tileBase = 'group relative flex min-w-0 flex-col items-center overflow-hidden rounded-xl border bg-vx-base text-center transition-colors';
const tileTone = (on) => (on ? 'border-vx-accent bg-vx-accent/[0.07]' : 'border-vx-border hover:border-vx-fg/30');

/** Colour groups: a swatch per option, plus Any. */
export function SwatchGroup({ group, value, onChange }) {
  const table = SWATCHES[group.id];
  return (
    <fieldset className="space-y-2">
      <legend className={legend}>{group.label}<span className="ml-2 normal-case tracking-normal text-vx-fg">{value ? characterOptionLabel(group.id, value) : 'Any'}</span></legend>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onChange(group.id, '')} aria-pressed={!value} aria-label={`${group.label}: Any`}
          className={`grid h-9 w-9 place-items-center rounded-full border font-vx-mono text-[9px] font-bold ${!value ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg-muted'}`}>Any</button>
        {group.options.map(([name]) => (
          <button key={name} type="button" onClick={() => onChange(group.id, name)} aria-pressed={value === name} aria-label={`${group.label}: ${characterOptionLabel(group.id, name)}`} title={characterOptionLabel(group.id, name)}
            className={`h-9 w-9 rounded-full border-2 ${value === name ? 'border-vx-accent ring-2 ring-vx-accent/40' : 'border-vx-border'}`} style={{ background: table[name]?.swatch }} />
        ))}
      </div>
    </fieldset>
  );
}

/** Ordered groups: one slider. Position 0 is Any. */
export function SliderGroup({ group, picks, onChange }) {
  const scale = SLIDER_SCALES[group.id];
  const position = sliderPosition(group.id, picks);
  const value = picks?.[group.id];
  const text = value ? characterOptionLabel(group.id, value) : 'Any';
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`catalog-${group.id}`} className={legend}>{group.label}</label>
        <span className="font-vx-mono text-[11px] font-bold text-vx-fg">{text}</span>
      </div>
      <input id={`catalog-${group.id}`} type="range" min={0} max={scale.length} step={1} value={position} aria-valuetext={text}
        onChange={(event) => onChange(group.id, sliderValue(group.id, event.target.value))} className="w-full accent-[rgb(var(--vx-accent))]" />
      <div className="flex justify-between font-vx-mono text-[9px] text-vx-fg-faint" aria-hidden="true"><span>Any</span><span>{scale[0]}</span><span>{scale.at(-1)}</span></div>
    </div>
  );
}

/** Everything else: a grid of tiles. Hair shows a picture of the style when it has one; hair without a picture, outfit, body and headwear draw the option on the figure; the rest show a plain icon tile. */
export function TileGroup({ group, picks, value, onChange, categoryId }) {
  const drawn = tileKind(group.id) === 'mannequin';
  const focus = tileFocus(group.id);
  const icon = CATEGORY_ICONS[categoryId];
  return (
    <fieldset className="space-y-2">
      <legend className={legend}>{group.label}<span className="ml-2 normal-case tracking-normal text-vx-fg">{value ? characterOptionLabel(group.id, value) : 'Any'}</span></legend>
      <div className={`grid gap-2 ${focus === 'face' ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-4'}`}>
        <button type="button" onClick={() => onChange(group.id, '')} aria-pressed={!value} className={`${tileBase} ${tileTone(!value)} justify-center px-1 py-3`}>
          <span className="grid h-10 w-10 place-items-center rounded-full border border-dashed border-vx-border font-vx-mono text-[9px] text-vx-fg-muted" aria-hidden="true">Any</span>
          <span className="mt-1 text-[10px] font-bold text-vx-fg-muted">None picked</span>
        </button>
        {group.options.map(([name]) => {
          const on = value === name;
          const picture = group.id === 'hair' ? hairTileSrc(name) : '';
          return (
            <button key={name} type="button" onClick={() => onChange(group.id, name)} aria-pressed={on} className={`${tileBase} ${tileTone(on)}`}>
              <span className={`flex w-full items-end justify-center bg-vx-panel px-1 pt-1 ${focus === 'face' ? 'h-28' : 'h-20'}`}>
                {picture
                  ? <img src={picture} alt="" width={256} height={256} loading="lazy" decoding="async" className="h-full w-full rounded-md object-cover" />
                  : drawn
                  ? <OddlingMannequin picks={{ ...picks, [group.id]: name }} focus={focus} />
                  : <span className="mb-3 grid h-11 w-11 place-items-center rounded-full border border-vx-border text-vx-fg-muted" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg></span>}
              </span>
              <span className={`w-full truncate border-t px-1 py-1.5 text-[10px] font-bold ${on ? 'border-vx-accent/30 text-vx-accent' : 'border-vx-border text-vx-fg-muted'}`}>{characterOptionLabel(group.id, name)}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
