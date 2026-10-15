import { useState } from 'react';
import { HELP_TARGETS } from '../../../lib/productHelp.js';
import { IMAGE_WALKTHROUGH, nextImageStep } from '../../../lib/imageWalkthrough.js';

export default function ImageWalkthrough({ onPoint, onStop, onActiveChange }) {
  const [index, setIndex] = useState(-1);
  const [stepNumber, setStepNumber] = useState(0);
  const [error, setError] = useState('');
  const step = IMAGE_WALKTHROUGH[index];

  function advance() {
    if (index === 0 && document.querySelector(HELP_TARGETS['create.models'].selector)?.getAttribute('data-selected-kind') !== 'image') {
      setError('Choose an IMAGE model before continuing.');
      onPoint('create.models');
      return;
    }
    const visibleTargets = IMAGE_WALKTHROUGH.filter(({ target }) => {
      const element = document.querySelector(HELP_TARGETS[target].selector);
      return element?.getClientRects().length && element.getBoundingClientRect().height > 0;
    }).map(({ target }) => target);
    const next = nextImageStep(index, visibleTargets);
    if (next.missing) {
      setError('This control is not available yet. Wait for the workspace to load, then try again.');
      return;
    }
    setError('');
    if (next.complete) {
      setIndex(-1);
      onActiveChange(false);
      onStop();
      return;
    }
    setIndex(next.index);
    setStepNumber(index < 0 ? 1 : stepNumber + 1);
    onActiveChange(true);
    onPoint(next.step.target, { focus: !!next.step.focus, align: 'start' });
  }

  if (!step) return (
    <button type="button" onClick={advance} className="mb-4 w-full rounded-xl border border-vx-accent/40 bg-vx-accent/10 px-3 py-3 text-left text-sm font-bold text-vx-accent">
      Start image walkthrough
    </button>
  );

  return (
    <section aria-label="Image walkthrough" className="mb-4 rounded-xl border border-vx-accent/40 bg-vx-accent/5 p-4">
      <p className="font-vx-mono text-[10px] uppercase tracking-wide text-vx-accent">Image walkthrough · Step {stepNumber}</p>
      <h3 className="mt-1 text-sm font-bold">{step.title}</h3>
      <p role="status" className="mt-2 text-sm leading-6 text-vx-fg-body">{step.message}</p>
      {error && <p role="alert" className="mt-2 text-sm text-vx-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onPoint(step.target, { focus: !!step.focus, align: 'start' })} className="rounded-full border border-vx-border px-3 py-2 text-xs font-semibold">Show this step</button>
        <button type="button" onClick={advance} className="rounded-full bg-vx-accent px-4 py-2 text-xs font-extrabold text-vx-accent-ink">{index === IMAGE_WALKTHROUGH.length - 1 ? 'Finish walkthrough' : 'Next step'}</button>
        <button type="button" onClick={() => { setIndex(-1); setError(''); onActiveChange(false); onStop(); }} className="rounded-full px-3 py-2 text-xs text-vx-fg-muted">End tour</button>
      </div>
    </section>
  );
}
