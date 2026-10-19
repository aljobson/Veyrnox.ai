'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { useId, useState } from 'react';
import { CostFilter, Dots, ModelPicker } from './ModelPicker';
import { tierLabel, tierOf } from '../../_lib/chatModels';
import { PersonaPicker } from './PersonaPicker';

function credits(t, locale, n) { return t(pluralKey(t, locale, 'app.chat.settings.credits', n), { count: locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale)) }); }
// About three words for every four tokens, rounded to ten, from the model's own reply cap.
const words = (tokens) => Math.round(((tokens || 1024) * 0.75) / 10) * 10;
const SECTIONS = ['persona', 'filter', 'model', 'caps', 'tools', 'prompt', 'about'];
const NOT_YET = ['code', 'shell', 'files', 'charts', 'research'];

function Section({ id, title, open, onToggle, children }) {
  const uid = useId();
  return (
    <section className="rounded-xl border border-vx-border bg-vx-panel">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={`${uid}-${id}`} onClick={() => onToggle(id)}
          className="flex w-full items-center justify-between px-4 py-3 text-start text-sm font-semibold">
          {title}<span aria-hidden="true" className="text-vx-fg-muted">{open ? '▴' : '▾'}</span>
        </button>
      </h3>
      {open && <div id={`${uid}-${id}`} className="space-y-3 px-4 pb-4 text-sm">{children}</div>}
    </section>
  );
}

function Toggle({ label, extra, checked, disabled, onChange, hint }) {
  const { t, locale } = useI18n();
  return (
    <label className="flex cursor-pointer items-start gap-3 has-focus-visible:outline-solid has-focus-visible:outline-2 has-focus-visible:outline-vx-accent">
      <input type="checkbox" className="mt-1 accent-[var(--vx-accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1">
        <span className="font-semibold">{label}</span> <span className="font-vx-mono text-xs text-vx-money vx-num">+{credits(t, locale, extra)}</span>
        <span className="block text-vx-fg-muted">{hint}</span>
      </span>
    </label>
  );
}

