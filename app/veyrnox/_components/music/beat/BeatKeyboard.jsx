'use client';
import { useEffect, useRef, useState } from 'react';
import { noteLabel, isBlackKey } from '../../../../../lib/musicInstruments.js';
import { bindMidiAccess } from '../../../_lib/music/beat/beatWebMidi.mjs';
import { button, input } from './beatStyles';
const unsupported = "Your browser can't use MIDI keyboards. Use Chrome or Edge, or the on-screen keys.";
export default function BeatKeyboard({ playback, octave, setOctave, velocity, setVelocity }) {
  const [status, setStatus] = useState(() => typeof navigator.requestMIDIAccess === 'function' ? '' : unsupported);
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
    if (!navigator.requestMIDIAccess) { setStatus(unsupported); return; }
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
        latest.current.releaseKeys(); setDevices(inputs); setSelected(id || ''); setStatus(inputs.length ? '' : 'No MIDI devices connected.');
      });
    } catch { if (request === token.current) setStatus('MIDI permission denied. Allow MIDI access in your browser settings and try again.'); }
    finally { if (request === token.current) setConnecting(false); }
  }
  return <section aria-label="Playable keyboard" className="min-w-0 space-y-2 rounded-xl border border-vx-border bg-vx-panel p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span>Typing: on · octave {4 + octave}</span>
      <button className={button} aria-label="Octave down" disabled={octave === -3} onClick={() => setOctave(octave - 1)}>Octave −</button>
      <button className={button} aria-label="Octave up" disabled={octave === 2} onClick={() => setOctave(octave + 1)}>Octave +</button>
      <label>Velocity <input className={`${input} w-20`} type="number" min={1} max={127} value={velocity} onChange={(e) => setVelocity(Math.max(1, Math.min(127, Math.round(Number(e.target.value)))))} /></label>
      <button className={button} disabled={connecting} onClick={connect}>Connect MIDI keyboard</button>
      {!!devices.length && <label>MIDI device <select className={`${input} max-w-full`} value={selected} onChange={(e) => binding.current?.select(e.target.value)}>{devices.map((d) => <option value={d.id} key={d.id}>{d.name || 'MIDI keyboard'}</option>)}</select></label>}
    </div>
    {status && <p role="status">{status}</p>}
    <div className="flex max-w-full gap-1 overflow-x-auto" aria-label="Two octave keyboard">{Array.from({ length: 24 }, (_, i) => 60 + octave * 12 + i).map((pitch) => <button key={pitch} className={`${button} h-28 min-w-11 touch-none ${isBlackKey(pitch) ? 'bg-vx-base' : 'bg-vx-panel'}`} aria-label={noteLabel(pitch)}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); playback.noteOn(`pointer:${pitch}`, pitch, velocity); }}
      onPointerUp={() => playback.noteOff(`pointer:${pitch}`)} onPointerCancel={() => playback.noteOff(`pointer:${pitch}`)} onLostPointerCapture={() => playback.noteOff(`pointer:${pitch}`)}
      onKeyDown={(e) => { if (['Enter', ' '].includes(e.key) && !e.repeat) { e.preventDefault(); playback.noteOn(`button:${pitch}`, pitch, velocity); } }}
      onKeyUp={(e) => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); playback.noteOff(`button:${pitch}`); } }} onBlur={() => playback.noteOff(`button:${pitch}`)}>{noteLabel(pitch)}</button>)}</div>
    <p className="text-xs text-vx-fg-muted">Play A W S E D F T G Y H U J K O L P ;. Z/X change octave; C/V change velocity.</p>
  </section>;
}
