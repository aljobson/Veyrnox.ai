'use client';
import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { readLatency } from '../../../_lib/music/beat/beatLatency.mjs';
import BeatMeter from './BeatMeter';
import { button, input } from './beatStyles';
const Calibration = dynamic(() => import('./BeatLatencyCalibration'), { ssr: false });
export default function BeatRecordPanel({ recorder, playback, announce }) {
  const [calibrating, setCalibrating] = useState(false);
  const capture = recorder.capture.current, latency = capture && readLatency(capture.deviceId);
  const meterEngine = useMemo(() => ({ current: capture ? { context: capture.context, meterTap: () => capture.analyser } : null }), [capture]);
  return <section className="min-w-0 space-y-3 rounded-xl border border-vx-border bg-vx-panel p-4" aria-label="Audio recording">
    <h2 className="font-bold">Audio recording</h2>
    <p role="status">{recorder.status === 'opening' ? 'Opening microphone…' : recorder.status === 'finishing' ? 'Saving recorded takes…' : recorder.status === 'recording' ? `${Math.floor(recorder.seconds)} s · Take ${recorder.pass} of 8` : 'Arm an audio track, enable Record, then Play.'}</p>
    {recorder.error && <p role="alert">{recorder.error} {recorder.error.includes('Reload this page') ? <button className={button} onClick={() => window.location.reload()}>Reload</button> : <button className={button} onClick={() => recorder.retry?.()}>Try again</button>}</p>}
    {capture && <>
      <div className="flex flex-wrap items-center gap-3"><label>Input <select className={`${input} max-w-full`} value={recorder.deviceId} onChange={e => recorder.selectDevice(e.target.value)}><option value="default">Default microphone</option>{recorder.devices.filter(d => d.deviceId !== 'default').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}</select></label>
        <BeatMeter engine={meterEngine} trackId="input" name="Microphone input" /></div>
      <div className="flex flex-wrap gap-3"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={playback.record} onChange={e => playback.setRecord(e.target.checked)} />Record</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={playback.countIn} onChange={e => playback.setCountIn(e.target.checked)} />Count-in 1 bar</label></div>
      <p>{latency ? `Calibrated: ${latency.ms.toFixed(2)} ms round trip` : 'Not calibrated for this input. Not calibrated — takes may land a few ms late.'}</p>
      <button className={button} onClick={() => setCalibrating(true)}>Calibrate</button><p className="text-sm text-vx-fg-muted">Use headphones when recording to keep playback out of your microphone.</p>
    </>}
    {!!recorder.recovery.length && <div><button className={button} onClick={() => recorder.recover()}>Recover {recorder.recovery.length} unsaved takes</button><button className={button} onClick={() => recorder.recover(true)}>Discard</button></div>}
    {calibrating && capture && <Calibration capture={capture} announce={announce} close={() => setCalibrating(false)} />}
  </section>;
}
