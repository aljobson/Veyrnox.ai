'use client';
import { useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { useCatalog } from '../../_lib/useCatalog';
import { generationModelsForMode } from '../../_lib/editorGeneration.mjs';
import { EDITOR_INTENTS, EDITOR_INTENT_EXAMPLES, routeEditorIntent, editorIntentAvailability, dispatchEditorIntent, editorTimelineMedia } from '../../_lib/editorIntentRouter.mjs';
import { Button } from '../Button';

export function EditorIntentBox({ tl, flags, disabled, onOpen }) {
    const { t } = useI18n();
    const catalog = useCatalog();
    const [prompt, setPrompt] = useState(''), [message, setMessage] = useState('');
    const features = { ...flags, captions: true,
        video: catalog.live && generationModelsForMode(catalog.models, 'media').some(model => model.kind === 'video'),
        voiceover: catalog.live && generationModelsForMode(catalog.models, 'voiceover').length > 0,
        avatar: catalog.live && generationModelsForMode(catalog.models, 'avatar').length > 0 };
    const context = { features, media: editorTimelineMedia(tl) };
    const available = Object.keys(EDITOR_INTENTS).filter(id => editorIntentAvailability(id, context).available);
    const unavailable = Object.keys(EDITOR_INTENTS).filter(id => !editorIntentAvailability(id, context).available);
    function open(value) {
        const intent = routeEditorIntent(value, context);
        if (!dispatchEditorIntent(intent, onOpen)) { setMessage(t(`app.editor.simple.${intent.reason}`)); return; }
        setMessage(t(intent.paid ? 'app.editor.simple.paid' : intent.analysisOnly ? 'app.editor.simple.analysis' : 'app.editor.simple.opened'));
    }
    return <section aria-label={t('app.editor.simple.ask')} className="shrink-0 space-y-2 border-b border-vx-border bg-vx-panel p-3">
        <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); open(prompt); }}>
            <label className="min-w-0 flex-1 text-sm font-bold">{t('app.editor.simple.ask')}
                <input className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 text-sm focus-visible:outline-2 focus-visible:outline-vx-accent" value={prompt} maxLength={500} onChange={event => setPrompt(event.target.value)} placeholder={t('app.editor.simple.describe')} disabled={disabled} />
            </label>
            <Button type="submit" className="min-h-11 self-end" disabled={disabled || !prompt.trim()}>{t('app.editor.simple.open')}</Button>
        </form>
        <p className="text-xs text-vx-fg-muted">{t('app.editor.simple.honest')}</p>
        <div className="flex flex-wrap gap-2">{available.map(id => <button key={id} type="button" disabled={disabled} className="min-h-11 rounded-xl border border-vx-border px-3 text-xs focus-visible:outline-2 focus-visible:outline-vx-accent" onClick={() => open(EDITOR_INTENT_EXAMPLES[id])}>{t(`app.editor.simple.intent.${id}`)}</button>)}</div>
        {!!unavailable.length && <p className="text-xs text-vx-fg-muted">{t('app.editor.simple.unavailableList', { tools: unavailable.map(id => t(`app.editor.simple.intent.${id}`)).join(', ') })}</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
    </section>;
}
