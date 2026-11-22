import { useState } from 'react';
import { View } from 'react-native';
import { Button, Text, TextField, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { searchClips, type ClipSearchResult } from '../../lib/beatNative/clipSearch';
import { type BeatDoc } from '../../lib/beatNative/doc';
import { position } from '../../lib/beatNative/regionActions';

type Props = { doc: BeatDoc; choose: (result: ClipSearchResult) => void; disabled?: boolean };

export function BeatClipSearch({ doc, choose, disabled = false }: Props) {
    const s = useThemedStyles(sheets);
    const [query, setQuery] = useState('');
    const searching = !!query.trim();
    const results = searchClips(doc, query);
    const visible = results.slice(0, 20);
    const clear = () => setQuery('');
    return <View style={s.group} testID="beat-clip-search">
        <TextField label={t('beat.search.label')} accessibilityLabel={t('beat.search.label')}
            value={query} onChangeText={setQuery} editable={!disabled} autoCorrect={false} returnKeyType="search"
            clearButtonMode="while-editing" onKeyPress={event => {
                if (event.nativeEvent.key !== 'Escape') return;
                event.preventDefault?.(); clear();
            }} />
        <Text testID="beat-search-status" variant="footnote" tone="secondary" accessibilityLiveRegion="polite">
            {searching ? t('beat.search.count', { count: results.length, shown: visible.length }) : t('beat.search.help')}
        </Text>
        {searching ? <Button size="md" variant="secondary" label={t('beat.search.clear')} disabled={disabled} onPress={clear} /> : null}
        {searching && !results.length ? <Text variant="footnote" tone="secondary">{t('beat.search.empty', { query })}</Text> : null}
        {searching && !!results.length ? <Text variant="bodyStrong" accessibilityRole="header">{t('beat.search.results')}</Text> : null}
        <View style={s.results}>
            {visible.map(result => {
                const track = doc.tracks.find(item => item.id === result.trackId);
                const region = track?.regions.find(item => item.id === result.regionId);
                if (!track || !region) return null;
                const label = result.label === track.name
                    ? t('beat.search.trackResult', { track: track.name, position: position(region.start) })
                    : t('beat.search.result', { name: result.label, track: track.name, position: position(region.start) });
                return <Button key={`${result.trackId}:${result.regionId}`} testID={`beat-search-result-${result.regionId}`}
                    size="md" variant="secondary" label={label} disabled={disabled} onPress={() => choose(result)}
                    containerStyle={s.result} style={s.resultButton} textStyle={s.resultText} />;
            })}
        </View>
    </View>;
}

const sheets = themedStyles(() => ({
    group: { gap: ds.space.sm },
    results: { gap: ds.space.sm },
    result: { width: '100%' },
    resultButton: { width: '100%', justifyContent: 'flex-start' },
    resultText: { flexShrink: 1, textAlign: 'auto' },
}));
