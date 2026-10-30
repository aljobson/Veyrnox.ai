import { View } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { useHandoffScope } from '../../lib/useHandoffScope';
import { refreshFilmReturns, returnMatches, type FilmReturn } from '../../lib/filmGenerationReturns';
import { localFilmId } from '../../lib/filmHandoffIdentity';
import type { Film } from '../../lib/filmStudio';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';

export function FilmGenerationHistory({ film, shotId, onResult }: { film: Film; shotId: string; onResult?: (id: string) => void }) {
    const { api } = useAuth(), router = useRouter(), begin = useHandoffScope();
    const [items, setItems] = useState<FilmReturn[]>([]);
    const filmId = localFilmId(film), latestFilm = useRef(film);
    latestFilm.current = film;
    (useFocusEffect ?? ((effect: () => void | (() => void)) => useEffect(effect, [effect])))(useCallback(() => {
        let live = true, delay = 5000, timer: ReturnType<typeof setTimeout> | undefined;
        const current = begin();
        setItems([]);
        const refresh = async () => {
            const rows = await refreshFilmReturns(api, latestFilm.current, () => live && current());
            if (!live || !current()) return;
            setItems(rows);
            if (rows.some(row => row.state === 'pending')) {
                timer = setTimeout(() => { void refresh(); }, delay);
                delay = Math.min(delay * 2, 60000);
            }
        };
        void refresh();
        return () => { live = false; clearTimeout(timer); };
    }, [api, filmId, begin]));
    const current = begin();
    const rows = items.filter(i => i.shotId === shotId);
    const line = (item: FilmReturn) => t(item.state === 'pending' ? 'job.running' : item.state === 'failed' ? 'library.status.failed' : returnMatches(film, item) ? 'handoff.filmAttached' : 'handoff.filmUnattached');
    useAnnouncement(rows.map(line).join('. '));
    return <>{rows.map(item => <View key={item.id}><Text>
        {t('filmOutput.version', { value1: shotId, value2: item.version, value3: line(item) })}</Text>
        <Button variant="tertiary" label={t('handoff.openFilmJob')} accessibilityLabel={t('handoff.openFilmJobVersion', { version: item.version })} onPress={() => { if (current()) router.push({ pathname: '/job/[id]', params: { id: item.id } }); }} />
        {onResult && item.state === 'succeeded' && returnMatches(film, item) ? <Button variant="tertiary" label={t('handoff.useFilmResult')} accessibilityLabel={t('handoff.useFilmResultVersion', { version: item.version })} onPress={() => { if (current()) onResult(item.id); }} /> : null}
    </View>)}</>;
}
