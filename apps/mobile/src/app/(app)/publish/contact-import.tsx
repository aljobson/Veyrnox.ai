import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { Button, Chip, SegmentedControl, Text, TextField } from '../../../components/ui';
import { themedStyles, useThemedStyles } from '../../../components/ui/AppearanceContext';
import { NetworkLogo } from '../../../components/publish/NetworkLogo';
import { discardCacheCopy } from '../../../lib/cacheFiles';
import { subscribeCacheUser } from '../../../lib/appCache';
import { brandStore } from '../../../lib/publishBrand';
import { t } from '../../../lib/i18n';
import { networkName } from '../../../lib/networkLogos';
import { fetchAccounts, type PublishAccount } from '../../../lib/publish';
import { STATUSES } from '../../../lib/publishContacts';
import { importContacts, importErrorKey, manualContact, parseContactCsv, type ImportContact, type ManualFields } from '../../../lib/publishContactImport';
import { usePublishApi } from '../../../lib/usePublishApi';
import { publishScope, usePublishRole } from '../../../lib/usePublishRole';

const empty = (): ManualFields => ({ externalId: '', name: '', tags: '', subscriptionStatus: 'unknown', notes: '' });
export default function ContactImport() {
    const api = usePublishApi(), role = usePublishRole(api), router = useRouter(), s = useThemedStyles(sheets);
    const canImport = role !== null && ['owner', 'manager', 'editor'].includes(role);
    const canImportRef = useRef(canImport); canImportRef.current = canImport;
    const [accounts, setAccounts] = useState<PublishAccount[]>([]), [accountId, setAccountId] = useState<string | null>(null);
    const [mode, setMode] = useState<'manual' | 'csv'>('manual'), [fields, setFields] = useState(empty);
    const [contacts, setContacts] = useState<ImportContact[]>([]), [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null), [done, setDone] = useState<number | null>(null);
    const [scopeTick, setScopeTick] = useState(0);
    const generation = useRef(0), running = useRef(false), uriRef = useRef<string | null>(null), currentApi = useRef(api);
    currentApi.current = api;
    const clear = () => { setFields(empty()); setContacts([]); setAccountId(null); setMode('manual'); setError(null); setDone(null); };
    useEffect(() => {
        const reset = () => {
            generation.current++; canImportRef.current = false; running.current = false;
            discardCacheCopy(uriRef.current); uriRef.current = null;
            clear(); setAccounts([]); setBusy(false); setScopeTick(n => n + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { generation.current++; canImportRef.current = false; discardCacheCopy(uriRef.current); uriRef.current = null; userOff(); brandOff(); };
    }, []);
    function guard() {
        const scope = publishScope(), version = generation.current;
        return () => scope === publishScope() && version === generation.current && currentApi.current === api;
    }
    useEffect(() => {
        const valid = guard();
        fetchAccounts(api).then(a => { if (valid()) setAccounts(a.accounts.filter(item => item.status === 'active').map(item => ({ ...item, displayName: item.displayName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) }))); }).catch(err => { if (valid()) setError(t(importErrorKey(err))); });
    }, [api, scopeTick]);
    async function chooseFile() {
        if (!canImportRef.current || running.current) return;
        const valid = guard(); let uri: string | null = null;
        running.current = true; setBusy(true); setError(null); setContacts([]);
        try {
            const picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
            if (picked.canceled) return;
            const file = picked.assets[0]; uri = file.uri;
            if (!valid() || !canImportRef.current) return;
            uriRef.current = uri;
            if (!file.name.toLowerCase().endsWith('.csv')) { setError(t('publishOps.csv.type')); return; }
            if (typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0 || file.size > 32768) { setError(t('publishOps.csv.size')); return; }
            const text = await new File(uri).text();
            if (!valid() || !canImportRef.current) return;
            const parsed = parseContactCsv(text);
            if (parsed.error) setError(t(parsed.error, { row: parsed.row ?? '' }));
            else setContacts(parsed.contacts!);
        } catch (err) { if (valid()) setError(t(importErrorKey(err))); }
        finally {
            discardCacheCopy(uri);
            if (uriRef.current === uri) uriRef.current = null;
            if (valid()) { running.current = false; setBusy(false); }
        }
    }
    function confirm() {
        if (!canImportRef.current || running.current) return;
        const valid = guard(), account = accounts.find(a => a.id === accountId);
        if (!account) return;
        let rows = contacts;
        if (mode === 'manual') {
            const parsed = manualContact(fields);
            if (parsed.error) { setError(t(parsed.error)); return; }
            rows = [parsed.contact!];
        }
        if (!rows.length || !valid()) return;
        let used = false;
        Alert.alert(t('publishOps.import.confirmTitle'), t('publishOps.import.confirmBody', { count: rows.length, account: account.displayName }), [
            { text: t('publish.cancel'), style: 'cancel' },
            { text: t('publishOps.import.add'), onPress: async () => {
                if (used || !valid() || !canImportRef.current || running.current) return;
                used = true; running.current = true; setBusy(true); setError(null);
                try { const count = await importContacts(api, account.id, mode, rows); if (valid()) { clear(); setDone(count); } }
                catch (err) { if (valid()) setError(t(importErrorKey(err))); }
                finally { if (valid()) { running.current = false; setBusy(false); } }
            } },
        ]);
    }
    if (role === null) return <View style={s.screen} accessibilityState={{ busy: true }}><ActivityIndicator /></View>;
    if (!canImport) return <View style={s.screen}><Text>{t('publishOps.import.notAllowed')}</Text><Button label={t('common.back')} onPress={() => router.back()} /></View>;
    if (done !== null) return <View style={s.screen}><Text accessibilityLiveRegion="polite">{t('publishOps.import.done', { count: done })}</Text><Button label={t('common.back')} onPress={() => router.back()} /></View>;
    return <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled" accessibilityState={{ busy }}>
        <Stack.Screen options={{ title: t('publishOps.import.title') }} />
        <Text accessibilityRole="header">{t('publishOps.import.title')}</Text><Text tone="secondary">{t('publishOps.import.help')}</Text>
        <View pointerEvents={busy ? 'none' : 'auto'} accessibilityState={{ disabled: busy }} importantForAccessibility={busy ? 'no-hide-descendants' : 'auto'}>
            <SegmentedControl value={mode} onChange={next => { if (!running.current) { setMode(next); setError(null); } }} options={[{ value: 'manual', label: t('publishOps.import.manual') }, { value: 'csv', label: t('publishOps.import.csv') }]} />
        </View>
        <Text accessibilityRole="header">{t('publishOps.inbox.account')}</Text>
        <View style={s.chips}>{accounts.map(a => <Chip key={a.id} disabled={busy} selected={accountId === a.id} label={t('publishOps.accountLabel', { network: networkName(a.network), name: a.displayName })} onPress={() => setAccountId(a.id)}><NetworkLogo network={a.network} /><Text>{t('publishOps.accountLabel', { network: networkName(a.network), name: a.displayName })}</Text></Chip>)}</View>
        {!accounts.length ? <Text tone="secondary">{t('publishOps.import.noAccounts')}</Text> : null}
        {mode === 'manual' ? <>
            <TextField label={t('publishOps.import.handle')} maxLength={256} value={fields.externalId} editable={!busy} onChangeText={externalId => setFields(f => ({ ...f, externalId }))} />
            <TextField label={t('publishOps.import.name')} maxLength={120} value={fields.name} editable={!busy} onChangeText={name => setFields(f => ({ ...f, name }))} />
            <Text accessibilityRole="header">{t('publishOps.import.consent')}</Text>
            <View style={s.chips}>{STATUSES.map(status => <Chip key={status} label={t(`contacts.status.${status}`)} selected={fields.subscriptionStatus === status} disabled={busy} onPress={() => setFields(f => ({ ...f, subscriptionStatus: status }))} />)}</View>
            <TextField label={t('publishOps.inbox.tags')} value={fields.tags} editable={!busy} onChangeText={tags => setFields(f => ({ ...f, tags }))} />
            <TextField label={t('inbox.notes')} maxLength={2000} multiline value={fields.notes} editable={!busy} onChangeText={notes => setFields(f => ({ ...f, notes }))} />
        </> : <><Button label={t('publishOps.import.choose')} onPress={chooseFile} disabled={busy} /><Text tone="secondary">{t('publishOps.import.columns')}</Text>
            {contacts.length ? <><Text>{t('publishOps.import.ready', { count: contacts.length })}</Text>{contacts.slice(0, 5).map(c => <Text key={c.externalId}>{c.name}</Text>)}</> : null}
        </>}
        {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
        <Button label={t('publishOps.import.add')} loading={busy} disabled={busy || !accountId || (mode === 'csv' && !contacts.length)} onPress={confirm} />
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { padding: 16, gap: 12, backgroundColor: p.bg, flexGrow: 1 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } }));
