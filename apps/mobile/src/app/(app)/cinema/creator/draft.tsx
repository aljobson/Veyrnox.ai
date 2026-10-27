import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, TextInput } from 'react-native';
import { useAuth } from '../../../../auth/AuthProvider';
import { Action, Check, CreatorClosed, ui, useCreatorOwner, useCreatorScope } from '../../../../components/cinema/creator/RulesLinks';
import { CATEGORIES, categoryKey } from '../../../../lib/cinemaBrowse';
import { AI_DISCLOSURES, bodyKeys, emptyDraft, jsonWrite, type DraftInput } from '../../../../lib/cinemaDrafts';
import { childType, listContent, nextPosition, parentTypeOf, ROOT_TYPES, studioDraftBody, studioMessage, type StudioTitle } from '../../../../lib/cinemaStudio';
import { isUuid } from '../../../../lib/cinemaSocial';
import { CINEMA_DEVICE_UPLOAD_ENABLED } from '../../../../lib/cinemaUpload';
import { t } from '../../../../lib/i18n';

const typeLabel = (type: string) => t(type === 'SERIES' ? 'cinema.type.SERIES' : type === 'SEASON' ? 'cinema.type.SEASON' : 'cinema.type.EPISODE');

type Params = { id?: string; parent?: string; parentType?: string };
export default function CreatorDraft() {
    const owner = useCreatorOwner(), { id, parent, parentType } = useLocalSearchParams<Params>();
    const validParent = parent === undefined ? parentType === undefined : isUuid(parent) && ['SERIES', 'SEASON'].includes(parentType ?? '');
    if (!CINEMA_DEVICE_UPLOAD_ENABLED || !owner || !validParent) return <CreatorClosed />;
    return <DraftEditor key={`${owner}:${id ?? 'new'}:${parent ?? ''}:${parentType ?? ''}`} id={id} parent={parent} parentType={parentType} />;
}
function DraftEditor({ id, parent, parentType }: Params) {
    const { api } = useAuth(), scope = useCreatorScope();
    const [form, setForm] = useState<DraftInput>(() => ({ ...emptyDraft(), ...(parent ? { content_type: childType(parentType!)! } : {}) }));
    const [original, setOriginal] = useState<StudioTitle | null>(null), [position, setPosition] = useState('');
    const [loading, setLoading] = useState(!!id || !!parent), [busy, setBusy] = useState(false), [note, setNote] = useState('');
    const keys = useRef(bodyKeys()).current, sending = useRef(false);
    const load = async () => {
        if (!id && !parent) return;
        setLoading(true);
        try {
            const { content } = await listContent(api, parent); if (!scope.live()) return;
            if (!id) { setPosition(String(nextPosition(content))); setNote(''); return; }
            const title = content.find(c => c.id === id);
            if (!title || title.lifecycle_status !== 'DRAFT' || (parent ? parentTypeOf(title.content_type) !== parentType : !ROOT_TYPES.some(x => x === title.content_type))) { setNote('cinemaUpload.closed'); return; }
            setOriginal(title); setForm({ ...title, categories: title.categories ?? [], ai_disclosures: title.ai_disclosures ?? [] }); setNote('');
        } catch (e) { if (scope.live()) setNote(studioMessage(e)); }
        finally { if (scope.live()) setLoading(false); }
    };
    useEffect(() => { void load(); }, []); // The route key remounts on structure/account changes.
    const save = async () => {
        if (sending.current || !scope.live() || loading || (id && !original)) return;
        const number = original?.position ?? Number(position);
        if (parent && (!Number.isInteger(number) || number < 1 || number > 10000)) { setNote('cinemaStudio.positionInvalid'); return; }
        sending.current = true; setBusy(true); setNote('');
        let body: unknown;
        try {
            body = { ...studioDraftBody(form, { parentId: parent ?? null, parentType: parentType ?? null, position: parent ? number : null }), ...(original ? { id: original.id, revision: original.revision } : {}) };
            const result = await jsonWrite<{ id: string }>(api, '/api/v1/cinema/content', body, keys.for(body), original ? 'PATCH' : 'POST');
            if (!scope.live()) return;
            keys.finish(body); router.replace({ pathname: '/cinema/creator/[id]', params: { id: result.id, ...(parent ? { parent } : {}) } });
        } catch (e) { if (scope.live()) { keys.finish(body, e); setNote(studioMessage(e)); } }
        finally { if (scope.live()) { sending.current = false; setBusy(false); } }
    };
    if (['cinemaUpload.closed', 'cinemaUpload.role'].includes(note)) return <CreatorClosed message={note} />;
    const toggle = (field: 'categories' | 'ai_disclosures', value: string) => setForm(f => ({ ...f, [field]: f[field].includes(value) ? f[field].filter(x => x !== value) : [...f[field], value] }));
    return <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
        <Text style={ui.heading} accessibilityRole="header">{t(id ? 'cinemaUpload.edit' : 'cinemaUpload.new')}</Text>
        {loading ? <Text style={ui.text}>{t('cinemaUpload.loading')}</Text> : <>
            <Text style={ui.heading} accessibilityRole="header">{t('cinemaUpload.type')}</Text>
            {parent ? <Text style={ui.text}>{typeLabel(form.content_type)}</Text> : ROOT_TYPES.map(type => <Check key={type} label={type === 'SERIES' ? t('cinema.type.SERIES') : type} checked={form.content_type === type} disabled={busy} onPress={() => setForm({ ...form, content_type: type })} />)}
            {parent && !id && <TextInput accessibilityLabel={t('cinema.creator.number', { type: typeLabel(form.content_type) })} placeholder={t('cinema.creator.number', { type: typeLabel(form.content_type) })} style={ui.input} keyboardType="number-pad" value={position} editable={!busy} onChangeText={setPosition} />}
            {(['title', 'synopsis', 'language'] as const).map(field => <TextInput key={field} accessibilityLabel={t(`cinemaUpload.${field}`)} placeholder={t(`cinemaUpload.${field}`)} style={ui.input} value={form[field]} editable={!busy} multiline={field === 'synopsis'} autoCapitalize={field === 'language' ? 'none' : 'sentences'} onChangeText={value => setForm(f => ({ ...f, [field]: value }))} />)}
            {!parent && <><Text style={ui.heading} accessibilityRole="header">{t('cinemaUpload.categories')}</Text>
                {CATEGORIES.map(c => <Check key={c.slug} label={t(categoryKey(c.slug))} checked={form.categories.includes(c.slug)} disabled={busy || (form.categories.length >= 2 && !form.categories.includes(c.slug))} onPress={() => toggle('categories', c.slug)} />)}</>}
            <Text style={ui.heading} accessibilityRole="header">{t('cinemaUpload.disclosures')}</Text>
            {AI_DISCLOSURES.map(d => <Check key={d} label={t(`cinemaUpload.disclosure.${d}`)} checked={form.ai_disclosures.includes(d)} disabled={busy} onPress={() => toggle('ai_disclosures', d)} />)}
            <Action label={t('cinemaUpload.save')} disabled={busy || (id !== undefined && !original) || note === 'cinemaUpload.revision'} onPress={() => void save()} />
        </>}
        {note ? <Text style={ui.text}>{t(note)}</Text> : null}
        {(note === 'cinemaUpload.revision' || (id && !original && note)) && <Action label={t('cinemaUpload.reload')} disabled={busy} onPress={() => void load()} />}
    </ScrollView>;
}
