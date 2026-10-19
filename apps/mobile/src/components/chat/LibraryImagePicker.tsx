import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { MIN_TARGET } from '../../lib/a11y';
import { libraryImageJobs, roomFor, type ChatImage } from '../../lib/chatAttach';
import { t } from '../../lib/i18n';
import { fetchCatalog, mediaApi, type Job } from '../../lib/media';
import { colors } from '../../theme';

interface Props {
    readonly visible: boolean;
    readonly chosen: readonly ChatImage[];
    readonly max: number;
    readonly onPick: (image: ChatImage) => void;
    readonly onClose: () => void;
}

// The person's own finished images. Choosing one attaches it by the id of the job that made it; nothing is uploaded or charged
// here. The server checks it is theirs and really an image when the reply is sent.
export function LibraryImagePicker({ visible, chosen, max, onPick, onClose }: Props) {
    const { api } = useAuth();
    const [jobs, setJobs] = useState<Job[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!visible || jobs) return;
        setFailed(false);
        Promise.all([mediaApi(api).listJobs(), fetchCatalog()])
            .then(([page, catalog]) => setJobs(libraryImageJobs(page.jobs, catalog)))
            .catch(() => setFailed(true));
    }, [api, visible, jobs]);

    const taken = new Set(chosen.map((c) => c.assetId));
    const full = roomFor(chosen.length, max) === 0;
    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <View style={styles.screen}>
                <Text style={styles.title} accessibilityRole="header">{t('chat.attach.library')}</Text>
                {failed ? <Text style={styles.msg}>{t('chat.attach.libraryFailed')}</Text> : jobs === null ? <ActivityIndicator color={colors.accent} /> : jobs.length === 0 ? <Text style={styles.msg}>{t('chat.attach.libraryEmpty')}</Text> : (
                    <FlatList
                        data={jobs}
                        numColumns={3}
                        keyExtractor={(j) => j.job_id}
                        renderItem={({ item }) => <Tile job={item} disabled={full || taken.has(item.job_id)} onPick={onPick} />}
                    />
                )}
                <Pressable accessibilityRole="button" style={styles.done} onPress={onClose}><Text style={styles.doneText}>{t('chat.attach.done')}</Text></Pressable>
            </View>
        </Modal>
    );
}

function Tile({ job, disabled, onPick }: { job: Job; disabled: boolean; onPick: (image: ChatImage) => void }) {
    const { api } = useAuth();
    const [uri, setUri] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        mediaApi(api).getAsset(job.job_id).then((a) => live && setUri(a.url), () => undefined);
        return () => {
            live = false;
        };
    }, [api, job.job_id]);
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={job.label || t('chat.attach.libraryImage')}
            accessibilityState={{ disabled }}
            disabled={disabled || !uri}
            style={[styles.tile, disabled && styles.off]}
            onPress={() => uri && onPick({ id: `a-${job.job_id}`, assetId: job.job_id, preview: uri })}
        >
            {uri ? <Image source={{ uri }} style={styles.img} /> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, paddingTop: 56, gap: 12 },
    title: { color: colors.text, fontSize: 20, fontWeight: '600' },
    msg: { color: colors.muted },
    tile: { flex: 1 / 3, aspectRatio: 1, margin: 2, backgroundColor: colors.surface, borderRadius: 8, overflow: 'hidden' },
    img: { flex: 1 },
    off: { opacity: 0.35 },
    done: { minHeight: MIN_TARGET, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12 },
    doneText: { color: colors.accentInk, fontWeight: '600' },
});
