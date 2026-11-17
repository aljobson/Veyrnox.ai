'use client';
import { beatErrorMessage } from '../../../_lib/music/beat/beatErrors.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { readLatency } from '../../../_lib/music/beat/beatLatency.mjs';
import BeatMeter from './BeatMeter';
import { button, input } from './beatStyles';
const Calibration = dynamic(() => import('./BeatLatencyCalibration'), { ssr: false });
export default function BeatRecordPanel({ recorder, playback, announce }) {
  const { t } = useI18n();
  const [calibrating, setCalibrating] = useState(false);
  const capture = recorder.capture.current, latency = capture && readLatency(capture.deviceId);
  const meterEngine = useMemo(() => ({ current: capture ? { context: capture.context, meterTap: () => capture.analyser } : null }), [capture]);
  return <section className="min-w-0 space-y-3 rounded-xl border border-vx-border bg-vx-panel p-4" aria-label={t('app.music.beat.ui.audio.recording')}>
    <h2 className="font-bold">{t('app.music.beat.ui.audio.recording')}</h2>
    <p role="status">{recorder.status === 'opening' ? t('app.music.beat.ui.opening.microphone') : recorder.status === 'finishing' ? t('app.music.beat.ui.saving.recorded.takes') : recorder.status === 'recording' ? t('app.music.beat.labels.l29', { p0: Math.floor(recorder.seconds), p1: recorder.pass }) : t('app.music.beat.ui.arm.an.audio.track.enable.record.then.play')}</p>
    {recorder.error && <p role="alert">{recorder.displayError ?? beatErrorMessage(null, 'save-take', t)} {recorder.error.includes('Reload this page') ? <button className={button} onClick={() => window.location.reload()}>{t('app.music.beat.ui.reload')}</button> : <button className={button} onClick={() => recorder.retry?.()}>{t('app.music.beat.ui.try.again')}</button>}</p>}
    {recorder.hasPending?.() && <button className={button} onClick={() => recorder.discard()}>{t('app.music.beat.ui.discard.these.takes')}</button>}
    {(capture || recorder.error) && <div className="flex flex-wrap items-center gap-3"><label>{t('app.music.beat.ui.input')}<select className={`${input} max-w-full`} value={recorder.deviceId} onChange={e => recorder.selectDevice(e.target.value)}><option value="default">{t('app.music.beat.ui.default.microphone')}</option>{recorder.devices.filter(d => d.deviceId !== 'default').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || t('app.music.beat.ui.microphone')}</option>)}</select></label>
      {capture && <BeatMeter engine={meterEngine} trackId="input" name={t('app.music.beat.shared.microphoneInput')} />}</div>}
    {capture && <>
      <div className="flex flex-wrap gap-3"><label className="flex min-h-11 items-center gap-2"><input className="size-5 accent-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent" type="checkbox" checked={playback.record} onChange={e => playback.setRecord(e.target.checked)} />{t('app.music.beat.ui.record')}</label>
        <label className="flex min-h-11 items-center gap-2"><input className="size-5 accent-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent" type="checkbox" checked={playback.countIn} onChange={e => playback.setCountIn(e.target.checked)} />{t('app.music.beat.ui.count.in.1.bar')}</label></div>
      <p>{latency ? t('app.music.beat.labels.l30', { p0: latency.ms.toFixed(2) }) : t('app.music.beat.ui.not.calibrated.for.this.input.not.calibrated.takes.may.land.a.few.ms.l')}</p>
      <button className={button} disabled={recorder.calibrationDisabled} onClick={() => setCalibrating(true)}>{t('app.music.beat.ui.calibrate')}</button><p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.record.with.headphones.on')}</p>
    </>}
    {!!recorder.recovery.length && <div><button className={button} onClick={() => recorder.recover()}>{t('app.music.beat.ui.recover')}{recorder.recovery.length}{t('app.music.beat.ui.unsaved.takes')}</button><button className={button} onClick={() => recorder.recover(true)}>{t('app.music.beat.ui.discard')}</button></div>}
    {calibrating && capture && !recorder.calibrationDisabled && <Calibration capture={capture} announce={announce} close={() => setCalibrating(false)} />}
  </section>;
}
