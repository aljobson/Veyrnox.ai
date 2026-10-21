import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../../auth/AuthProvider';
import { Action, CreatorClosed, ui, useCreatorOwner, useCreatorScope, WebLink } from '../../../../components/cinema/creator/RulesLinks';
import { ApiError } from '../../../../lib/api';
import { creatorMessage, listTitles, type CreatorTitle } from '../../../../lib/cinemaDrafts';
import { CINEMA_DEVICE_UPLOAD_ENABLED } from '../../../../lib/cinemaUpload';
import { cinemaUploadStore } from '../../../../lib/cinemaUploadStore';
import { t } from '../../../../lib/i18n';

export default function CreatorIndex() {
    const owner = useCreatorOwner();
    if (!CINEMA_DEVICE_UPLOAD_ENABLED || !owner) return <CreatorClosed />;
    return <Titles key={owner} />;
}
function Titles() {
    const { api } = useAuth(), scope = useCreatorScope();
    const [titles, setTitles] = useState<CreatorTitle[] | null>(null), [note, setNote] = useState('');
    const [waiting, setWaiting] = useState(false), generation = useRef(0), focused = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const load = useCallback(async () => {
        const n = ++generation.current;
        clearTimeout(timer.current);
        try {
            await cinemaUploadStore.reconcileStaged(scope.ticket); if (!focused.current || !scope.live()) return;
            const reply = await listTitles(api); if (!focused.current || !scope.live() || n !== generation.current) return;
            setTitles(reply.content); setNote(''); setWaiting(false);
        } catch (e) {
            if (!focused.current || !scope.live() || n !== generation.current) return;
            setNote(creatorMessage(e));
            if (e instanceof ApiError && e.status === 429) {
                setWaiting(true);
                timer.current = setTimeout(() => { if (focused.current && scope.live()) void load(); }, 60000);
            } else setWaiting(false);
        }
    }, [api, scope.ticket]);
    useFocusEffect(useCallback(() => {
        focused.current = true; void load();
        return () => { focused.current = false; generation.current++; clearTimeout(timer.current); };
    }, [load]));
    if (['cinemaUpload.role', 'cinemaUpload.closed'].includes(note)) return <CreatorClosed message={note} />;
    return <ScrollView contentContainerStyle={ui.page}>
        <Text accessibilityRole="header" style={ui.heading}>{t('cinemaUpload.titles')}</Text>
        <Action label={t('cinemaUpload.new')} onPress={() => router.push('/cinema/creator/draft')} />
        {note ? <><Text style={ui.text}>{t(note)}</Text><Action label={t('cinemaUpload.retry')} disabled={waiting} onPress={() => void load()} /></> : null}
        {!titles && !note && <Text style={ui.text}>{t('cinemaUpload.loading')}</Text>}
        {titles?.length === 0 && <Text style={ui.text}>{t('cinemaUpload.empty')}</Text>}
        {titles?.map(title => <View key={title.id} style={ui.card}>
            <Text accessibilityRole="header" style={ui.heading}>{title.title}</Text><Text style={ui.text}>{title.content_type}</Text>
            <Text style={ui.text}>{t(`cinemaUpload.state.${['DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'SUSPENDED'].includes(title.lifecycle_status) ? title.lifecycle_status : 'other'}`)}</Text>
            {title.review_note ? <Text style={ui.text}>{title.review_note}</Text> : null}
            {title.video_ready && <Text style={ui.text}>{t('cinemaUpload.videoReady')}</Text>}
            {title.content_type === 'SERIES' ? <WebLink label={t('cinemaUpload.series')} /> :
                <Action label={title.title} onPress={() => router.push({ pathname: '/cinema/creator/[id]', params: { id: title.id } })} />}
        </View>)}
        <WebLink />
    </ScrollView>;
}
