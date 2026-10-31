import { rawText } from '../../../../lib/i18n/translate';
import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../../auth/AuthProvider';
import { Action, CreatorClosed, RulesLinks, ui, useCreatorOwner, useCreatorScope } from '../../../../components/cinema/creator/RulesLinks';
import { UploadPanel } from '../../../../components/cinema/creator/UploadPanel';
import { SubmitPanel } from '../../../../components/cinema/creator/SubmitPanel';
import { bodyKeys, jsonWrite } from '../../../../lib/cinemaDrafts';
import { ApiError } from '../../../../lib/api';
import { childType, fetchCreatorPoster, listContent, parentTypeOf, ROOT_TYPES, studioMessage, VIDEO_TYPES, withdrawBody, type StudioTitle } from '../../../../lib/cinemaStudio';
import { isUuid } from '../../../../lib/cinemaSocial';
import { CINEMA_DEVICE_UPLOAD_ENABLED } from '../../../../lib/cinemaUpload';
import { t } from '../../../../lib/i18n';

const typeLabel = (type: string) => t(type === 'SERIES' ? 'cinema.type.SERIES' : type === 'SEASON' ? 'cinema.type.SEASON' : 'cinema.type.EPISODE');

export default function CreatorDetail() {
    const owner = useCreatorOwner(), { id, parent } = useLocalSearchParams<{ id: string; parent?: string }>();
    if (!CINEMA_DEVICE_UPLOAD_ENABLED || !owner || (parent !== undefined && !isUuid(parent))) return <CreatorClosed />;
    return <Detail key={`${owner}:${id}:${parent ?? ''}`} id={id} parent={parent} />;
}
const stateKey = (state: string) => `cinemaUpload.state.${['DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'SUSPENDED'].includes(state) ? state : 'other'}`;
function Detail({ id, parent }: { id: string; parent?: string }) {
    const { api } = useAuth(), scope = useCreatorScope();
    const [title, setTitle] = useState<StudioTitle | null>(null), [note, setNote] = useState('');
    const [children, setChildren] = useState<StudioTitle[]>([]), [poster, setPoster] = useState<string | null>(null);
    const [reason, setReason] = useState(() => t('cinema.creatorWorkspace.creatorWithdrawal'));
    const [withdrawNote, setWithdrawNote] = useState(''), [withdrawHidden, setWithdrawHidden] = useState(false), [busy, setBusy] = useState(false);
    const keys = useRef(bodyKeys()).current, sending = useRef(false), generation = useRef(0);
    const load = useCallback(async () => {
        const n = ++generation.current;
        const live = () => scope.live() && n === generation.current;
        setPoster(null);
        try {
            const result = await listContent(api, parent); if (!live()) return;
            const found = result.content.find(c => c.id === id); setTitle(found ?? null); setNote(found ? '' : 'cinemaUpload.closed');
            setChildren([]);
            if (found && childType(found.content_type)) {
                const result = await listContent(api, id); if (!live()) return; setChildren(result.content);
            }
            if (found?.video_ready && VIDEO_TYPES.some(type => type === found.content_type)) {
                const image = await fetchCreatorPoster(api, id); if (live()) setPoster(image);
            }
        } catch (e) { if (live()) setNote(studioMessage(e)); }
    }, [api, id, parent, scope.ticket]);
    useFocusEffect(useCallback(() => { void load(); }, [load]));
    const withdraw = async () => {
        if (!scope.live() || sending.current || parent || !title || !['UNDER_REVIEW', 'PUBLISHED'].includes(title.lifecycle_status)) return;
        let body: ReturnType<typeof withdrawBody>;
        try { body = withdrawBody(id, reason); } catch { return; }
        sending.current = true; setBusy(true); setWithdrawNote('');
        try {
            await jsonWrite(api, '/api/v1/cinema/content/withdraw', body, keys.for(body)); if (!scope.live()) return;
            keys.finish(body); setWithdrawNote('cinema.creatorWorkspace.withdrawnItIsAPrivateDraft');
            setTitle({ ...title, lifecycle_status: 'DRAFT' }); await load();
        } catch (e) {
            if (!scope.live()) return;
            keys.finish(body, e);
            const role = e instanceof ApiError && e.status === 403 && ['creator_required', 'account_not_active', 'not_authorized'].includes(e.code);
            setWithdrawNote(role ? 'cinemaUpload.role' : studioMessage(e));
            if (role || (e instanceof ApiError && e.code === 'publishing_not_open')) setWithdrawHidden(true);
        } finally { if (scope.live()) { sending.current = false; setBusy(false); } }
    };
    if (['cinemaUpload.closed', 'cinemaUpload.role'].includes(note)) return <CreatorClosed message={note} />;
    if (withdrawNote === 'cinemaUpload.role') return <CreatorClosed message={withdrawNote} />;
    const draft = title?.lifecycle_status === 'DRAFT';
    const video = !!title && VIDEO_TYPES.some(x => x === title.content_type), editable = draft && video;
    const canEdit = draft && !!title && [...ROOT_TYPES, 'SEASON', 'EPISODE'].includes(title.content_type);
    const child = title ? childType(title.content_type) : null;
    const withdrawLabel = t(title?.lifecycle_status === 'PUBLISHED' ? 'cinema.creatorWorkspace.withdrawFromCinema' : 'cinema.creatorWorkspace.withdrawSubmission');
    // The native image module is only needed when a validated poster is present.
    const Image: typeof import('expo-image').Image | null = poster ? require('expo-image').Image : null;
    const reasonLength = [...reason.trim()].length;
    return <ScrollView contentContainerStyle={ui.page}>
        {note ? <><Text style={ui.text}>{t(note)}</Text><Action label={t('cinemaUpload.retry')} onPress={() => void load()} /></> : null}
        {!title && !note && <Text style={ui.text}>{t('cinemaUpload.loading')}</Text>}
        {title && <>
            <Text style={ui.heading} accessibilityRole="header">{title.title}</Text>
            <Text style={ui.text}>{t(stateKey(title.lifecycle_status))}</Text>
            {title.review_note ? <Text style={ui.text}>{title.review_note}</Text> : null}
            {child && <>
                {children.length === 0 && <Text style={ui.text}>{t('cinema.creator.first', { type: typeLabel(child) })}</Text>}
                {children.map(item => <View key={item.id} style={ui.card}>
                    <Text style={ui.heading} accessibilityRole="header">{t('cinemaStudio.numbered', { type: typeLabel(item.content_type), position: item.position ?? '' })}</Text>
                    <Action label={item.title} onPress={() => router.push({ pathname: '/cinema/creator/[id]', params: { id: item.id, parent: id } })} />
                    <Text style={ui.text}>{t(stateKey(item.lifecycle_status))}</Text>
                    {item.video_ready && <Text style={ui.text}>{t('cinemaUpload.videoReady')}</Text>}
                </View>)}
                {draft && <Action label={t('cinema.creator.newType', { type: typeLabel(child) })} onPress={() => router.push({ pathname: '/cinema/creator/draft', params: { parent: id, parentType: title.content_type } })} />}
            </>}
            {video && <UploadPanel contentId={id} parent={parent} editable={!!editable} onChange={() => void load()} />}
            {video && title.video_ready && poster && Image && <View style={ui.card}>
                <Image source={{ uri: poster }} cachePolicy="none" accessibilityLabel={rawText(t('cinema.upload.poster', { title: title.title }))} style={{ width: '100%', aspectRatio: 16 / 9 }} />
                <Text style={ui.text}>{t('cinema.videoUpload.automaticPosterFrame')}</Text>
            </View>}
            {canEdit && <Action label={t('cinemaUpload.edit')} onPress={() => router.push({ pathname: '/cinema/creator/draft', params: { id, ...(parent ? { parent, parentType: parentTypeOf(title.content_type)! } : {}) } })} />}
            {!parent && draft && (title.content_type === 'SERIES' || (editable && title.video_ready)) && <SubmitPanel title={title} onDone={() => { if (scope.live()) { setTitle({ ...title, lifecycle_status: 'UNDER_REVIEW' }); void load(); } }} />}
            {!parent && !withdrawHidden && ['UNDER_REVIEW', 'PUBLISHED'].includes(title.lifecycle_status) && <View style={ui.card}>
                <Text style={ui.heading} accessibilityRole="header">{withdrawLabel}</Text>
                <TextInput style={ui.input} accessibilityLabel={t('cinema.creatorWorkspace.reasonKeptInTheAuditRecord')} placeholder={t('cinema.creatorWorkspace.reasonKeptInTheAuditRecord')} value={reason} onChangeText={setReason} editable={!busy} multiline />
                <Action label={withdrawLabel} disabled={busy || reasonLength < 3 || reasonLength > 500} onPress={() => Alert.alert(withdrawLabel, t(title.lifecycle_status === 'PUBLISHED' ? 'cinemaStudio.withdrawPublished' : 'cinemaStudio.withdrawReview', { title: title.title }), [
                    { text: t('cinema.creatorWorkspace.cancel'), style: 'cancel' }, { text: withdrawLabel, style: 'destructive', onPress: () => void withdraw() },
                ])} />
            </View>}
            {withdrawNote ? <Text style={ui.text}>{t(withdrawNote)}</Text> : null}
        </>}
        <RulesLinks />
    </ScrollView>;
}
