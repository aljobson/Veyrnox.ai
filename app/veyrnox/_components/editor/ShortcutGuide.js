'use client';
import { useRef } from 'react';
import { Modal } from '../Modal';

const sections = [
    ['Playback', [['Space or L','Play or pause'],['K','Pause'],['J','Back one second'],['← / →','Previous or next frame'],['Shift + ← / →','Back or forward one second'],['Home / End','Go to the start or end']]],
    ['Editing', [['⌘/Ctrl + Z','Undo'],['⌘/Ctrl + Shift + Z','Redo'],['⌘/Ctrl + B or S','Split at the playhead'],['⌘/Ctrl + D','Duplicate selection'],['⌘/Ctrl + C / V','Copy or paste'],['Delete','Delete selection'],['Escape','Clear selection']]],
    ['Timeline', [['M','Add marker at playhead'],['Shift + Z','Fit the timeline'],['+ / −','Zoom the timeline'],['⌘/Ctrl + mouse wheel','Zoom at the timeline'],['?','Open this shortcut guide']]],
];
export function ShortcutGuide({onClose}) {
    const close=useRef(null);
    return <Modal instant aria-labelledby="shortcut-guide-title" onCancel={onClose} initialFocusRef={close} className="items-center justify-center p-4">
        <section className="max-h-[min(720px,90dvh)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4"><div><p className="font-vx-mono text-[10px] uppercase tracking-[0.14em] text-vx-accent">Editor controls</p><h2 id="shortcut-guide-title" className="mt-1 text-xl font-extrabold">Keyboard shortcuts</h2></div><button ref={close} type="button" aria-label="Close keyboard shortcuts" onClick={onClose} className="grid size-9 place-items-center rounded-full border border-vx-border hover:border-vx-accent">×</button></div>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">{sections.map(([title,items])=><section key={title}><h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-vx-fg-muted">{title}</h3><dl className="space-y-2">{items.map(([keys,action])=><div key={keys} className="border-b border-vx-border/60 pb-2"><dt><kbd className="inline-block rounded border border-vx-border bg-vx-base px-2 py-1 font-vx-mono text-[10px]">{keys}</kbd></dt><dd className="mt-1 text-xs text-vx-fg-muted">{action}</dd></div>)}</dl></section>)}</div>
        </section>
    </Modal>;
}
