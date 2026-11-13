'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

const EDITOR_FLAG = 'veyrnox_editor';
const EDITOR_FLAG_EVENT = 'veyrnox:editor-preview';
const editorFlag = () => { try { return window.localStorage.getItem(EDITOR_FLAG) === '1'; } catch { return false; } };
const off = () => false;
const subscribe = (onChange) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(EDITOR_FLAG_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EDITOR_FLAG_EVENT, onChange);
  };
};

export function useSmartCutIntent(onOpen, { editorKey = EDITOR_FLAG, getEditorFlag = editorFlag } = {}) {
  const editorOn = useSyncExternalStore(subscribe, getEditorFlag, off);
  const [smartCutIntent, setSmartCutIntent] = useState(false);
  useEffect(() => {
    const readIntent = () => {
      const active = window.location.hash === '#smart-cut';
      setSmartCutIntent(active);
      if (active) onOpen();
    };
    readIntent();
    window.addEventListener('hashchange', readIntent);
    return () => window.removeEventListener('hashchange', readIntent);
  }, [onOpen]);
  const enableEditorPreview = () => {
    try {
      window.localStorage.setItem(editorKey, '1');
      window.dispatchEvent(new Event(EDITOR_FLAG_EVENT));
    } catch { /* storage can be unavailable; the existing off state remains honest */ }
  };
  return { editorOn, smartCutIntent, enableEditorPreview };
}

/** Same state as following the #smart-cut link, without a page load. */
export function markSmartCutIntent() {
  if (window.location.hash === '#smart-cut') return;
  window.history.pushState(null, '', '#smart-cut');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
