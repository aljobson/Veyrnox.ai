'use client';
export function MediaDetails({media,onChange}) {
    const field='w-full rounded border border-vx-border bg-vx-base p-2 text-xs',note=media.attribution||{credit:'',usage:'',url:''};
    const input=(label,value,max,onCommit)=><label className="block text-xs">{label}<input aria-label={label} key={`${media.id}:${label}:${value}`} defaultValue={value} maxLength={max} className={field} onBlur={e=>{if(e.target.value!==value)onCommit(e.target.value);}} /></label>;
    return <section aria-label="Media details" className="space-y-2 rounded border border-vx-border p-2"><h3 className="text-xs font-bold">Media details</h3>
        {input('Media display name',media.name,120,name=>onChange(media.id,{name:name.trim()}))}{input('Media folder',media.folder||'',80,folder=>onChange(media.id,{folder:folder.trim()}))}
        <p className="break-words text-xs text-vx-fg-muted">Original source: {media.sourceName||media.name}</p>
        <details><summary className="cursor-pointer text-xs">Rights and attribution</summary><div className="mt-2 space-y-2">
            {input('Media credit',note.credit,120,credit=>onChange(media.id,{attribution:{...note,credit}}))}{input('Media usage note',note.usage,240,usage=>onChange(media.id,{attribution:{...note,usage}}))}{input('Media source or licence URL',note.url,1000,url=>onChange(media.id,{attribution:{...note,url}}))}
            {note.url && <a href={note.url} target="_blank" rel="noopener noreferrer" className="text-xs text-vx-accent underline">Open recorded source or licence</a>}
        </div></details>
    </section>;
}
