import Link from 'next/link';
import { MediaTile } from '../_components/MediaTile';
import { PremiumTag } from '../_components/PremiumTag';
import { SHOWCASE_CLIPS, MODEL_SHOWCASE_KEYS } from '../_lib/showcase';
import { modelPriceUnit } from '../_lib/modelPricing';
import {
  WALL_PRESETS,
  LANDING_TEMPLATE_LIMIT,
  LANDING_MODEL_LIMIT,
  templateHref,
  presetCredits,
  presetTitle,
  distinctShelfNames,
} from '../_lib/tokens';
import { rich } from '../../../lib/i18n/rich';
import { getT } from '../../../lib/i18n/server';
import { localizedHref } from '../../../lib/i18n/locales.mjs';

/* ─── Preset wall: the real presets ─── */

export async function PresetWall({ catalog }) {
  const { locale, t } = await getT();
  return (
    <section className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <h2 className="vx-display text-[40px] sm:text-[56px] max-w-[14ch]">{t('home.templates.title')}</h2>
        <Link href={localizedHref(locale, '/presets')} className="text-[15px] font-bold text-vx-fg-body underline decoration-vx-border decoration-2 underline-offset-[6px] hover:text-vx-fg hover:decoration-vx-accent">
          {t('home.templates.all')}
        </Link>
      </div>
      <div className="columns-1 sm:columns-2 lg:columns-4 gap-3 [&>a]:mb-6 [&>a]:break-inside-avoid">
        {WALL_PRESETS.slice(0, LANDING_TEMPLATE_LIMIT).map((preset) => {
          const clip = SHOWCASE_CLIPS[preset.clipKey];
          return (
            <MediaTile
              key={preset.id}
              href={templateHref(preset)}
              ariaLabel={t('home.templates.open', { name: presetTitle(preset.name), n: presetCredits(preset, catalog) })}
              clip={clip && { ...clip, objectFit: 'contain' }}
              imageSizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 25vw"
              className="block text-left w-full"
              mediaClassName="rounded-2xl"
              mediaStyle={{ background: preset.bg, aspectRatio: clip?.aspectRatio || '4 / 5' }}
              footer={
                <div className="pt-3 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-black tracking-tight text-[15px]">{presetTitle(preset.name)}</div>
                    <div className="mt-0.5 text-vx-fg-muted truncate text-xs">{preset.model}</div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-vx-fg-muted">{preset.prompt}</p>
                  </div>
                  <div className="shrink-0 font-vx-mono font-bold text-vx-money vx-num text-[13px]">{presetCredits(preset, catalog)} cr</div>
                </div>
              }
            />
          );
        })}
      </div>
    </section>
  );
}

/* ─── A representative sample of the live price list ─── */

export const LIST_GROUPS = [
  { kind: 'video', label: 'Video', unit: 'per clip; length shown below.' },
  { kind: 'image', label: 'Image', unit: 'per image.' },
  { kind: 'audio', label: 'Audio', unit: 'per clip.' },
];

// The catalog keys for a group's label and unit (the English above is what
// /models prints; the landing page reads these).
const GROUP_KEYS = {
  video: { label: 'home.models.video', unit: 'home.models.unitVideo' },
  image: { label: 'home.models.image', unit: 'home.models.unitImage' },
  audio: { label: 'home.models.audio', unit: 'home.models.unitAudio' },
};

export async function ModelShelf({ catalog }) {
  const { locale, t } = await getT();
  const groups = LIST_GROUPS
    .map((g) => ({ ...g, rows: catalog.filter((m) => m.kind === g.kind) }))
    .filter((g) => g.rows.length > 0)
    .map((g) => ({ ...g, nameOf: distinctShelfNames(g.rows) }));
  if (groups.length === 0) return null;
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <section id="models" className="px-4 sm:px-6 pt-28 sm:pt-36 max-w-[1300px] mx-auto">
      <h2 className="vx-display text-[40px] sm:text-[56px]">{t('home.models.title')}</h2>
      <p className="mt-4 text-lg text-vx-fg-body max-w-[48ch] leading-[1.5]">
        {t('home.models.lead', { total })}
      </p>
      <div id="shelf" className="mt-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-12 gap-y-12">
        {groups.map((g) => {
          const clip = SHOWCASE_CLIPS[MODEL_SHOWCASE_KEYS[g.kind]];
          const representativeRows = [...g.rows]
            .sort((a, b) => Number(Boolean(a.gated)) - Number(Boolean(b.gated)) || a.credits - b.credits)
            .slice(0, LANDING_MODEL_LIMIT);
          return (
            <div key={g.kind}>
              <MediaTile
                href={localizedHref(locale, '/models')}
                ariaLabel={t('home.models.explore', { kind: t(GROUP_KEYS[g.kind].label) })}
                clip={clip && { ...clip, objectFit: 'contain' }}
                imageSizes="(max-width: 767px) 100vw, (max-width: 1279px) 50vw, 33vw"
                className="block mb-4"
                mediaClassName="rounded-2xl"
                mediaStyle={{ aspectRatio: clip?.aspectRatio || '4 / 5' }}
                footer={
                  <div className="pt-3 flex items-baseline justify-between gap-3">
                    <h3 className="text-xl font-black">{t(GROUP_KEYS[g.kind].label)}</h3>
                    <span className="text-[13px] text-vx-fg-body">{t(GROUP_KEYS[g.kind].unit)}</span>
                  </div>
                }
              />
              <ul className="mt-2 font-vx-mono text-[14px] vx-num">
                {representativeRows.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/app/create?model=${encodeURIComponent(m.id)}`}
                      className="group flex items-baseline gap-2 py-2 text-vx-fg-body hover:text-vx-fg"
                    >
                      <span className="min-w-0">
                        <span className="block truncate group-hover:underline underline-offset-4">{g.nameOf(m)}</span>
                        <span className="block text-[11px] text-vx-fg-muted">{modelPriceUnit(m)}</span>
                      </span>
                      {m.gated && <PremiumTag className="shrink-0" />}
                      <span aria-hidden className="vx-leader flex-1" />
                      <span className="shrink-0 font-bold text-vx-money">{m.credits} cr</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-10 text-[14px] text-vx-fg-muted">
        {rich(t('home.models.refund'), {
          packs: <Link href={localizedHref(locale, '/pricing')} className="font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg">{t('home.models.packs')}</Link>,
          every: <Link href={localizedHref(locale, '/models')} className="font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg">{t('home.models.every')}</Link>,
        })}
      </p>
    </section>
  );
}

