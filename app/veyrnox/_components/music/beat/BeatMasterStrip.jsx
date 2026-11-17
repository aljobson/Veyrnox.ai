'use client';
import { masterPatchLive } from '../../../_lib/music/beat/beatMixControls.mjs';
import { DEFAULT_MASTER } from '../../../_lib/music/beat/beatMixRules.mjs';
import { setMaster } from '../../../_lib/music/beat/beatMixOps.mjs';
import { MixRange, RoomSize } from './BeatMixControl';
import BeatMeter from './BeatMeter';
import { button } from './beatStyles';
export default function BeatMasterStrip({ doc, edit, engine }) {
  const master = doc.master || DEFAULT_MASTER;
  const change = (patch, key) => edit(d => setMaster(d, patch), { label: 'Change master', key: `master:${key}`, liveMix: masterPatchLive(doc, patch) });
  return <section aria-label="Master channel" className="w-64 shrink-0 space-y-3 rounded-xl border border-vx-border bg-vx-panel p-3">
    <h3 className="font-bold">Master</h3><BeatMeter engine={engine} trackId="master" name="Master" />
    <MixRange liveMix={!!doc.master} vertical label="Master gain" value={master.gain} onChange={gain => change({ gain }, 'gain')} />
    <button className={button} aria-pressed={master.limiter} onClick={() => change({ limiter: !master.limiter }, 'limiter')}>Limiter</button>
    <RoomSize label="Reverb size" value={master.reverb.size} onChange={size => change({ reverb: { size } }, 'reverb')} />
    <MixRange liveMix={!!doc.master} label="Delay time (seconds)" value={master.delay.time} min={0.02} onChange={time => change({ delay: { time } }, 'delay:time')} />
    <MixRange liveMix={!!doc.master} label="Delay feedback" value={master.delay.feedback} max={0.8} onChange={feedback => change({ delay: { feedback } }, 'delay:feedback')} />
  </section>;
}
