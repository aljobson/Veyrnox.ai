'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isUneditedTemplatePrompt, templatePromptHidden } from './templatePromptVisibility.js';
import { fetchPrivateTemplate, isPrivateTemplate } from './privateTemplatePrompt.js';

export { isUneditedTemplatePrompt, templatePromptHidden };

const CREATE_PROMPT = 'textarea[data-assistant-target="create.prompt"]';

/**
 * Hidden until Edit; Edit moves focus to the revealed field. An edited prompt is a custom prompt and is always shown.
 * A private template (templatePromptsPrivate, ADR-0351 amendment 23) has no text in the browser: Edit fetches it for the signed-in
 * caller and hands the whole template to onHydrate, which swaps it and the prompt box in. `status` is 'loading' while it is read
 * and 'error' when it could not be (nothing is revealed then).
 */
export function useTemplatePromptDisplay(template, prompt, field = CREATE_PROMPT, { onHydrate } = {}) {
  const [revealedId, setRevealedId] = useState(null);
  const [status, setStatus] = useState('idle');
  const moveFocus = useRef(false);
  const hidden = templatePromptHidden(template, prompt, revealedId);
  const templateId = template?.id ?? null;
  const needsFetch = isPrivateTemplate(template) && typeof onHydrate === 'function';
  const reveal = useCallback(async () => {
    if (needsFetch) {
      setStatus('loading');
      const full = await fetchPrivateTemplate(templateId);
      if (!full) { setStatus('error'); return; }
      onHydrate(full);
    }
    moveFocus.current = true;
    setStatus('idle');
    setRevealedId(templateId);
  }, [templateId, needsFetch, onHydrate]);
  useEffect(() => {
    if (hidden || !moveFocus.current) return;
    moveFocus.current = false;
    if (field) document.querySelector(field)?.focus();
  }, [hidden, field]);
  return { hidden, status, revealed: revealedId !== null && revealedId === templateId, unedited: isUneditedTemplatePrompt(template, prompt), reveal };
}
