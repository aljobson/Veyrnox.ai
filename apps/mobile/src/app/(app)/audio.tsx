import { useMusicAvailable } from '../../lib/music/useMusicAvailable';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { rawText } from '../../lib/i18n/translate';
import { AUDIO_ICONS, AUDIO_PERFORMANCES, AUDIO_STUDIOS, audioTarget, fromCredits, type AudioHubId } from '../../lib/audioHub';
import { plural, t } from '../../lib/i18n';
import { fetchCatalogCached, type CatalogModel } from '../../lib/media';
import type { CacheMeta } from '../../lib/cache';
import { ds } from '../../theme';
import { Card, ListRow, Text, themedStyles, useThemedStyles } from '../../components/ui';

const upperFirst = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

const copy = (): Record<AudioHubId, { title: string; blurb: string }> => ({
    yourMusic: { title: t('music.title'), blurb: t('music.entryBody') },
    music: { title: t('audioHub.music.title'), blurb: t('audioHub.music.blurb') },
    speech: { title: t('audioHub.speech.title'), blurb: t('audioHub.speech.blurb') },
    dialogue: { title: t('audioHub.dialogue.title'), blurb: t('audioHub.dialogue.blurb') },
    lipSync: { title: t('audioHub.lipSync.title'), blurb: t('audioHub.lipSync.blurb') },
    dubbing: { title: t('audioHub.dubbing.title'), blurb: t('audioHub.dubbing.blurb') },
    talkingPhoto: { title: t('audioHub.talkingPhoto.title'), blurb: t('audioHub.talkingPhoto.blurb') },
    singingPhoto: { title: t('audioHub.singingPhoto.title'), blurb: t('audioHub.singingPhoto.blurb') },
});

// Each row opens an existing workflow; this hub owns no generation logic.
export default function AudioHub() {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    const text = copy();
    const musicAvailable = useMusicAvailable();
    const [catalog, setCatalog] = useState<{ models: CatalogModel[] | null; meta: CacheMeta | null }>({ models: null, meta: null });
    useEffect(() => { void fetchCatalogCached((models, meta) => setCatalog({ models, meta })).catch(() => {}); }, []);
    const fresh = catalog.meta !== null && !catalog.meta.stale;
    const groups: { title: string; ids: readonly AudioHubId[] }[] = [
        { title: t('audioHub.groups.musicVoice'), ids: musicAvailable ? ['yourMusic', ...AUDIO_STUDIOS] : AUDIO_STUDIOS },
        { title: t('audioHub.groups.performance'), ids: AUDIO_PERFORMANCES },
    ];
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('audioHub.title') }} />
            <Text variant="title1" accessibilityRole="header">{t('audioHub.title')}</Text>
            <Text variant="body" tone="secondary">{t('audioHub.intro')}</Text>
            {groups.map((group) => (
                <View key={group.title} style={styles.group}>
                    <Text variant="bodyStrong" accessibilityRole="header">{group.title}</Text>
                    <Card>
                        {group.ids.map((id) => {
                            const credits = fromCredits(catalog.models, id, musicAvailable, fresh);
                            return <ListRow
                                key={id}
                                icon={AUDIO_ICONS[id]}
                                accessibilityRole="button"
                                accessibilityLabel={rawText(credits === null ? text[id].title : `${text[id].title}, ${plural('create.from', credits)}`)}
                                title={<Text variant="bodyStrong">{text[id].title}</Text>}
                                subtitle={credits === null ? text[id].blurb : `${text[id].blurb}\n${upperFirst(plural('create.from', credits))}`}
                                onPress={() => router.push(audioTarget(id, catalog.models, musicAvailable) as never)}
                            />;
                        })}
                    </Card>
                </View>
            ))}
        </ScrollView>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.lg, gap: ds.space.md },
    group: { gap: ds.space.sm },
}));
