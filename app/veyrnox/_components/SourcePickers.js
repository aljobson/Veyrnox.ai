'use client';

// One upload field per media slot the model declares in the catalog
// (capabilities.media): a start image, a video to lip-sync, the speech.
// Types match /api/v1/uploads (lib/uploadSource.js); caps come from the slot.
const SLOTS = {
  image: { label: 'START IMAGE', accept: 'image/png,image/jpeg,image/webp', hint: 'PNG, JPEG or WebP, up to 20 MB', add: 'Add image' },
  video: { label: 'VIDEO', accept: 'video/mp4', hint: 'MP4 with a visible face, up to 100 MB', add: 'Add video' },
  audio: { label: 'SPEECH', accept: 'audio/mpeg,audio/wav', hint: 'MP3 or WAV, up to 20 MB', add: 'Add audio' },
};

const pill = 'font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border border-vx-border text-vx-fg-muted hover:text-vx-fg shrink-0';

/**
 * @param {object} props
 * @param {Record<string,{required:boolean,maxSeconds?:number,maxPixels?:number}>} props.media
 * @param {Record<string,{file:File, previewUrl:string}>} props.sources
 * @param {(slot:string, file:File|null) => void} props.onPick
 * @param {(() => void)|null} props.onDraw  shown for the image slot when set
 */
export function SourcePickers({ media, sources, onPick, onDraw }) {
  return Object.entries(media).filter(([slot]) => SLOTS[slot]).map(([slot, spec]) => {
    const ui = SLOTS[slot];
    const picked = sources[slot];
    const limits = [spec.maxSeconds && `up to ${spec.maxSeconds}s`, spec.maxPixels && `up to ${spec.maxPixels / 1e6} MP`].filter(Boolean);
    return (
      <div key={slot} className="mt-3 flex items-center gap-3 rounded-lg border border-vx-border bg-vx-panel p-3">
        {picked && slot === 'image' ? (
          <img src={picked.previewUrl} alt="Start image" className="w-16 h-16 rounded object-cover bg-black shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded border border-dashed border-vx-border shrink-0 flex items-center justify-center text-vx-fg-faint" aria-hidden="true">
            {picked ? '✓' : ''}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">
            {ui.label}{spec.required ? ' · REQUIRED' : ' · OPTIONAL'}
          </div>
          <div className="text-xs text-vx-fg-body truncate mt-1">
            {picked ? picked.file.name : [ui.hint, ...limits].join(', ')}
          </div>
        </div>
        {picked && slot === 'image' && onDraw && (
          <button onClick={onDraw} className={pill}>Draw</button>
        )}
        <label className={`${pill} cursor-pointer`}>
          {picked ? 'Replace' : ui.add}
          <input type="file" accept={ui.accept} className="sr-only"
            onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; onPick(slot, f || null); }} />
        </label>
        {picked && (
          <button onClick={() => onPick(slot, null)} aria-label={`Remove ${ui.label.toLowerCase()}`}
            className="font-vx-mono text-[11px] text-vx-fg-muted hover:text-vx-fg shrink-0">✕</button>
        )}
      </div>
    );
  });
}
