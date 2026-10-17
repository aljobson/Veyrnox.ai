'use client';
import { useState } from 'react';
import { Button } from '../Button';
import { AGENT_LIMITS, buildAgentRequest, checkPlan, planSummary, stubModel } from '../../_lib/editorAgentPlan.mjs';
import { transcriptText } from '../../_lib/editorTranscript.mjs';

const EXAMPLES = ['split the first clip at 2 seconds', 'remove the last clip', 'set the volume of the first clip to 40%', 'add the title "Day one"'];
// ADR-0105 slice D, dry run. A stand-in for the model reads the instruction; the plan is checked and shown as a list of steps; nothing changes
// until Apply, which re-checks the plan against the timeline as it is then and lands as ONE undoable edit. No AI is used yet and nothing is sent.
export function AgentPanel({ tl, disabled, apply, onError }) {
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

    return <section aria-label="Editing assistant" className="space-y-3">
        <h2 className="text-sm font-bold">Editing assistant (preview)</h2>
        <p className="text-xs text-vx-fg-muted">A dry run. A simple built-in stand-in reads what you type; <strong>no AI is used and nothing is sent anywhere yet</strong>. It understands only the phrases below. It shows you a list of steps, and nothing changes until you press Apply. Apply is one edit, so one Undo reverts all of it.</p>
        <ul className="list-disc pl-5 text-[11px] text-vx-fg-muted">{EXAMPLES.map(example => <li key={example}>{example}</li>)}</ul>
        <form onSubmit={ask} className="space-y-2">
            <label className="block text-xs">What should change?
                <input aria-label="What should change" className="mt-1 w-full rounded border border-vx-border bg-vx-base p-2 text-xs" value={instruction} maxLength={AGENT_LIMITS.maxInstructionChars} disabled={disabled} onChange={e => setInstruction(e.target.value)} /></label>
            <Button size="sm" type="submit" disabled={disabled || !instruction.trim()}>Show the steps</Button>
        </form>
        {asked && <div className="space-y-2" aria-label="Plan">
            <p role="status" className="text-xs font-bold">{planSummary(result)}</p>
            {result.ok && <ol aria-label="Steps" className="list-decimal space-y-1 pl-5 text-xs">{result.steps.map(step => <li key={step.index}>{step.text}{step.destructive && <span className="ml-1 rounded border border-vx-danger px-1 text-[10px] text-vx-danger">removes a clip</span>}</li>)}</ol>}
            {!!result.skipped.length && <p role="status" className="text-xs text-vx-fg-muted">Skipped {result.skipped.length} {result.skipped.length === 1 ? 'step' : 'steps'} that this editor does not allow.</p>}
            {stale && <p role="status" className="text-xs">The timeline changed since these steps were made. Show the steps again.</p>}
            {result.ok && <Button size="sm" disabled={disabled || stale} onClick={applyPlan}>{`Apply ${result.steps.length} ${result.steps.length === 1 ? 'step' : 'steps'}`}</Button>}
            <details className="text-[11px]"><summary className="cursor-pointer font-bold">Exactly what would be sent to a model</summary>
                <pre aria-label="Request that would be sent" className="mt-1 max-h-48 overflow-auto rounded border border-vx-border p-2">{JSON.stringify(asked.request, null, 1)}</pre></details>
        </div>}
    </section>;
}
