import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, View } from 'react-native';
import { AudioTemplateCard } from '../templates/AudioTemplateCard';
import { PresetCard } from './PresetCard';
import { priceLines } from '../../lib/catalogPages';
import { isDirectTemplate, packFullRows, priceOfDirect } from '../../lib/exploreTemplates';
import { presetPrice, type Preset } from '../../lib/presets';
import type { AudioTemplate } from '../../lib/audioTemplates';
import type { CatalogModel } from '../../lib/media';
import { themedStyles, useThemedStyles } from '../ui';

// Explore's template grid. Audio templates are full-width rows with a small play tile; every other template is a poster
// card, and a video one plays its preview on the poster. One preview plays at a time, and it stops when the screen loses
// focus or the app goes to the background.
interface ExploreTemplateGridProps {
    readonly shown: readonly Preset[];
    readonly audio: readonly AudioTemplate[];
    readonly models: ReadonlyMap<string, CatalogModel>;
    onOpen(preset: Preset): void;
}

const AUDIO_PREFIX = 'audio:';

export function ExploreTemplateGrid({ shown, audio, models, onOpen }: ExploreTemplateGridProps) {
    const styles = useThemedStyles(sheets);
    const [playing, setPlaying] = useState<string | null>(null);
    const audioById = useMemo(() => new Map(audio.map((a) => [AUDIO_PREFIX + a.id, a])), [audio]);
    const rows = useMemo(() => packFullRows(shown, (preset) => audioById.has(preset.id)), [shown, audioById]);
    useFocusEffect(useCallback(() => () => setPlaying(null), []));
    useEffect(() => {
        const sub = AppState.addEventListener('change', (state) => { if (state !== 'active') setPlaying(null); });
        return () => sub.remove();
    }, []);
    const open = (preset: Preset) => { setPlaying(null); onOpen(preset); };
    const toggle = (id: string) => setPlaying((current) => (current === id ? null : id));
    return (
        <View style={styles.grid}>
            {rows.map((preset) => {
                const track = audioById.get(preset.id);
                if (track) {
                    const model = models.get(track.modelId);
                    return <AudioTemplateCard key={preset.id} template={track} style={styles.row} credits={model ? priceLines(model)[0]?.credits : undefined}
                        playing={playing === preset.id} onPlay={() => toggle(preset.id)} onOpen={() => open(preset)} />;
                }
                return <PresetCard key={preset.id} preset={preset} price={isDirectTemplate(preset.id) ? priceOfDirect(preset, models) : presetPrice(preset)} onOpen={open}
                    playing={playing === preset.id} onPlay={() => toggle(preset.id)} />;
            })}
        </View>
    );
}

const sheets = themedStyles(() => ({
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
    row: { width: '100%' },
}));
