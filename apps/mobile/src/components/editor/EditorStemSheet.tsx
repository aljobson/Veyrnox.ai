import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { stemLabel, stemMedia, type EditorStem } from '../../lib/editorStems';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import type { LibraryChoice } from '../../lib/librarySource';
import type { Media } from '../../lib/nativeEditorModel';
import { useReducedMotion } from '../ui/useReducedMotion';
import { Action } from './EditorControls';
import { styles } from './fullEditorStyles';

type Token = { valid(): boolean; end(): void };
export function EditorStemSheet({ api, choice, stems, ready, beginImport, onAdd, onClose }: {
    api: ApiClient; choice: LibraryChoice; stems: EditorStem[]; ready: boolean;
    beginImport(): Token | null; onAdd(media: Media): void; onClose(): void;
}) {
    const reduced = useReducedMotion(), mounted = useRef(true), active = useRef(false), epoch = useRef(0);
    const latest = useRef({ ready, choice }); latest.current = { ready, choice };
    const [busy, setBusy] = useState(false), [error, setError] = useState(false);
    useAnnouncement(error ? t('stems.error') : null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { epoch.current++; active.current = false; setBusy(false); }, [ready, choice]);
    useEffect(() => subscribeCacheUser(onClose), [onClose]);
    async function add(stem: EditorStem) {
        if (active.current || !ready) return;
        const owner = getCacheUser(), captured = epoch.current, token = beginImport();
        if (!token) return;
        const current = () => captured === epoch.current && mounted.current && owner === getCacheUser() && latest.current.ready && latest.current.choice === choice;
        active.current = true; setBusy(true); setError(false);
        try {
            const media = await stemMedia(api, choice.jobId, choice.name, stem);
            if (!current() || !token.valid()) return;
            if (media) onAdd(media); else setError(true);
        } finally { token.end(); if (current()) { active.current = false; setBusy(false); } }
    }
    return <Modal visible transparent animationType={reduced ? 'none' : 'slide'} accessibilityViewIsModal onRequestClose={onClose}>
        <View style={[styles.noticeBackdrop, { justifyContent: 'flex-end' }]}><View style={styles.noticeCard} accessibilityViewIsModal onAccessibilityEscape={onClose}>
            <Text accessibilityRole="header" style={styles.noticeTitle}>{t('stems.title')}</Text>
            <Text style={styles.body}>{t('editorAi.stemsBody')}</Text>
            <ScrollView>{stems.map(stem => <Action key={stem} label={t('editorAi.addStem', { stem: stemLabel(stem) })} disabled={busy || !ready} onPress={() => void add(stem)} />)}</ScrollView>
            {error ? <Text style={styles.body}>{t('stems.error')}</Text> : null}
            <Action label={t('editorAi.done')} onPress={onClose} />
        </View></View>
    </Modal>;
}
