'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '../../../components/I18nProvider';
import { tOr } from '../../../lib/i18n/translate.mjs';

export const ENHANCE_HANDOFF_KEY = 'veyrnox_enhance_prompt';
const button = 'grid h-9 w-9 shrink-0 place-items-center rounded-full text-vx-fg-muted transition-colors hover:text-vx-fg disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:w-11';

function recognitionClass() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// Dictation with the browser's own speech recognition: no upload, no credits. Hidden where unsupported.
export function DictateButton({ onText, disabled = false }) {
  const { t, locale } = useI18n();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef(null);
  // Support is a browser fact known only after mount.
  useEffect(() => { setSupported(Boolean(recognitionClass())); return () => recognition.current?.abort?.(); }, []);
  if (!supported) return null;
  const label = tOr(t, listening ? 'app.promptTools.stopDictation' : 'app.promptTools.dictate', listening ? 'Stop dictation' : 'Dictate your prompt');
  const toggle = () => {
    if (listening) { recognition.current?.stop(); return; }
    const Recognition = recognitionClass();
    const next = new Recognition();
    next.lang = document.documentElement.lang || locale || 'en';
    next.interimResults = false;
    next.continuous = true;
    next.onresult = (event) => {
      let said = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) if (event.results[i].isFinal) said += event.results[i][0].transcript;
      if (said.trim()) onText(said.trim());
    };
    next.onend = () => setListening(false);
    next.onerror = () => setListening(false);
    recognition.current = next;
    try { next.start(); setListening(true); } catch { setListening(false); }
  };
  return (
    <button type="button" disabled={disabled} aria-pressed={listening} aria-label={label} title={label} onClick={toggle}
      className={`${button} ${listening ? 'bg-vx-danger/15 text-vx-danger' : ''}`}>
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="7.5" y="2.5" width="5" height="9" rx="2.5" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" /></svg>
    </button>
  );
}

// Opens the Prompt writer skill in chat with the prompt so far. The text travels in session storage, not the address bar.
export function EnhanceButton({ text, disabled = false }) {
  const { t } = useI18n();
  const router = useRouter();
  const label = tOr(t, 'app.promptTools.enhance', 'Improve this prompt with the Prompt writer');
  const go = () => {
    try { window.sessionStorage.setItem(ENHANCE_HANDOFF_KEY, text.slice(0, 4000)); } catch { /* storage blocked: chat opens empty */ }
    router.push('/app/chat?skill=prompt-writer');
  };
  return (
    <button type="button" disabled={disabled || !text.trim()} aria-label={label} title={label} onClick={go} className={button}>
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 3l1.4 3.6L13 8l-3.6 1.4L8 13 6.6 9.4 3 8l3.6-1.4L8 3ZM14.5 11l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></svg>
    </button>
  );
}

// Appends dictated text to a prompt with a single space between.
export function appendSpoken(current, spoken) {
  return current && !/\s$/.test(current) ? `${current} ${spoken}` : `${current}${spoken}`;
}
