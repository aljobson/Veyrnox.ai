'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isUneditedTemplatePrompt, templatePromptHidden } from './templatePromptVisibility.js';

export { isUneditedTemplatePrompt, templatePromptHidden };

const CREATE_PROMPT = 'textarea[data-assistant-target="create.prompt"]';

/** Hidden until Edit; Edit moves focus to the revealed field. An edited prompt is a custom prompt and is always shown. */
export function useTemplatePromptDisplay(template, prompt, field = CREATE_PROMPT) {
  const [revealedId, setRevealedId] = useState(null);
  const moveFocus = useRef(false);
  const hidden = templatePromptHidden(template, prompt, revealedId);
  const templateId = template?.id ?? null;
  const reveal = useCallback(() => { moveFocus.current = true; setRevealedId(templateId); }, [templateId]);
  useEffect(() => {
    if (hidden || !moveFocus.current) return;
    moveFocus.current = false;
    if (field) document.querySelector(field)?.focus();
  }, [hidden, field]);
  return { hidden, revealed: revealedId !== null && revealedId === templateId, unedited: isUneditedTemplatePrompt(template, prompt), reveal };
}
