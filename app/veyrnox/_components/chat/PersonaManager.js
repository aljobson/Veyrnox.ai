'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useRef, useState } from 'react';
import { Modal } from '../Modal';
import { ConfirmDialog } from '../ConfirmDialog';
import { chatApi, chatErrorCopy } from '../../_lib/chatApi';

const MAX_NAME = 60;
const MAX_INSTRUCTIONS = 4000;
const blank = { name: '', instructions: '', model_id: '', thinking: false, web: false };

// Saved instructions plus a default model and options (ADR-0072). A persona starts a chat; it never changes one that exists, and it is not priced.
export function PersonaManager({ personas, models, onChange, onClose }) {
  const { t, locale } = useI18n();
  const number = new Intl.NumberFormat(localeTag(locale), { useGrouping: false });
  const [editing, setEditing] = useState(null); // null = list, 'new' or an id = the form
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);
  const nameRef = useRef(null);
  const closeRef = useRef(null);

  const start = (p) => { setError(null); setEditing(p ? p.id : 'new'); setForm(p ? { name: p.name, instructions: p.instructions, model_id: p.model_id || '', thinking: p.thinking, web: p.web } : blank); };
  const body = () => ({ name: form.name, instructions: form.instructions, model_id: form.model_id || null, thinking: form.thinking, web: form.web });
  const tooLong = form.name.trim().length > MAX_NAME || form.instructions.trim().length > MAX_INSTRUCTIONS;
  const ready = form.name.trim() && form.instructions.trim() && !tooLong && !busy;

  async function save() {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const r = editing === 'new' ? await chatApi.savePersona(body()) : await chatApi.updatePersona(editing, body());
      const next = editing === 'new' ? [...personas, r.persona] : personas.map((p) => (p.id === editing ? r.persona : p));
      onChange(next.sort((a, b) => a.name.localeCompare(b.name)));
      setEditing(null);
    } catch (e) { setError(tOr(t, `app.chat.error.${e?.code}`, chatErrorCopy(e?.code))); } finally { setBusy(false); }
  }
  async function remove(id) {
    setBusy(true); setError(null);
    try { await chatApi.removePersona(id); onChange(personas.filter((p) => p.id !== id)); } catch (e) { setError(tOr(t, `app.chat.error.${e?.code}`, chatErrorCopy(e?.code))); } finally { setBusy(false); setRemoving(null); }
  }

  return (
    <Modal onCancel={onClose} initialFocusRef={editing ? nameRef : closeRef} role="dialog" aria-modal="true" aria-labelledby="persona-title" className="items-center justify-center p-4">
      <div className="max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="persona-title" className="text-lg font-bold">{editing ? (editing === 'new' ? t("app.chat.personas.new") : t("app.chat.personas.edit")) : t('app.chat.personas.title')}</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-full border border-vx-border px-3 py-1 text-sm">{t("app.editor.workspace.close")}</button>
        </div>
        <p className="mt-1 text-sm text-vx-fg-muted">{t("app.chat.personas.intro")}</p>
        {error && <p role="alert" className="mt-3 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-3 py-2 text-sm text-vx-danger">{error}</p>}

        {!editing && (
          <>
            <ul className="mt-4 space-y-2" aria-label={t("app.chat.personas.yours")}>
              {personas.length === 0 && <li className="text-sm text-vx-fg-muted">{t("app.chat.personas.empty")}</li>}
              {personas.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg border border-vx-border px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <button type="button" onClick={() => start(p)} className="rounded-full border border-vx-border px-3 py-1 text-sm">{t("label.Edit")}</button>
                  <button type="button" onClick={() => setRemoving(p)} className="rounded-full border border-vx-border px-3 py-1 text-sm">{t("app.publish.composer.delete")}</button>
                </li>
              ))}
            </ul>
            <button type="button" disabled={personas.length >= 20} onClick={() => start(null)} className="mt-4 rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-50">{t("app.chat.personas.new")}</button>
            {personas.length >= 20 && <p className="mt-2 text-xs text-vx-fg-muted">{t("app.chat.personas.limit")}</p>}
          </>
        )}

        {editing && (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-semibold" htmlFor="persona-name">{t("app.publish.autolists.name")}<input id="persona-name" ref={nameRef} value={form.name} maxLength={MAX_NAME + 20} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("app.chat.personas.exampleName")}
                className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm font-normal text-vx-fg" />
            </label>
            <label className="block text-sm font-semibold" htmlFor="persona-instr">{t("app.chat.personas.instructions")}<textarea id="persona-instr" value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} placeholder={t("app.chat.personas.exampleInstructions")}
                className="mt-1 min-h-32 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm font-normal text-vx-fg" />
              <span className="mt-1 block text-end font-vx-mono text-xs font-normal text-vx-fg-muted vx-num">{number.format(form.instructions.trim().length)}/{number.format(MAX_INSTRUCTIONS)}</span>
            </label>
            <label className="block text-sm font-semibold" htmlFor="persona-model">{t("app.chat.personas.model")}<select id="persona-model" value={form.model_id} onChange={(e) => setForm((f) => ({ ...f, model_id: e.target.value }))} className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm font-normal text-vx-fg">
                <option value="">{t("app.chat.personas.pick")}</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--vx-accent)]" checked={form.thinking} onChange={(e) => setForm((f) => ({ ...f, thinking: e.target.checked }))} />{' '}{t("app.chat.personas.thinking")}</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--vx-accent)]" checked={form.web} onChange={(e) => setForm((f) => ({ ...f, web: e.target.checked }))} />{' '}{t("app.chat.personas.web")}</label>
            </div>
            <p className="text-xs text-vx-fg-muted">{t("app.chat.personas.priceHelp")}</p>
            <div className="flex gap-2">
              <button type="button" disabled={!ready} onClick={save} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-50">{busy ? t('app.chat.personas.saving') : t("app.publish.inbox.save")}</button>
              <button type="button" disabled={busy} onClick={() => { setEditing(null); setError(null); }} className="rounded-full border border-vx-border px-4 py-2 text-sm">{t("public.vey.back")}</button>
            </div>
          </div>
        )}
      </div>
      {removing && (
        <ConfirmDialog title={t("app.chat.personas.delete")} body={t('app.chat.personas.deleteBody', { name: removing.name })}
          confirmLabel={t("app.publish.composer.delete")} tone="danger" onConfirm={() => remove(removing.id)} onCancel={() => setRemoving(null)} />
      )}
    </Modal>
  );
}
