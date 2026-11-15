'use client';
import { button } from './beatStyles';
export default function BeatLibraryItem({ item, active, audition, add, busy }) {
  return <li className="rounded-xl border border-vx-border p-2" draggable={!busy}
    onDragStart={(event) => { event.dataTransfer.setData('application/x-beat-sound', JSON.stringify(item)); event.dataTransfer.effectAllowed = 'copy'; }}>
    <div className="flex min-w-0 items-center gap-2">
      <button className={`${button} min-w-11`} aria-label={`${active ? 'Stop' : 'Audition'} ${item.name}`} aria-pressed={active}
        onClick={() => audition(item)}>{active ? '■' : '▶'}</button>
      <div className="min-w-0 flex-1"><p className="truncate font-bold" title={item.name}>{item.name}</p>
        <p className="text-xs text-vx-fg-muted">{item.source === 'sound' ? `${item.category} · ${item.bars} bars` : item.durationSec ? `${Math.round(item.durationSec)} seconds` : 'Song version'}</p></div>
      <button className={button} disabled={busy} aria-label={`Add ${item.name}`} onClick={() => add(item)}>Add</button>
    </div>
  </li>;
}
