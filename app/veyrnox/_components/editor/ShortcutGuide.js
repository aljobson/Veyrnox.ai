'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { useRef } from 'react';
import { Modal } from '../Modal';

export function ShortcutGuide({onClose}) {
    const { t } = useI18n();
    const sections = [
    [t("app.editor.shortcuts.playback"), [[t("app.editor.shortcuts.space"),t("app.editor.shortcuts.play")],['K',t("cinema.videoUpload.pause")],['J',t("app.editor.shortcuts.back")],['← / →',t("app.editor.shortcuts.frame")],[t("app.editor.shortcuts.keys.second"),t("app.editor.shortcuts.second")],[t("app.editor.shortcuts.keys.bounds"),t("app.editor.shortcuts.bounds")]]],
    [t("app.editor.shortcuts.editing"), [[t("app.editor.shortcuts.keys.undo"),t("app.editor.workspace.undo")],[t("app.editor.shortcuts.keys.redo"),t("app.editor.workspace.redo")],[t("app.editor.shortcuts.splitKeys"),t("app.editor.shortcuts.split")],[t("app.editor.shortcuts.keys.duplicate"),t("app.editor.shortcuts.duplicate")],[t("app.editor.shortcuts.keys.copy"),t("app.editor.shortcuts.copy")],[t("app.publish.composer.delete"),t("app.editor.shortcuts.delete")],['Escape',t("app.editor.shortcuts.clear")]]],
    [t("app.editor.workspace.timeline"), [['M',t("app.editor.shortcuts.marker")],[t("app.editor.shortcuts.keys.fit"),t("app.editor.shortcuts.fit")],['+ / −',t("app.editor.shortcuts.zoom")],[t("app.editor.shortcuts.wheel"),t("app.editor.shortcuts.zoomAt")],['?',t("app.editor.shortcuts.open")]]],
];

    const close=useRef(null);
    return <Modal instant aria-labelledby="shortcut-guide-title" onCancel={onClose} initialFocusRef={close} className="items-center justify-center p-4">
        <section className="max-h-[min(720px,90dvh)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4"><div><p className="font-vx-mono text-[10px] uppercase tracking-[0.14em] text-vx-accent">{t("app.editor.shortcuts.controls")}</p><h2 id="shortcut-guide-title" className="mt-1 text-xl font-extrabold">{t("app.editor.shortcuts.title")}</h2></div><button ref={close} type="button" aria-label={t("app.editor.shortcuts.close")} onClick={onClose} className="grid size-9 place-items-center rounded-full border border-vx-border hover:border-vx-accent">×</button></div>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">{sections.map(([title,items], sectionIndex)=><section key={sectionIndex}><h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-vx-fg-muted">{title}</h3><dl className="space-y-2">{items.map(([keys,action], itemIndex)=><div key={itemIndex} className="border-b border-vx-border/60 pb-2"><dt><kbd className="inline-block rounded border border-vx-border bg-vx-base px-2 py-1 font-vx-mono text-[10px]">{keys}</kbd></dt><dd className="mt-1 text-xs text-vx-fg-muted">{action}</dd></div>)}</dl></section>)}</div>
        </section>
    </Modal>;
}
