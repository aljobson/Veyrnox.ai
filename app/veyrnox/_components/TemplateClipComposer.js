'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { TEMPLATE_CLIP_PROMPT, templateClipPhotoPrompt, templateClipSegments, validTemplateClipPrompt } from '../../../lib/templateClipPrompt.mjs';

// Separate editing hosts keep chips atomic and outside selection/deletion ranges.
// Browser composition remains native; React never replaces an active IME buffer.
function PromptText({ value, onChange, label }) {
  const node = useRef(null), composing = useRef(false);
  useLayoutEffect(() => {
    if (!composing.current && node.current.textContent !== value) node.current.textContent = value;
  }, [value]);
  function paste(event) {
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection?.rangeCount || !node.current.contains(selection.anchorNode) || !node.current.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const text = document.createTextNode(event.clipboardData.getData('text/plain'));
    range.insertNode(text); range.setStartAfter(text); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    onChange(node.current.textContent);
  }
  return <span ref={node} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label}
    className="inline min-w-4 whitespace-pre-wrap rounded-xl focus-visible:outline-2 focus-visible:outline-vx-accent"
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; onChange(node.current.textContent); }}
    onInput={() => { if (!composing.current) onChange(node.current.textContent); }} onPaste={paste}
    onDrop={event => event.preventDefault()} />;
}

function Thumb({ src, file }) {
  const node = useRef(null);
  useEffect(() => {
    if (!file || !node.current) return;
    const url = URL.createObjectURL(file); node.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return src || file ? <img ref={node} src={src || undefined} alt="" className="h-full w-full rounded-xl object-cover" /> : <span aria-hidden="true">＋</span>;
}

export function TemplateClipComposer({ preset, photo, value, onChange, onRemove }) {
  const { t } = useI18n();
  const poster = preset.clip?.poster || preset.posterUrl;
  const segments = templateClipSegments(value);
  const name = token => t(token === '@video1' ? 'templateClip.videoName' : 'templateClip.photoName');
  function edit(index, text) {
    if (segments[index - 1]?.token && /^[\p{L}\p{M}\p{N}_]/u.test(text)) text = ' ' + text;
    if (segments[index + 1]?.token && /[\p{L}\p{M}\p{N}_@]$/u.test(text)) text += ' ';
    onChange(segments.map((segment, i) => i === index ? text : segment.token ?? segment.text).join(''));
  }
  return <section className="mt-6 min-w-0" aria-label={t('templateClip.prompt')}>
    <div className="mb-4 flex min-h-24 flex-wrap gap-4">
      {['@video1', '@image1'].map(token => <div key={token} className="flex items-center gap-2 rounded-xl border border-vx-border bg-vx-panel p-2">
        <span className="flex h-16 w-16 items-center justify-center"><Thumb src={token === '@video1' ? poster : undefined} file={token === '@image1' ? photo : null} /></span>
        <span className="text-sm">{token === '@image1' && !photo ? t('templateClip.addPhoto') : token}</span>
        {token === '@image1' && photo && <button type="button" onClick={onRemove} aria-label={t('presets.use.photoRemove')} className="min-h-11 min-w-11 rounded-xl focus-visible:outline-2 focus-visible:outline-vx-accent">×</button>}
      </div>)}
    </div>
    <p className="mb-2 text-sm font-bold">{t('templateClip.prompt')}</p>
    <div role="group" aria-label={t('templateClip.prompt')} className="min-h-40 whitespace-pre-wrap break-words rounded-xl border border-vx-border bg-vx-panel p-4 text-base leading-8 text-vx-fg">
      {segments.map((segment, index) => segment.token ? segment.token === '@image1'
        ? <button key={index} type="button" aria-label={name(segment.token)} onClick={onRemove} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-vx-border px-2 align-middle text-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent"><span className="h-6 w-6"><Thumb file={photo} /></span>@image1 ×</button>
        : <span key={index} role="img" aria-label={name(segment.token)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-vx-border px-2 align-middle text-vx-accent"><span className="h-6 w-6"><Thumb src={poster} /></span>@video1</span>
        : <PromptText key={index} value={segment.text} label={t('templateClip.prompt')} onChange={text => edit(index, text)} />)}
    </div>
    <div className="mt-2 flex items-center justify-between gap-4">
      <button type="button" onClick={() => onChange(templateClipPhotoPrompt(TEMPLATE_CLIP_PROMPT, !!photo))} className="min-h-11 rounded-xl px-2 text-sm text-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent">{t('templateClip.reset')}</button>
      <span className="text-sm text-vx-fg-muted">{value.length} / 2000</span>
    </div>
    {!validTemplateClipPrompt(value) && <p role="status" className="mt-2 text-sm text-vx-danger">{t(photo ? 'templateClip.invalid' : 'templateClip.addPhoto')}</p>}
  </section>;
}
