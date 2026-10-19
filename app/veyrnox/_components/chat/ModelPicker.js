'use client';
import { tOr, pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';

import { useMemo } from 'react';
import { TIERS, makerGroups, tierOf, tierLabel } from '../../_lib/chatModels';


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
  const { t } = useI18n();
  const toggle = (id) => { const next = new Set(tiers); if (next.has(id)) next.delete(id); else next.add(id); onTiers(next); };
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("app.chat.picker.cost")}>
      {TIERS.map((tier) => (
        <button key={tier.id} type="button" aria-pressed={tiers.has(tier.id)} onClick={() => toggle(tier.id)}
          className="flex items-center justify-center gap-2 rounded-lg border border-vx-border px-2 py-1.5 text-sm aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/10">
          {tOr(t, `app.create.tier.${tier.id}`, tier.label)} <Dots count={tier.dots} />
        </button>
      ))}
    </div>
  );
}

export function ModelPicker({ models, model, tiers, busy, onSelect }) {
  const { t, locale } = useI18n();
  const credits = count => t(pluralKey(t, locale, 'app.chat.price', count), { count: locale === 'en' ? count : count.toLocaleString(localeTag(locale)) });
  const groups = useMemo(() => makerGroups(models, tiers, model.id), [models, tiers, model.id]);
  const group = groups.find((g) => g.maker === model.maker) || groups[0];
  const pickMaker = (maker) => { const g = groups.find((x) => x.maker === maker); if (g) onSelect(g.models[0].id); };
  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor="chat-maker">{t("app.chat.picker.family")}</label>
      <select id="chat-maker" disabled={busy} value={group.maker} onChange={(e) => pickMaker(e.target.value)} className={sel}>
        {groups.map((g) => <option key={g.maker} value={g.maker}>{g.label} ({locale === 'en' ? g.models.length : g.models.length.toLocaleString(localeTag(locale))})</option>)}
      </select>
      <label className="sr-only" htmlFor="chat-model">{t("slip.model")}</label>
      <select id="chat-model" disabled={busy} value={model.id} onChange={(e) => onSelect(e.target.value)} className={sel}>
        {group.models.map((m) => <option key={m.id} value={m.id}>{m.name}, {credits(m.credits_per_reply)} ({tOr(t, `app.create.tier.${tierOf(m.credits_per_reply)}`, tierLabel(tierOf(m.credits_per_reply)))})</option>)}
      </select>
    </div>
  );
}
