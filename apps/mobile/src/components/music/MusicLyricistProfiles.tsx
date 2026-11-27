import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { createPersona, deletePersona, fetchPersonas, type Persona } from '../../lib/chatLibrary';
import { t } from '../../lib/i18n';
import {
    buildMusicLyricistProfile, isMusicLyricistProfile, musicLyricistLabel, openMusicLyricistChat,
    MUSIC_LYRICIST_DIRECTION_MAX, MUSIC_LYRICIST_EXAMPLES_MAX, MUSIC_LYRICIST_NAME_MAX, MUSIC_LYRICIST_REQUEST_MAX,
} from '../../lib/music/lyricistProfile';
import { ds } from '../../theme';
import { Button, Card, Text, TextField, themedStyles, useThemedStyles } from '../ui';

const blank = { name: '', direction: '', examples: '', ownsExamples: false };

interface MusicLyricistProfilesProps {
    readonly api: ApiClient;
    readonly lyrics: string;
    readonly sessionGeneration: number;
    readonly onOpenChat: (threadId: string) => void;
}

export function MusicLyricistProfiles(props: MusicLyricistProfilesProps) {
    return <MusicLyricistProfileSession key={props.sessionGeneration} {...props} />;
}

function MusicLyricistProfileSession({ api, lyrics, sessionGeneration, onOpenChat }: MusicLyricistProfilesProps) {
    const s = useThemedStyles(sheets);
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [profiles, setProfiles] = useState<Persona[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [creating, setCreating] = useState(false);
    const [removingId, setRemovingId] = useState('');
    const [form, setForm] = useState(blank);
    const [request, setRequest] = useState('');
    const [busy, setBusy] = useState(false);
    const [errorKey, setErrorKey] = useState('');
    const live = useRef(true);
    const generation = useRef(sessionGeneration);
    const lock = useRef(false);

    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    const current = (captured: number) => live.current && generation.current === captured;

    async function load() {
        if (lock.current) return;
        const captured = generation.current;
        lock.current = true; setBusy(true); setErrorKey('');
        try {
            const result = await fetchPersonas(api);
            if (!current(captured)) return;
            setEnabled(result.enabled);
            const next = result.personas.filter(isMusicLyricistProfile).sort((a, b) => musicLyricistLabel(a).localeCompare(musicLyricistLabel(b)));
            setProfiles(next);
            setSelectedId(id => id && !next.some(profile => profile.id === id) ? '' : id);
            setLoaded(true);
        } catch {
            if (current(captured)) setErrorKey('musicLyricist.loadError');
        } finally {
            if (current(captured)) setBusy(false);
            lock.current = false;
        }
    }

    async function reveal() {
        const next = !open;
        setOpen(next);
        if (next && !loaded) await load();
    }

    async function save() {
        const checked = buildMusicLyricistProfile(form);
        if (!checked.ok) return setErrorKey(checked.error === 'instructions_too_long' ? 'musicLyricist.profileTooLong' : 'musicLyricist.error');
        if (lock.current) return;
        const captured = generation.current;
        lock.current = true; setBusy(true); setErrorKey('');
        try {
            await createPersona(api, checked.value);
            if (!current(captured)) return;
            setForm(blank); setCreating(false);
            try {
                const result = await fetchPersonas(api);
                if (!current(captured)) return;
                const next = result.personas.filter(isMusicLyricistProfile).sort((a, b) => musicLyricistLabel(a).localeCompare(musicLyricistLabel(b)));
                // Persona names are owner-unique on the server, so the freshly saved prefixed name is the stable identity
                // even if the projection normalizes instruction whitespace.
                const created = next.find(profile => profile.name === checked.value.name);
                setEnabled(result.enabled); setProfiles(next); setSelectedId(created?.id ?? '');
            } catch {
                if (current(captured)) { setLoaded(false); setErrorKey('musicLyricist.loadError'); }
            }
        } catch (error) {
            if (current(captured)) setErrorKey((error as { code?: string })?.code === 'persona_exists' ? 'musicLyricist.duplicate' : 'musicLyricist.error');
        } finally {
            if (current(captured)) setBusy(false);
            lock.current = false;
        }
    }

    async function remove(profile: Persona) {
        if (lock.current) return;
        const captured = generation.current;
        lock.current = true; setBusy(true); setErrorKey('');
        try {
            await deletePersona(api, profile.id);
            if (!current(captured)) return;
            setProfiles(items => items.filter(item => item.id !== profile.id));
            setSelectedId(id => id === profile.id ? '' : id);
            setRemovingId('');
        } catch {
            if (current(captured)) setErrorKey('musicLyricist.error');
        } finally {
            if (current(captured)) setBusy(false);
            lock.current = false;
        }
    }

    async function openChat() {
        const profile = profiles.find(item => item.id === selectedId);
        if (!profile || lock.current) return;
        const captured = generation.current;
        lock.current = true; setBusy(true); setErrorKey('');
        try {
            const result = await openMusicLyricistChat({ api, profile, request, lyrics, stillCurrent: () => current(captured) });
            // A successful handoff is already committed as a matched remote thread and original-owner draft.
            // A later session change fences navigation but must not split that valid pair during stale cleanup.
            if (!current(captured)) return;
            if (!result.ok) {
                setErrorKey(result.error === 'prompt_too_long' ? 'musicLyricist.promptTooLong'
                    : 'musicLyricist.error');
                return;
            }
            onOpenChat(result.threadId);
        } finally {
            if (current(captured)) setBusy(false);
            lock.current = false;
        }
    }

    const checked = buildMusicLyricistProfile(form);
    const profileValidationKey = !checked.ok && checked.error === 'instructions_too_long' ? 'musicLyricist.profileTooLong' : '';
    const selected = profiles.find(item => item.id === selectedId);
    return <Card style={s.card} accessibilityLabel={t('musicLyricist.title')}>
        <Text variant="title3">{t('musicLyricist.title')}</Text>
        <Text tone="secondary">{t('musicLyricist.body')}</Text>
        <Button variant="secondary" label={t(open ? 'musicLyricist.hide' : 'musicLyricist.show')}
            accessibilityState={{ expanded: open, busy }} disabled={busy} onPress={() => void reveal()} />
        {open ? <View style={s.group}>
            {busy && !loaded ? <Text accessibilityLiveRegion="polite">{t('musicLyricist.loading')}</Text> : null}
            {errorKey ? <Text tone="danger" accessibilityRole="alert">{t(errorKey)}</Text> : null}
            {errorKey === 'musicLyricist.loadError' ? <Button variant="secondary" label={t('musicLyricist.retry')} onPress={() => void load()} /> : null}
            {loaded && !enabled ? <Text tone="secondary">{t('musicLyricist.unavailable')}</Text> : null}
            {loaded && enabled ? <>
                <Button variant="secondary" accessibilityRole="radio" accessibilityState={{ selected: !selectedId }}
                    label={t('musicLyricist.none')} onPress={() => setSelectedId('')} />
                {profiles.map(profile => <View key={profile.id} style={s.profile}>
                    <Button variant={selectedId === profile.id ? 'primary' : 'secondary'} accessibilityRole="radio"
                        accessibilityState={{ selected: selectedId === profile.id }} label={musicLyricistLabel(profile)}
                        onPress={() => setSelectedId(profile.id)} />
                    {removingId === profile.id ? <View style={s.row}>
                        <Button variant="destructive" label={t('musicLyricist.confirmDelete')} disabled={busy} onPress={() => void remove(profile)} />
                        <Button variant="tertiary" label={t('musicLyricist.keep')} disabled={busy} onPress={() => setRemovingId('')} />
                    </View> : <Button variant="tertiary" tone="danger" label={t('musicLyricist.delete')} disabled={busy} onPress={() => setRemovingId(profile.id)} />}
                </View>)}
                {!creating ? <Button variant="secondary" label={t('musicLyricist.new')} onPress={() => setCreating(true)} /> : <View style={s.group}>
                    <TextField label={t('musicLyricist.name')} value={form.name} maxLength={MUSIC_LYRICIST_NAME_MAX}
                        onChangeText={name => setForm(value => ({ ...value, name }))} />
                    <TextField label={t('musicLyricist.direction')} value={form.direction} maxLength={MUSIC_LYRICIST_DIRECTION_MAX} multiline
                        onChangeText={direction => setForm(value => ({ ...value, direction }))} />
                    <TextField label={t('musicLyricist.examples')} value={form.examples} maxLength={MUSIC_LYRICIST_EXAMPLES_MAX} multiline
                        onChangeText={examples => setForm(value => ({ ...value, examples }))} />
                    <Button variant={form.ownsExamples ? 'primary' : 'secondary'} accessibilityRole="checkbox"
                        accessibilityState={{ checked: form.ownsExamples }} label={t('musicLyricist.owns')}
                        onPress={() => setForm(value => ({ ...value, ownsExamples: !value.ownsExamples }))} />
                    {profileValidationKey ? <Text tone="danger" accessibilityRole="alert">{t(profileValidationKey)}</Text> : null}
                    <View style={s.row}>
                        <Button label={t('musicLyricist.save')} disabled={!checked.ok || busy} onPress={() => void save()} />
                        <Button variant="tertiary" label={t('musicLyricist.cancel')} disabled={busy} onPress={() => { setCreating(false); setForm(blank); }} />
                    </View>
                </View>}
                {selected ? <View style={s.group}>
                    <Text variant="bodyStrong">{t('musicLyricist.coWrite')}</Text>
                    <Text tone="secondary">{t('musicLyricist.coWriteBody')}</Text>
                    <TextField label={t('musicLyricist.request')} value={request} maxLength={MUSIC_LYRICIST_REQUEST_MAX} multiline onChangeText={setRequest} />
                    <Button label={t('musicLyricist.openChat')} disabled={!request.trim() || busy} onPress={() => void openChat()} />
                </View> : null}
            </> : null}
        </View> : null}
    </Card>;
}

const sheets = themedStyles(p => ({
    card: { gap: ds.space.md, padding: ds.space.md },
    group: { gap: ds.space.md },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    profile: { gap: ds.space.sm, padding: ds.space.sm, borderWidth: 1, borderColor: p.borderSubtle, borderRadius: ds.radius.md },
}));
