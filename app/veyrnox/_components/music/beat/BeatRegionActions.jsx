'use client';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { button, input } from './beatStyles';

export default function BeatRegionActions({ region, track, locator, movePlayhead, snap, edit, selectPattern }) {
  const run = (change, label) => edit(change, { label, regionId: region?.id });
  return <div className="flex flex-wrap gap-2 rounded-xl border border-vx-border bg-vx-panel p-2 lg:hidden"
    role="group" aria-label="Region actions">
    <button className={button} aria-label="Move playhead left" onClick={() => movePlayhead(-snap)}>◀ playhead</button>
    <button className={button} aria-label="Move playhead right" onClick={() => movePlayhead(snap)}>playhead ▶</button>
    {region && <>
      <button className={button} onClick={() => run((d) => ops.moveRegion(d, region.id,
        Math.max(0, region.start - snap), track.id), 'move region')}>Move ◀</button>
      <button className={button} onClick={() => run((d) => ops.moveRegion(d, region.id,
        region.start + snap, track.id), 'move region')}>Move ▶</button>
      <button className={button} onClick={() => run((d) => ops.resizeRegion(d, region.id, region.length - snap), 'resize region')}>Shorter</button>
      <button className={button} onClick={() => run((d) => ops.resizeRegion(d, region.id, region.length + snap), 'resize region')}>Longer</button>
      <button className={button} onClick={() => run((d) => ops.trimRegionStart(d, region.id, region.start + snap), 'trim region')}>Trim start</button>
      <button className={button} onClick={() => run((d) => ops.splitRegion(d, region.id, locator), 'split region')}>Split at playhead</button>
      <button className={button} onClick={() => run((d) => ops.duplicateRegion(d, region.id), 'duplicate region')}>Duplicate</button>
      <button className={button} onClick={() => run((d) => ops.deleteRegion(d, region.id), 'delete region')}>Delete</button>
      {region.pattern && <label>Pattern <select className={input} value={region.pattern}
        onChange={(e) => {
          const slot = e.target.value;
          run((d) => ops.setRegionPattern(d, region.id, slot), 'change region pattern');
          selectPattern(slot);
        }}>
        {['A', 'B', 'C', 'D'].map((slot) => <option key={slot}>{slot}</option>)}
      </select></label>}
    </>}
  </div>;
}
