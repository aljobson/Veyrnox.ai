'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Do not let the shared helper mutate this boundary's SSR markup before it hydrates. */
export function EditorHelperHost() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  return <div className="ms-auto shrink-0 sm:ms-0">{ready && <div data-vey-editor-helper />}</div>;
}

/** Same helper state and focus target; only its editor placement is different. */
export function EditorHelperLauncher({ host, open, launcherRef, onToggle }) {
  const { t } = useI18n();
  if (!host) return null;
  return createPortal(<button
    ref={launcherRef}
    type="button"
    data-testid="assistant-editor-launcher"
    aria-label={open ? t("public.vey.close") : t("public.vey.open")}
    aria-expanded={open}
    onClick={onToggle}
    className="min-h-11 shrink-0 rounded-full border border-vx-border bg-vx-base px-3 py-2 text-xs font-semibold text-vx-fg hover:border-vx-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent"
  >{open ? t("app.editor.helper.close") : t("public.vey.ask")}</button>, host);
}