// Everything that shapes the next reply, in one place: which model, what it may do, and its instructions. Nothing here is
// sent until the person sends a message, and the price of the choices always shows under the message box.
export function SettingsPanel({ models, model, busy, onSelectModel, tiers, onTiers, offer, opts, onOpts, researchOn = false, canSaveInstr, instr, onInstr, instrSaved, onSaveInstr, saved, maxPrompt, hasThread, personasOn = false, personas = [], personaId = '', onPersona, onManagePersonas }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState({ persona: true, filter: false, model: true, caps: true, tools: true, prompt: false, about: false });
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const allOpen = SECTIONS.every((id) => open[id]);
  const tier = tierOf(model.credits_per_reply);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3" data-assistant-target="chat.settings" aria-label={t("label.Chat settings")} role="region">
      {personasOn && (
        <Section id="persona" title={t("app.chat.settings.persona")} open={open.persona} onToggle={toggle}>
          <p className="text-vx-fg-muted">{hasThread ? t("app.chat.settings.personaExisting") : t("app.chat.settings.personaNew")}</p>
          <PersonaPicker personas={personas} value={personaId} disabled={busy || hasThread} onSelect={onPersona} onManage={onManagePersonas} />
        </Section>
      )}

      <Section id="filter" title={t("app.chat.settings.filter")} open={open.filter} onToggle={toggle}>
        <p className="text-vx-fg-muted">{t("app.chat.settings.filterHelp")}</p>
        <CostFilter tiers={tiers} onTiers={onTiers} />
      </Section>

      <Section id="model" title={t("pricing.col.model")} open={open.model} onToggle={toggle}>
        <ModelPicker models={models} model={model} tiers={tiers} busy={busy} onSelect={onSelectModel} />
      </Section>

      <Section id="caps" title={t("app.chat.settings.capabilities")} open={open.caps} onToggle={toggle}>
        {offer.thinking
          ? <Toggle label={t("app.chat.settings.thinking")} extra={offer.thinking.extra_credits} checked={opts.thinking && !researchOn} disabled={busy || researchOn} onChange={(v) => onOpts({ ...opts, thinking: v, research: false })}
              hint={researchOn ? t('app.chat.settings.researchPrice') : t('app.chat.settings.thinkingHelp')} />
          : <p className="text-vx-fg-muted">{t("app.chat.settings.noThinking")}</p>}
        {offer.images
          ? <p><span className="font-semibold">{t("app.library.kind.image")}</span> <span className="font-vx-mono text-xs text-vx-money vx-num">+{credits(t, locale, offer.images.extra_credits)}</span>
              <span className="block text-vx-fg-muted">{t("app.chat.settings.imagesHelp")}</span></p>
          : <p className="text-vx-fg-muted">{t("app.chat.settings.noImages")}</p>}
      </Section>

      <Section id="tools" title={t("tools.meta.title")} open={open.tools} onToggle={toggle}>
        {offer.web
          ? <Toggle label={t("app.chat.settings.web")} extra={offer.web.extra_credits} checked={opts.web && !researchOn} disabled={busy || researchOn} onChange={(v) => onOpts({ ...opts, web: v, research: false })}
              hint={researchOn ? t('app.chat.settings.researchSearch') : t('app.chat.settings.webHelp')} />
          : <p className="text-vx-fg-muted">{t("app.chat.settings.noWeb")}</p>}
        {offer.research && (
          <Toggle label={t("app.chat.settings.research")} extra={offer.research.extra_credits} checked={researchOn} disabled={busy} onChange={(v) => onOpts({ thinking: false, web: false, research: v })}
            hint={t('app.chat.settings.researchHelp')} />
        )}
        <div>
          <p className="font-semibold">{t("app.chat.settings.notYet")}</p>
          <ul className="mt-1 list-disc ps-5 text-vx-fg-muted">{NOT_YET.filter((tool) => !(tool === 'research' && offer.research)).map((tool) => <li key={tool}>{t(tool === 'research' ? 'app.chat.settings.research' : `app.chat.settings.tool.${tool}`)}</li>)}</ul>
        </div>
      </Section>

      <Section id="prompt" title={t("app.chat.settings.prompt")} open={open.prompt} onToggle={toggle}>
        <label htmlFor="chat-instr" className="sr-only">{t("app.chat.settings.instructions")}</label>
        <textarea id="chat-instr" value={instr} maxLength={maxPrompt} onChange={(e) => onInstr(e.target.value)}
          placeholder={t("app.chat.settings.example")}
          className="min-h-28 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-vx-fg placeholder:text-vx-fg-faint" />
        <div className="flex items-center gap-3">
          {hasThread ? (
            <button type="button" disabled={!canSaveInstr} onClick={onSaveInstr}
              className="rounded-full bg-vx-accent px-4 py-1.5 font-semibold text-vx-accent-ink disabled:opacity-50">{t("app.publish.inbox.save")}</button>
          ) : <span className="text-vx-fg-muted">{t("app.chat.settings.firstMessage")}</span>}
          {saved && <span role="status" className="text-vx-accent">{t("cinema.socialCinema.saved")}</span>}
          <span className="ms-auto font-vx-mono text-vx-fg-muted vx-num">{locale === 'en' ? instr.length : instr.length.toLocaleString(localeTag(locale))}/{locale === 'en' ? maxPrompt : maxPrompt.toLocaleString(localeTag(locale))}</span>
        </div>
      </Section>

      <Section id="about" title={t("app.chat.settings.about")} open={open.about} onToggle={toggle}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-vx-fg-muted">{t("pricing.col.model")}</dt><dd>{model.name}</dd>
          <dt className="text-vx-fg-muted">{t("app.chat.settings.family")}</dt><dd>{model.maker_label}</dd>
          <dt className="text-vx-fg-muted">{t("publish.plan.rowPrice")}</dt>
          <dd><span className="font-vx-mono vx-num">{credits(t, locale, model.credits_per_reply)}</span>{' '}{t("app.chat.settings.perReply")}{' '}<Dots count={['low', 'medium', 'high'].indexOf(tier) + 1} /> <span className="text-vx-fg-muted">{tOr(t, `app.create.tier.${tier}`, tierLabel(tier))}</span></dd>
          <dt className="text-vx-fg-muted">{t("app.chat.settings.replyLength")}</dt><dd>{t(pluralKey(t, locale, 'app.chat.settings.words', words(model.max_reply_tokens)), { count: locale === 'en' ? String(words(model.max_reply_tokens)) : words(model.max_reply_tokens).toLocaleString(localeTag(locale)) })}</dd>
          <dt className="text-vx-fg-muted">{t("app.chat.settings.thinking")}</dt><dd>{offer.thinking ? `+${credits(t, locale, offer.thinking.extra_credits)}` : t("app.chat.settings.notOffered")}</dd>
          <dt className="text-vx-fg-muted">{t("app.chat.settings.web")}</dt><dd>{offer.web ? `+${credits(t, locale, offer.web.extra_credits)}` : t("app.chat.settings.notOffered")}</dd>
          <dt className="text-vx-fg-muted">{t("app.library.kind.image")}</dt><dd>{offer.images ? `+${credits(t, locale, offer.images.extra_credits)}` : t("app.chat.settings.notOffered")}</dd>
        </dl>
        <p className="text-vx-fg-muted">{t("app.chat.settings.priceHelp")}</p>
      </Section>

      <div className="mt-auto flex gap-2 pt-1">
        <button type="button" disabled={busy} onClick={() => { onTiers(new Set()); onOpts({ thinking: false, web: false, research: false }); }}
          className="flex-1 rounded-lg border border-vx-border px-3 py-2 text-sm hover:border-vx-accent disabled:opacity-50">{t("app.chat.settings.resetAll")}</button>
        <button type="button" onClick={() => setOpen(Object.fromEntries(SECTIONS.map((id) => [id, !allOpen])))}
          className="flex-1 rounded-lg border border-vx-border px-3 py-2 text-sm hover:border-vx-accent">{allOpen ? t("app.chat.settings.closeAll") : t("app.chat.settings.openAll")}</button>
      </div>
    </div>
  );
}
