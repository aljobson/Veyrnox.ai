'use client';
// Live camera controls (ADR-0338, S2b). The camera starts only from the Start button below, never on load.
export function CameraBar({ t, control, camera, note, ready, canSwitch, start, stop, take, switchCamera }) {
    const notes = { stopped: t('app.photoStudio.camera.stopped'), hidden: t('app.photoStudio.camera.hidden') };
    return <div className="mt-4 rounded-xl border border-vx-border p-4" aria-label={t('app.photoStudio.camera.title')} role="group">
        <div className="flex flex-wrap items-center gap-2">
            {/* One button element for both states, so keyboard and screen-reader focus is not dropped when it changes from Start to Stop. */}
            <button type="button" className={control} onClick={camera === 'off' ? start : stop}>{t(`app.photoStudio.camera.${camera === 'off' ? 'start' : 'stop'}`)}</button>
            {camera === 'live' && <button type="button" className={`${control} border-vx-accent`} disabled={!ready} onClick={take}>{t('app.photoStudio.camera.take')}</button>}
            {camera === 'live' && canSwitch && <button type="button" className={control} disabled={!ready} onClick={switchCamera}>{t('app.photoStudio.camera.switch')}</button>}
        </div>
        <p role="status" className="mt-3 text-sm leading-relaxed text-vx-fg-muted">
            {camera === 'starting' && t('app.photoStudio.camera.starting')}
            {camera === 'live' && <><span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-vx-danger" />{t('app.photoStudio.camera.live')}</>}
            {camera === 'off' && (notes[note] || t('app.photoStudio.camera.help'))}
        </p>
    </div>;
}
