import Link from 'next/link';
import { MediaTile } from '../_components/MediaTile';
import { ShowcaseCredits } from '../_components/ShowcaseCredits';
import { SHOWCASE_CLIPS } from '../_lib/showcase';
import { wallShapes, tileClasses } from '../_lib/presetWall';
import { WALL_PRESETS, presetHref, presetCredits, presetTitle, shelfName } from '../_lib/tokens';

/* ─── Preset wall: the real presets, as a bento ─── */

export function PresetWall({ catalog }) {
  const shapes = wallShapes(WALL_PRESETS.length);
  return (
    <section className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <h2 className="vx-display text-[40px] sm:text-[56px] max-w-[14ch]">Templates, priced before you tap.</h2>
        <Link href="/presets" className="text-[15px] font-bold text-vx-fg-body underline decoration-vx-border decoration-2 underline-offset-[6px] hover:text-vx-fg hover:decoration-vx-accent">
          All templates
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 lg:auto-rows-[220px] gap-3">
        {WALL_PRESETS.map((preset, i) => {
          const shape = shapes[i];
          const classes = tileClasses(shape);
          const isHero = shape.kind === 'hero';
          return (
            <MediaTile
              key={preset.id}
              href={presetHref(preset)}
              clip={SHOWCASE_CLIPS[preset.id]}
              className={`block rounded-2xl overflow-hidden ${classes.link}`}
              mediaClassName={classes.media}
              mediaStyle={{ background: preset.bg }}
            >
              <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-transparent" />
              {/* Fixed light ink: this sits on a hardcoded gradient under a
                  black scrim, so theme tokens would read near-black in light
                  theme. Same reasoning as the feature cards. */}
              <div className={`absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 text-left ${isHero ? 'p-5 sm:p-6' : 'p-3'}`}>
                <div className="min-w-0">
                  <div className={`font-black text-white tracking-tight ${isHero ? 'text-3xl sm:text-4xl' : 'text-[15px]'}`}>{presetTitle(preset.name)}</div>
                  <div className={`mt-0.5 text-white/85 truncate ${isHero ? 'text-sm' : 'text-xs'}`}>{preset.model}</div>
                </div>
                <div className={`shrink-0 font-vx-mono font-bold text-[#E4A93C] vx-num ${isHero ? 'text-lg' : 'text-[13px]'}`}>{presetCredits(preset, catalog)} cr</div>
              </div>
            </MediaTile>
          );
        })}
      </div>
      <ShowcaseCredits />
    </section>
  );
}

/* ─── The price list: every live catalog row, itemised ─── */

export const LIST_GROUPS = [
  { kind: 'video', label: 'Video', unit: 'per 5 s clip.' },
  { kind: 'image', label: 'Image', unit: 'per image.' },
  { kind: 'audio', label: 'Audio', unit: 'per clip.' },
];

export function ModelShelf({ catalog }) {
  const groups = LIST_GROUPS
    .map((g) => ({ ...g, rows: catalog.filter((m) => m.kind === g.kind) }))
    .filter((g) => g.rows.length > 0);
  if (groups.length === 0) return null;
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <section id="models" className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      <h2 className="vx-display text-[40px] sm:text-[56px]">The price list.</h2>
      <p className="mt-4 text-lg text-vx-fg-body max-w-[48ch] leading-[1.5]">
        All {total} models, at the credits the button will show. Read live from the catalog.
      </p>
      <div id="shelf" className="mt-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-12 gap-y-12">
        {groups.map((g) => (
          <div key={g.kind}>
            <div className="flex items-baseline justify-between gap-3 border-b-2 border-vx-fg pb-2">
              <h3 className="text-xl font-black">{g.label}</h3>
              <span className="text-[13px] text-vx-fg-muted">{g.unit}</span>
            </div>
            <ul className="mt-2 font-vx-mono text-[14px] vx-num">
              {g.rows.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/app/create?model=${encodeURIComponent(m.id)}`}
                    className="group flex items-baseline gap-2 py-2 text-vx-fg-body hover:text-vx-fg"
                  >
                    <span className="min-w-0 truncate group-hover:underline underline-offset-4">{shelfName(m.name)}</span>
                    {m.gated && <span className="shrink-0 text-[11px] text-vx-money">premium</span>}
                    <span aria-hidden className="vx-leader flex-1" />
                    <span className="shrink-0 font-bold text-vx-money">{m.credits} cr</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-10 text-[14px] text-vx-fg-muted">
        Failed generations refund in full. <Link href="/pricing" className="font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg">Credit packs</Link>
        {' · '}<Link href="/models" className="font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg">Every model</Link>
      </p>
    </section>
  );
}

