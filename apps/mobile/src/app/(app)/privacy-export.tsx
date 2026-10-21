import { File } from 'expo-file-system';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { CodeField } from '../../components/account/CodeField';
import { Action, styles } from '../../components/account/shared';
import { PRIVACY_EMAIL } from '../../lib/account';
import { ApiError } from '../../lib/api';
import { exportDirectory, getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { fetchProfile, verifyFactor } from '../../lib/auth/accountCalls';
import { toSession } from '../../lib/auth/supabaseAuth';
import { t } from '../../lib/i18n';
import { validCode, verifiedFactors } from '../../lib/mfa';
import { exportErrorState, runExport, type ExportProgress, type ExportState } from '../../lib/privacyExport';
import { colors } from '../../theme';

export default function PrivacyExportScreen() {
    const { api, getAccessToken, adoptSession } = useAuth();
    const [state, setState] = useState<ExportState>('idle');
    const [now, setNow] = useState(Date.now);
    const [progress, setProgress] = useState<ExportProgress>({ section: 0, total: 0, waiting: false });
    const [waitUntil, setWaitUntil] = useState(0);
    const [windowUntil, setWindowUntil] = useState(0);
    const [code, setCode] = useState('');
    const [codeError, setCodeError] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const file = useRef<File | null>(null);
    const controller = useRef<AbortController | null>(null);
    const live = useRef(true);
    const owner = useRef(getCacheUser());
    const remove = () => { if (file.current?.exists) file.current.delete(); file.current = null; };
    useEffect(() => {
        live.current = true;
        const unsubscribe = subscribeCacheUser(() => {
            if (getCacheUser() !== owner.current) {
                live.current = false; controller.current?.abort(); remove(); setState('unavailable');
            }
        });
        return () => { live.current = false; controller.current?.abort(); remove(); unsubscribe(); };
    }, []);
    useEffect(() => {
        if (!waitUntil || (state !== 'expired' && state !== 'rate_limited')) return;
        const tick = setInterval(() => setNow(Date.now()), 60000);
        const timer = setTimeout(() => {
            setWaitUntil(0);
            if (state === 'rate_limited') setState('idle');
        }, Math.max(0, waitUntil - Date.now()));
        return () => { clearTimeout(timer); clearInterval(tick); };
    }, [state, waitUntil]);
    async function prepare() {
        if (!live.current || controller.current) return;
        remove();
        const abort = new AbortController(); controller.current = abort;
        setState('preparing');
        try {
            const request = await runExport(api, {
                create(request) {
                    setWindowUntil(Date.parse(request.expires_at));
                    setWaitUntil(Date.parse(request.expires_at) + 23 * 60 * 60 * 1000);
                    const directory = exportDirectory();
                    directory.create({ intermediates: true, idempotent: true });
                    file.current = new File(directory, `veyrnox-data-${request.export_id.slice(0, 8)}.json`);
                    file.current.create({ overwrite: true });
                },
                async append(text) { if (!file.current) throw new Error('export_file_removed'); await file.current.write(text, { append: true }); },
                delete: remove,
            }, p => { if (live.current) setProgress(p); }, abort.signal);
            // Resumed requests can be nearly a day older; the server remains authoritative on a later start.
            setWaitUntil(Date.parse(request.expires_at) + 23 * 60 * 60 * 1000);
            if (live.current && !abort.signal.aborted) setState('ready');
        } catch (err) {
            if (live.current) {
                setNow(Date.now());
                if (err instanceof ApiError && err.code === 'rate_limited') {
                    const seconds = (err.retryAfterSeconds ?? Number(err.body.retry_after_seconds)) || 86400;
                    setWaitUntil(Date.now() + seconds * 1000);
                }
                setState(abort.signal.aborted ? 'idle' : exportErrorState(err));
            }
        } finally { controller.current = null; }
    }
    async function verify() {
        setVerifying(true); setCodeError(false);
        try {
            const profile = await fetchProfile(getAccessToken);
            const factor = verifiedFactors(profile.factors)[0];
            if (!factor) throw new Error('factor_missing');
            const session = toSession(await verifyFactor(getAccessToken, factor.id, code), Date.now());
            if (!live.current) return;
            await adoptSession(session);
            if (!live.current) return;
            setCode(''); await prepare();
        } catch { if (live.current) setCodeError(true); }
        finally { if (live.current) setVerifying(false); }
    }
    async function share() {
        if (!live.current) return;
        if (!file.current?.exists) { setNow(Date.now()); setState('expired'); return; }
        try { await Sharing.shareAsync(file.current.uri, { mimeType: 'application/json' }); }
        catch { remove(); if (live.current) setState('unavailable'); }
    }
    const hours = Math.max(1, Math.ceil((waitUntil - now) / 3600000));
    return <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: t('privacyExport.title') }} />
        <Text accessibilityRole="header" style={styles.title}>{t('privacyExport.title')}</Text>
        <Text style={styles.help}>{t('privacyExport.explanation')}</Text>
        <Text style={styles.help}>{t('privacyExport.storage')}</Text>
        <Text style={styles.help}>{t('privacyExport.more', { email: PRIVACY_EMAIL })}</Text>
        {state === 'idle' && <Action label={t('privacyExport.prepare')} onPress={() => void prepare()} />}
        {state === 'preparing' && <>
            <Text style={styles.status} accessibilityLiveRegion="polite">{progress.waiting ? t('privacyExport.waiting') : t('privacyExport.progress', { section: progress.section, total: progress.total })}</Text>
            <Action label={t('privacyExport.cancel')} onPress={() => { controller.current?.abort(); remove(); }} />
        </>}
        {state === 'ready' && <>
            <Text style={styles.status} accessibilityLiveRegion="polite">{t('privacyExport.ready')}</Text>
            <Action label={t('privacyExport.share')} onPress={() => void share()} />
        </>}
        {state === 'expired' && <>
            <Text style={styles.help}>{t('privacyExport.expired')}</Text>
            {waitUntil > now && windowUntil <= now ? <Text style={styles.help}>{t('privacyExport.rateLimited', { hours })}</Text> : <Action label={t('privacyExport.again')} onPress={() => void prepare()} />}
        </>}
        {state === 'rate_limited' && <Text style={styles.help}>{t('privacyExport.rateLimited', { hours })}</Text>}
        {(state === 'unavailable' || state === 'restricted') && <Text style={styles.help}>{t('privacyExport.unavailable', { email: PRIVACY_EMAIL })}</Text>}
        {state === 'mfa' && <>
            <Text style={styles.help}>{t('privacyExport.mfa')}</Text>
            <CodeField value={code} onChange={setCode} />
            {codeError && <Text accessibilityRole="alert" style={styles.danger}>{t('privacyExport.codeError')}</Text>}
            <Action label={t('privacyExport.verify')} disabled={verifying || !validCode(code)} onPress={() => void verify()} />
        </>}
    </ScrollView>;
}
