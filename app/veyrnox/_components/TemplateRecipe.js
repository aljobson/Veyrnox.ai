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
  return (
    <>
      <h2 className="mt-8 font-vx-mono text-[11px] tracking-[0.12em] text-vx-fg-muted">PROMPT</h2>
      <textarea aria-label="Template prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} rows={8}
        className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-[15px] leading-[1.55] text-vx-fg-body focus:outline-hidden focus:border-vx-accent" />
      <CopyPrompt text={prompt} label="Copy prompt" />
      <p className="mt-3 text-[13px] text-vx-fg-muted">{generatedPreview ? 'The preview was generated using this prompt and an original starting image. Your image and model results can vary.' : preset.inspired ? 'Adapted for the model below to create similar content with your image. Results vary with each image and generation.' : 'Edit it here or in the studio before generating.'}</p>
      {preset.steps && (
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-vx-fg-body">
          {preset.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
      <UseTemplate preset={preset} prompt={prompt} />
    </>
  );
}
