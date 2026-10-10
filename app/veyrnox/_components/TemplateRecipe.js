'use client';

import { useState } from 'react';
import { UseTemplate } from './UseTemplate';

function CopyPrompt({ text, label }) {
  const [status, setStatus] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
    } catch {
      setStatus('Select the prompt text and copy it manually.');
    }
  }
  return (
    <div className="mt-3">
      <button type="button" onClick={copy} className="vx-press rounded-full border border-vx-border px-4 py-2 text-sm font-bold hover:border-vx-fg-muted">{label}</button>
      <span role="status" className="ml-3 text-sm text-vx-fg-muted">{status}</span>
    </div>
  );
}

export function TemplateRecipe({ preset, generatedPreview = false }) {
  const [prompt, setPrompt] = useState(preset.prompt);
  const original = preset.sourceRecipe;
  return (
    <>
      <h2 className="mt-8 font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">{original ? 'VEYRNOX REMIX PROMPT' : 'PROMPT'}</h2>
      <textarea aria-label="Template prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} rows={8}
        className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-[15px] leading-[1.55] text-vx-fg-body focus:outline-hidden focus:border-vx-accent" />
      <CopyPrompt text={prompt} label="Copy prompt" />
      <p className="mt-3 text-[13px] text-vx-fg-muted">{generatedPreview ? 'The preview was generated using this prompt and an original starting image. Your image and model results can vary.' : original ? 'Adapted for the model below to create similar content with your image. The preview shows the source effect.' : 'Edit it here or in the studio before generating.'}</p>
      {preset.steps && (
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-vx-fg-body">
          {preset.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
      <UseTemplate preset={preset} prompt={prompt} />
      {original && (
        <details className="mt-8 rounded-xl border border-vx-border p-4">
          <summary className="cursor-pointer font-bold">Original recipe and references</summary>
          <div className="mt-4 text-sm text-vx-fg-body">
            <p>{original.prompt ? 'Published source prompt, preserved with its reference labels. Use the source setup below for the full sequence.' : 'The source uses an effect workflow whose internal prompt is not public. The Veyrnox remix prompt above is our adaptation.'}</p>
            {original.prompt && (
              <>
                <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-vx-panel p-3 font-sans text-sm leading-relaxed" tabIndex={0}>{original.prompt}</pre>
                <CopyPrompt text={original.prompt} label="Copy original prompt" />
              </>
            )}
            <dl className="mt-4 space-y-2">
              <div><dt className="font-bold">Source workflow</dt><dd>{original.model || 'Named effect workflow'}</dd></div>
              {original.durationSeconds > 0 && <div><dt className="font-bold">Full sequence duration</dt><dd>{Math.round(original.durationSeconds * 10) / 10}s</dd></div>}
              {original.settings.resolution && <div><dt className="font-bold">Resolution</dt><dd>{original.settings.resolution}</dd></div>}
              {original.settings.aspect_ratio && <div><dt className="font-bold">Format</dt><dd>{original.settings.aspect_ratio}</dd></div>}
              {original.settings.mode && <div><dt className="font-bold">Mode</dt><dd>{original.settings.mode}</dd></div>}
              {original.settings.quality && <div><dt className="font-bold">Quality</dt><dd>{original.settings.quality}</dd></div>}
              {typeof original.settings.generate_audio === 'boolean' && <div><dt className="font-bold">Audio</dt><dd>{original.settings.generate_audio ? 'On' : 'Off'}</dd></div>}
              {typeof original.settings.camera_fixed === 'boolean' && <div><dt className="font-bold">Camera</dt><dd>{original.settings.camera_fixed ? 'Fixed' : 'Movement allowed'}</dd></div>}
              {original.settings.output_format && <div><dt className="font-bold">Output format</dt><dd>{original.settings.output_format}</dd></div>}
            </dl>
            <ul className="mt-4 space-y-2">
              {original.inputs.filter((input) => input.kind !== 'text').map((input) => (
                <li key={input.slot}><span className="font-bold">{input.slot}:</span> {input.role}{input.providedBySource ? ' (supplied reference)' : input.required ? ' (you provide)' : ' (optional)'}</li>
              ))}
            </ul>
            {original.references.length > 0 && <ul className="mt-4 space-y-2">
              {original.references.map((reference) => <li key={reference.slot}><a href={reference.url} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-4">Open supplied {reference.slot} {reference.kind} reference</a></li>)}
            </ul>}
            <a href={original.url} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block font-bold underline underline-offset-4">Open the source template</a>
          </div>
        </details>
      )}
    </>
  );
}
