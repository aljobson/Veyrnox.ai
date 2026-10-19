'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useState } from 'react';
import { Button } from '../Button';
import { AGENT_LIMITS, buildAgentRequest, checkPlan, planSummary, stubModel } from '../../_lib/editorAgentPlan.mjs';
import { transcriptText } from '../../_lib/editorTranscript.mjs';

const EXAMPLES = ['split the first clip at 2 seconds', 'remove the last clip', 'set the volume of the first clip to 40%', 'add the title "Day one"'];
// ADR-0105 slice D, dry run. A stand-in for the model reads the instruction; the plan is checked and shown as a list of steps; nothing changes
// until Apply, which re-checks the plan against the timeline as it is then and lands as ONE undoable edit. No AI is used yet and nothing is sent.
export function AgentPanel({ tl, disabled, apply, onError }) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const [instruction, setInstruction] = useState('');
    const [asked, setAsked] = useState(null);
    const stale = asked && asked.tl !== tl;

    function ask(event) {
        event.preventDefault();
        const request = buildAgentRequest(tl, instruction, transcriptText(tl));
        if (request.error) { setAsked(null); onError?.(request.error); return; }
        const plan = stubModel(request, tl);
        setAsked({ tl, request, plan, result: checkPlan(tl, plan) });
    }
    function applyPlan() {
        const next = apply(current => { const r = checkPlan(current, asked.plan); return r.ok ? r.next : { error: r.error }; });
        if (next) { setAsked(null); setInstruction(''); }
    }
    const result = asked?.result;

    return <section aria-label={t("app.editor.agent.title")} className="space-y-3">
        <h2 className="text-sm font-bold">{t("app.editor.agent.preview")}</h2>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.agent.dryRun")}<strong>{t("app.editor.agent.local")}</strong>{t("app.editor.agent.help")}</p>
        <ul lang="en" dir="ltr" className="list-disc ps-5 text-[11px] text-vx-fg-muted">{EXAMPLES.map(example => <li key={example}>{example}</li>)}</ul>
        <form onSubmit={ask} className="space-y-2">
            <label className="block text-xs">{t("app.editor.agent.question")}<input aria-label={t("app.editor.agent.input")} className="mt-1 w-full rounded border border-vx-border bg-vx-base p-2 text-xs" value={instruction} maxLength={AGENT_LIMITS.maxInstructionChars} disabled={disabled} onChange={e => setInstruction(e.target.value)} /></label>
            <Button size="sm" type="submit" disabled={disabled || !instruction.trim()}>{t("app.editor.agent.show")}</Button>
        </form>
        {asked && <div className="space-y-2" aria-label={t("app.editor.agent.plan")}>
            <p role="status" className="text-xs font-bold">{planSummary(result)}</p>
            {result.ok && <ol aria-label={t("app.editor.agent.steps")} className="list-decimal space-y-1 ps-5 text-xs">{result.steps.map(step => <li key={step.index}>{step.text}{step.destructive && <span className="ms-1 rounded border border-vx-danger px-1 text-[10px] text-vx-danger">{t('app.editor.agent.destructive').trimStart()}</span>}</li>)}</ol>}
            {!!result.skipped.length && <p role="status" className="text-xs text-vx-fg-muted">{t(pluralKey(t, locale, 'app.editor.agent.skipped', result.skipped.length), { count: number(result.skipped.length) })}</p>}
            {stale && <p role="status" className="text-xs">{t("app.editor.agent.stale")}</p>}
            {result.ok && <Button size="sm" disabled={disabled || stale} onClick={applyPlan}>{t(pluralKey(t, locale, 'app.editor.agent.apply', result.steps.length), { count: number(result.steps.length) })}</Button>}
            <details className="text-[11px]"><summary className="cursor-pointer font-bold">{t("app.editor.agent.requestTitle")}</summary>
                <pre aria-label={t("app.editor.agent.request")} className="mt-1 max-h-48 overflow-auto rounded border border-vx-border p-2">{JSON.stringify(asked.request, null, 1)}</pre></details>
        </div>}
    </section>;
}
