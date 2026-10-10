'use client';
import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { EDITOR_EXPORT_HEIGHTS, EDITOR_EXPORT_RATES, EXPORT_BITRATES } from '../../_lib/editorExportSettings.mjs';
import { timelineSize } from '../../_lib/editorRender.mjs';
export function ExportPanel({ tl, name, onName, height, onHeight, disabled, exporting, progress, result, blocker, onExport, onCancel, onCover }) {
    const [frameRate, setFrameRate] = useState(30), [format, setFormat] = useState('mp4'), [quality, setQuality] = useState('standard'), [cover, setCover] = useState(null), [coverError, setCoverError] = useState('');
    const field = 'w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs', size = timelineSize(tl, height);
    useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.url); }, [cover]);
    async function coverFrame() { try { const blob = await onCover(); setCover({ url: URL.createObjectURL(blob), name: 'veyrnox-cover.png' }); setCoverError(''); } catch { setCoverError('The current frame could not be saved. Relink its source and retry.'); } }
    return <div className="space-y-2"><h3 className="text-xs font-bold">Export</h3><fieldset disabled={disabled} className="space-y-2">
        <label className="block text-xs">File name<input aria-label="Export file name" className={field} value={name} maxLength={60} onChange={e => onName(e.target.value)} /></label>
        <label className="block text-xs">Size<select aria-label="Export size" className={field} value={height} onChange={e => onHeight(Number(e.target.value))}>{EDITOR_EXPORT_HEIGHTS.map(n => <option key={n} value={n}>{n}p{n === 1440 ? ' · 2K' : n === 2160 ? ' · 4K' : ''}</option>)}</select></label><p className="text-[10px] text-vx-fg-muted">{size.width} × {size.height} pixels</p>
        <label className="block text-xs">Frame rate<select aria-label="Export frame rate" className={field} value={frameRate} onChange={e => setFrameRate(Number(e.target.value))}>{EDITOR_EXPORT_RATES.map(n => <option key={n} value={n}>{n} fps</option>)}</select></label>
        <label className="block text-xs">Container<select aria-label="Export format" className={field} value={format} onChange={e => setFormat(e.target.value)}><option value="mp4">MP4 · H.264 / AAC</option><option value="mov">MOV · H.264 / AAC</option></select></label>
        <label className="block text-xs">Quality<select aria-label="Export quality" className={field} value={quality} onChange={e => setQuality(e.target.value)}>{Object.entries(EXPORT_BITRATES).map(([q, rate]) => <option key={q} value={q}>{q} · {rate / 1000000} Mbps</option>)}</select></label>
        <Button size="sm" disabled={!tl.video.length && !tl.audio.length && !tl.text.length || !!blocker} onClick={() => onExport({ frameRate, format, quality })}>Export {format.toUpperCase()}</Button><Button size="sm" variant="ghost" onClick={coverFrame}>Save cover frame</Button>
    </fieldset>{blocker && <p className="text-xs">{blocker}</p>}{exporting && <><progress aria-label="Export progress" value={progress} max={1} className="w-full" /><Button size="sm" onClick={onCancel}>Cancel export</Button></>}
    {result && <p role="status"><a className="text-xs text-vx-accent underline" href={result.url} download={result.name}>Download {result.name}</a></p>}{coverError && <p role="alert" className="text-xs">{coverError}</p>}{cover && <a className="block text-xs text-vx-accent underline" href={cover.url} download={cover.name}>Download cover PNG</a>}<p className="text-[10px] text-vx-fg-muted">Export uses the source frames at the chosen rate. Higher rates do not create new motion between source frames.</p></div>;
}
