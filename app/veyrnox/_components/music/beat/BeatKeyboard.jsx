'use client';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useRef, useState } from 'react';
import { noteLabel, isBlackKey } from '../../../../../lib/musicInstruments.js';
import { bindMidiAccess } from '../../../_lib/music/beat/beatWebMidi.mjs';
import { button, input } from './beatStyles';
export default function BeatKeyboard({ playback, octave, setOctave, velocity, setVelocity }) {
  const { t } = useI18n();
  const [status, setStatus] = useState(() => typeof navigator.requestMIDIAccess === 'function' ? '' : t('app.music.beat.recovery.r2'));
  const [devices, setDevices] = useState([]), [selected, setSelected] = useState(''), [connecting, setConnecting] = useState(false);
  const binding = useRef(null), token = useRef(0), latest = useRef(playback);
  useEffect(() => { latest.current = playback; }, [playback]);
  useEffect(() => {
    const close = () => { token.current++; binding.current?.dispose(); binding.current = null; latest.current.releaseKeys(); };
    const blur = () => latest.current.releaseKeys();
    window.addEventListener('pagehide', close); window.addEventListener('blur', blur);
    return () => { close(); window.removeEventListener('pagehide', close); window.removeEventListener('blur', blur); };
  }, []);
  async function connect() {
    if (!navigator.requestMIDIAccess) { setStatus(t('app.music.beat.recovery.r2')); return; }
    const request = ++token.current; setConnecting(true);
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      if (request !== token.current) return;
      binding.current?.dispose();
      binding.current = bindMidiAccess(access, (message, timeStamp) => {
        const key = `midi:${message.channel}:${message.pitch}`;
        if (message.type === 'on') latest.current.noteOn(key, message.pitch, message.velocity, timeStamp);
        else latest.current.noteOff(key, timeStamp);
      }, (inputs, id) => {
        latest.current.releaseKeys(); setDevices(inputs); setSelected(id || ''); setStatus(inputs.length ? '' : t('app.music.beat.status.s27'));
      });
    } catch { if (request === token.current) setStatus(t('app.music.beat.status.s28')); }
    finally { if (request === token.current) setConnecting(false); }
  }
  return <section aria-label={t('app.music.beat.ui.playable.keyboard')} className="min-w-0 space-y-2 rounded-xl border border-vx-border bg-vx-panel p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span>{t('app.music.beat.ui.typing.on.octave')}{4 + octave}</span>
      <button className={button} aria-label={t('app.music.beat.control.octaveDown')} disabled={octave === -3} onClick={() => setOctave(octave - 1)}>{t('app.music.beat.ui.octave')}</button>
      <button className={button} aria-label={t('app.music.beat.control.octaveUp')} disabled={octave === 2} onClick={() => setOctave(octave + 1)}>{t('app.music.beat.ui.octave.2')}</button>
      <label>{t('app.music.beat.ui.velocity')}<input className={`${input} w-20`} type="number" min={1} max={127} value={velocity} onChange={(e) => setVelocity(Math.max(1, Math.min(127, Math.round(Number(e.target.value)))))} /></label>
      <button className={button} disabled={connecting} onClick={connect}>{t('app.music.beat.ui.connect.midi.keyboard')}</button>
      {!!devices.length && <label>{t('app.music.beat.ui.midi.device')}<select className={`${input} max-w-full`} value={selected} onChange={(e) => binding.current?.select(e.target.value)}>{devices.map((d) => <option value={d.id} key={d.id}>{d.name || t('app.music.beat.ui.midi.keyboard')}</option>)}</select></label>}
    </div>
    {status && <p role="status">{status}</p>}
    <div className="flex max-w-full gap-1 overflow-x-auto" aria-label={t('app.music.beat.ui.two.octave.keyboard')}>{Array.from({ length: 24 }, (_, i) => 60 + octave * 12 + i).map((pitch) => <button key={pitch} className={`${button} h-28 min-w-11 touch-none ${isBlackKey(pitch) ? 'bg-vx-base' : 'bg-vx-panel'}`} aria-label={noteLabel(pitch)}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); playback.noteOn(`pointer:${pitch}`, pitch, velocity); }}
      onPointerUp={() => playback.noteOff(`pointer:${pitch}`)} onPointerCancel={() => playback.noteOff(`pointer:${pitch}`)} onLostPointerCapture={() => playback.noteOff(`pointer:${pitch}`)}
      onKeyDown={(e) => { if (['Enter', ' '].includes(e.key) && !e.repeat) { e.preventDefault(); playback.noteOn(`button:${pitch}`, pitch, velocity); } }}
      onKeyUp={(e) => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); playback.noteOff(`button:${pitch}`); } }} onBlur={() => playback.noteOff(`button:${pitch}`)}>{noteLabel(pitch)}</button>)}</div>
    <p className="text-xs text-vx-fg-muted">{t('app.music.beat.ui.play.a.w.s.e.d.f.t.g.y.h.u.j.k.o.l.p.z.x.change.octave.c.v.change.velo')}</p>
  </section>;
}
