'use client';
import { useId, useState } from 'react';
import { useI18n } from '../../../../../components/I18nProvider';
import { searchClips } from '../../../_lib/music/beat/beatClipSearch.mjs';
import { formatPosition } from '../../../_lib/music/beat/beatTime.mjs';
import { button, input } from './beatStyles';

export default function BeatClipSearch({ doc, choose }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const resultsId = useId();
  // Regions have exact key sets and no name field: drums match only track names;
  // audio and MIDI also match asset and clip names. Render at most 20 results.
  const results = searchClips(doc, query), visible = results.slice(0, 20);
  return <div className="w-full min-w-0 space-y-2">
    <label className="flex flex-wrap items-center gap-2">{t('app.music.beat.search.label')}
      <input type="search" className={input} value={query} aria-controls={resultsId}
        onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setQuery(''); }
        }} />
    </label>
    <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-vx-fg-muted">
      {query.trim() ? t('app.music.beat.search.count', { count: results.length, shown: visible.length }) : t('app.music.beat.search.help')}
    </p>
    {query.trim() && <button className={button} onClick={() => setQuery('')}>{t('app.music.beat.search.clear')}</button>}
    {query.trim() && !results.length && <p className="text-sm text-vx-fg-muted">{t('app.music.beat.search.empty', { query })}</p>}
    <ul id={resultsId} role="list" aria-label={t('app.music.beat.search.results')} className="max-h-64 space-y-2 overflow-y-auto">
      {visible.map(result => {
        const track = doc.tracks.find(track => track.id === result.trackId);
        const region = track.regions.find(region => region.id === result.regionId);
        return <li key={result.regionId}><button className={`${button} w-full break-words text-start`} onClick={() => choose(result)}>
          {result.label === track.name
            ? t('app.music.beat.search.trackResult', { track: track.name, position: formatPosition(region.start, t) })
            : t('app.music.beat.search.result', { name: result.label, track: track.name, position: formatPosition(region.start, t) })}
        </button></li>;
      })}
    </ul>
  </div>;
}
