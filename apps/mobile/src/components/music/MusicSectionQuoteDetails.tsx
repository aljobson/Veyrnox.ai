import { Text } from '../ui';
import { t } from '../../lib/i18n';
import { isMusicAddSectionQuote } from '../../lib/music/validateSectionActions';
import type { MusicAddSectionQuote, MusicReplaceQuote } from '../../lib/music/sectionActionTypes';
export function MusicSectionQuoteDetails({ quote }: { quote: MusicAddSectionQuote | MusicReplaceQuote }) {
    return <>
        <Text>{t('musicGenerationActions.duration', { seconds: quote.source_duration_seconds })}</Text>
        <Text>{t('musicSectionActions.pair', { total: quote.total_credits, each: quote.credits_per_candidate })}</Text>
        {isMusicAddSectionQuote(quote) ? <>
            <Text>{t(`musicSectionActions.position.${quote.position}`)}</Text>
            <Text>{t(`musicSectionActions.duration.${quote.duration_seconds}`)}</Text>
            <Text>{t(quote.instrumental ? 'musicSectionActions.instrumental' : 'musicSectionActions.withLyrics')}</Text>
        </> : <Text>{t('musicSectionActions.range', { start: quote.start_seconds, end: quote.end_seconds })}</Text>}
        <Text>{t('musicGenerationActions.charge')}</Text>
    </>;
}
