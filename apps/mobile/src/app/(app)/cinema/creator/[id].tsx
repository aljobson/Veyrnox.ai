import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { useAuth } from '../../../../auth/AuthProvider';
import { Action, CreatorClosed, RulesLinks, ui, useCreatorOwner, useCreatorScope, WebLink } from '../../../../components/cinema/creator/RulesLinks';
import { UploadPanel } from '../../../../components/cinema/creator/UploadPanel';
import { SubmitPanel } from '../../../../components/cinema/creator/SubmitPanel';
import { creatorMessage, DRAFT_TYPES, listTitles, type CreatorTitle } from '../../../../lib/cinemaDrafts';
import { CINEMA_DEVICE_UPLOAD_ENABLED } from '../../../../lib/cinemaUpload';
import { t } from '../../../../lib/i18n';

export default function CreatorDetail() {
    const owner = useCreatorOwner(), { id } = useLocalSearchParams<{ id: string }>();
    if (!CINEMA_DEVICE_UPLOAD_ENABLED || !owner) return <CreatorClosed />;
    return <Detail key={`${owner}:${id}`} id={id} />;
}
function Detail({ id }: { id: string }) {
    const { api } = useAuth(), scope = useCreatorScope();
    const [title, setTitle] = useState<CreatorTitle | null>(null), [note, setNote] = useState('');
    const load = useCallback(async () => {
        try {
            const result = await listTitles(api); if (!scope.live()) return;
            const found = result.content.find(c => c.id === id); setTitle(found ?? null); setNote(found ? '' : 'cinemaUpload.closed');
        } catch (e) { if (scope.live()) setNote(creatorMessage(e)); }
    }, [api, id, scope.ticket]);
    useFocusEffect(useCallback(() => { void load(); }, [load]));
    if (['cinemaUpload.closed', 'cinemaUpload.role'].includes(note)) return <CreatorClosed message={note} />;
    const editable = title?.lifecycle_status === 'DRAFT' && DRAFT_TYPES.some(x => x === title.content_type);
    return <ScrollView contentContainerStyle={ui.page}>
        {note ? <><Text style={ui.text}>{t(note)}</Text><Action label={t('cinemaUpload.retry')} onPress={() => void load()} /></> : null}
        {!title && !note && <Text style={ui.text}>{t('cinemaUpload.loading')}</Text>}
        {title && <>
            <Text style={ui.heading} accessibilityRole="header">{title.title}</Text>
            <Text style={ui.text}>{t(`cinemaUpload.state.${['DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'SUSPENDED'].includes(title.lifecycle_status) ? title.lifecycle_status : 'other'}`)}</Text>
            {title.review_note ? <Text style={ui.text}>{title.review_note}</Text> : null}
            {title.content_type === 'SERIES' ? <WebLink label={t('cinemaUpload.series')} /> : <UploadPanel contentId={id} editable={!!editable} onChange={() => void load()} />}
            {editable && <Action label={t('cinemaUpload.edit')} onPress={() => router.push({ pathname: '/cinema/creator/draft', params: { id } })} />}
            {editable && title.video_ready && <SubmitPanel title={title} onDone={() => { setTitle({ ...title, lifecycle_status: 'UNDER_REVIEW' }); void load(); }} />}
        </>}
        <RulesLinks />
    </ScrollView>;
}
