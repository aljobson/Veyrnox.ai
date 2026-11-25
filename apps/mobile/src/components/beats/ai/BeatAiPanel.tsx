import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../../ui';
import { useAuth } from '../../../auth/AuthProvider';
import { userIdFromToken } from '../../../lib/appCache';
import { t } from '../../../lib/i18n';
import type { BeatDoc, Edit } from '../../../lib/beatNative/doc';
import { beatStore } from '../../../lib/beatNative/store';
import { probeBeatAi, type BeatAiProbe } from '../../../lib/beatAi/probe';
import { createBeatAiClient } from '../../../lib/beatAi/client';
import { pendingStore } from '../../../lib/beatAi/pending';
import { createPartRequest } from '../../../lib/beatAi/useBeatAiRequest';
import { nativeMetadata } from '../../../lib/beatAi/nativeMetadata';
import type { AiDoc, Op } from '../../../lib/beatAi/types';
import type { ApiClient } from '../../../lib/api';
import { BeatAiSheet } from './BeatAiSheet';
import { BeatMagicBar } from './BeatMagicBar';
import { MAGIC_BAR_ON_PHONE } from '../../../lib/beatAi/magicGate';
import type { MenuIcon } from '../../../lib/menuIcons';
import { ds } from '../../../theme';

const AI_ACTIONS: readonly { op: Op; icon: MenuIcon }[] = [
    { op: 'generate', icon: 'magicWand' },
    { op: 'stems', icon: 'waveform' },
    { op: 'targetStems', icon: 'crosshair' },
    { op: 'extend', icon: 'arrowsHorizontal' },
    { op: 'replace', icon: 'scissors' },
];
export function BeatAiPanel({ doc, apply, disabled = false }: { doc: BeatDoc; apply(edit: Edit, label?: string): boolean; disabled?: boolean }) {
    const { api, getAccessToken, generation } = useAuth();
    const identity = useRef({ generation, id: doc.id }); identity.current = { generation, id: doc.id };
    const visit = useRef(0);
    const [session, setSession] = useState<{ owner: string; generation: number; id: string; visit: number } | null>(null);
    useFocusEffect(useCallback(() => {
        let live = true; const opened = ++visit.current;
        void getAccessToken?.().then(token => {
            if (!live || identity.current.generation !== generation || identity.current.id !== doc.id) return;
            const owner = token ? userIdFromToken(token) : null;
            setSession(owner ? { owner, generation, id: doc.id, visit: opened } : null);
        }).catch(() => { if (live) setSession(null); });
        return () => { live = false; visit.current++; setSession(null); };
    }, [getAccessToken, generation, doc.id]));
    const current = useCallback(() => identity.current.generation === generation && identity.current.id === doc.id && visit.current === session?.visit, [generation, doc.id, session?.visit]);
    if (!session || session.generation !== generation || session.id !== doc.id || session.visit !== visit.current) return null;
    return <OwnerPanel key={`${session.owner}.${generation}.${doc.id}.${session.visit}`} api={api} owner={session.owner} doc={doc as AiDoc} apply={apply} current={current} disabled={disabled} />;
}
function OwnerPanel({ api, owner, doc, apply, current, disabled }: { api: ApiClient; owner: string; doc: AiDoc; apply(edit: Edit, label?: string): boolean; current(): boolean; disabled: boolean }) {
    const s = useThemedStyles(styles);
    const [probe, setProbe] = useState<BeatAiProbe['state'] | 'checking'>('checking');
    const session = useMemo(() => ({ controller: new AbortController(), live: true }), []);
    const valid = useCallback(() => session.live && !session.controller.signal.aborted && current(), [session, current]);
    const off = useCallback(() => { if (valid()) { setProbe('off'); session.controller.abort(); } }, [session, valid]);
    const client = useMemo(() => createBeatAiClient(api, owner, session.controller.signal), [api, owner, session]);
    const request = useMemo(() => createPartRequest({ owner, beatId: doc.id, client, storage: pendingStore(), current: valid, off,
        port: nativeMetadata(client, { current: valid, bpm: () => doc.tempo.bpm }), store: beatStore, apply, signal: session.controller.signal,
    }), [owner, doc.id, client, valid, off, apply, session]);
    const view = useSyncExternalStore(request.subscribe, request.snapshot, request.snapshot);
    const [op, setOp] = useState<Op>('generate');
    useEffect(() => {
        void probeBeatAi(api, owner, session.controller.signal).then(async result => {
            if (!valid()) return;
            setProbe(result.state);
            if (result.state === 'on') await request.initialize();
        });
        return () => { session.live = false; session.controller.abort(); request.dispose(); };
    }, [api, owner, request, session, valid]);
    if (probe === 'off' || probe === 'signed_out' || probe === 'checking') return null;
    if (probe !== 'on') return <Text>{t(probe === 'offline' ? 'beatAi.offline' : 'beatAi.error')}</Text>;
    return <View testID="music-ai-editor" style={s.panel}>
        <Text variant="title3" accessibilityRole="header">{t('beatAi.title')}</Text>
        <View testID="music-ai-actions" style={s.actions}>
            {AI_ACTIONS.map(action => <Button key={action.op} size="md" variant="tertiary" icon={action.icon} iconOnly
                label={t(`beatAi.${action.op}`)} disabled={disabled || view.busy} containerStyle={s.action}
                onPress={() => { setOp(action.op); request.open(); }} />)}
        </View>
        {view.rows.map(row => <Button key={row.key} label={t('beatAi.resume', { name: row.prompt || t(`beatAi.${row.op}`) })} disabled={disabled || view.busy} onPress={() => { setOp(row.op); void request.resume(row); }} />)}
        {view.error && !view.open ? <Text accessibilityRole="alert">{t(view.error, view.errorParams)}</Text> : null}
        {view.open ? <BeatAiSheet key={`${op}.${view.record?.key ?? 'new'}`} request={request} client={client} doc={doc} op={op} onClose={request.close} /> : null}
        {MAGIC_BAR_ON_PHONE ? <BeatMagicBar doc={doc} client={client} owner={owner} current={valid} off={off} /> : null}
    </View>;
}

const styles = themedStyles((p) => ({
    panel: { gap: ds.space.sm, padding: ds.space.md, borderRadius: ds.radius.lg, backgroundColor: p.surface, borderWidth: 1, borderColor: p.borderSubtle },
    actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.xs },
    action: { flex: 1, maxWidth: 64 },
}));
