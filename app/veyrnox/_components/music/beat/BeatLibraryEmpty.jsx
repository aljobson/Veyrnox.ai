'use client';
import { useI18n } from '../../../../../components/I18nProvider';
import { BEAT_SOUNDS } from '../../../_lib/music/beat/beatSounds.mjs';
import { suggestBeatCategories } from '../../../_lib/music/beat/beatLibrarySuggestions.mjs';
import { button } from './beatStyles';
export default function BeatLibraryEmpty({ query, clear, chooseCategory, generate }) {
  const { t } = useI18n();
  return <div role="status" className="space-y-2">
    <p>{t('app.music.beat.library.noResults', { query })}</p>
    <button className={button} aria-label={t('app.music.beat.library.clearFilters')} onClick={clear}>{t('app.music.beat.library.clear')}</button>
    <p>{t('app.music.beat.library.suggestion')}</p>
    <div className="flex flex-wrap gap-2">
      {suggestBeatCategories(query, BEAT_SOUNDS).map(category => <button key={category} className={button} onClick={() => chooseCategory(category)}>{t(`app.music.beat.library.category.${category}`)}</button>)}
      {generate && <button className={button} onClick={generate}>{t('app.music.beat.library.generate')}</button>}
    </div>
  </div>;
}
