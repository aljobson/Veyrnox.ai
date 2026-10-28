import { rawText } from '../../../lib/i18n/translate';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { Button, Card, Chip, Text, TextField } from '../../../components/ui';
import { themedStyles, useThemedStyles } from '../../../components/ui/AppearanceContext';
import { UnlockCard } from '../../../components/UnlockCard';
import { InboxFilters } from '../../../components/publish/InboxFilters';
import { NetworkLogo } from '../../../components/publish/NetworkLogo';
import { ApiError } from '../../../lib/api';
import { subscribeCacheUser } from '../../../lib/appCache';
import { brandStore } from '../../../lib/publishBrand';
import { formatLocale, t } from '../../../lib/i18n';
import { networkName } from '../../../lib/networkLogos';
import { fetchAccounts, type PublishAccount } from '../../../lib/publish';
import { KINDS, STATES, inboxErrorKey, inboxScope } from '../../../lib/publishInbox';
import { defaultInboxFilter, fetchInboxListing, type InboxFilter } from '../../../lib/publishInboxList';
import { usePublishApi } from '../../../lib/usePublishApi';
import { LIST_END_PADDING } from '../../../theme';

export default function Inbox() {
    const api = usePublishApi(), router = useRouter(), s = useThemedStyles(sheets);
    const [filter, setFilter] = useState<InboxFilter>(defaultInboxFilter);
    const [search, setSearch] = useState(''), [expanded, setExpanded] = useState(false);
    const [listing, setListing] = useState<Awaited<ReturnType<typeof fetchInboxListing>> | null>(null);
    const [accounts, setAccounts] = useState<PublishAccount[]>([]);
    const [error, setError] = useState<string | null>(null), [locked, setLocked] = useState(false);
    const [refreshing, setRefreshing] = useState(false), [scopeTick, setScopeTick] = useState(0);
    const scopeGeneration = useRef(0), listingSeq = useRef(0), accountsSeq = useRef(0), currentApi = useRef(api);
    currentApi.current = api;
    useEffect(() => {
        const reset = () => {
            scopeGeneration.current++;
            setListing(null); setAccounts([]); setError(null); setLocked(false); setRefreshing(false);
            setFilter(defaultInboxFilter()); setSearch(''); setExpanded(false); setScopeTick(n => n + 1);
        };
        const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { scopeGeneration.current++; userOff(); brandOff(); };
    }, []);
    const load = useCallback(async () => {
        const scopeVersion = scopeGeneration.current, seq = ++listingSeq.current, scope = inboxScope();
        const valid = () => scopeVersion === scopeGeneration.current && seq === listingSeq.current && scope === inboxScope() && api === currentApi.current;
        try { const next = await fetchInboxListing(api, filter); if (valid()) { setListing(next); setError(null); setLocked(false); } }
        catch (err) { if (valid()) { setListing(null); setLocked(err instanceof ApiError && err.status === 402); setError(err instanceof ApiError && err.status === 402 ? null : t(inboxErrorKey(err))); } }
        finally { if (valid()) setRefreshing(false); }
    }, [api, filter, scopeTick]);
    useFocusEffect(useCallback(() => { void load(); return () => { listingSeq.current++; }; }, [load]));
    useEffect(() => {
        const scopeVersion = scopeGeneration.current, seq = ++accountsSeq.current, scope = inboxScope();
        const valid = () => scopeVersion === scopeGeneration.current && seq === accountsSeq.current && scope === inboxScope() && api === currentApi.current;
        setAccounts([]);
        fetchAccounts(api).then(next => { if (valid()) setAccounts(next.accounts.filter(a => a.status === 'active').map(a => ({ ...a, displayName: a.displayName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) }))); }).catch(() => { if (valid()) setAccounts([]); });
    }, [api, scopeTick]);
    const active = [filter.accountId, filter.assignee, filter.priority, filter.tag, filter.search, filter.kind, filter.state !== 'unresolved'].filter(Boolean).length;
    const clear = () => { setFilter(defaultInboxFilter()); setSearch(''); };
    const header = <View style={s.header}>
        <Button variant="tertiary" label={t('publishDepth.analytics.title')} onPress={() => router.push('/publish/inbox-analytics')} />
        <TextField label={t('publishOps.inbox.search')} value={search} onChangeText={setSearch} maxLength={100} returnKeyType="search" onSubmitEditing={() => setFilter(f => ({ ...f, search: search.trim() }))} />
        <Chip label={active ? t('publishOps.inbox.filtersOn', { count: active }) : t('publishOps.inbox.filters')} selected={expanded} onPress={() => setExpanded(v => !v)} />
        {expanded ? <InboxFilters filter={filter} accounts={accounts} members={listing?.members ?? null} tags={listing?.tags ?? []} onChange={setFilter} onClear={clear} /> : null}
        <View style={s.chips}>{STATES.map(state => <Chip key={state} label={listing ? t('publishOps.inbox.count', { label: t(`inbox.state.${state}`), count: listing.counts[state] }) : t(`inbox.state.${state}`)} selected={filter.state === state} onPress={() => setFilter(f => ({ ...f, state }))} />)}</View>
        <View style={s.chips}>{([null, ...KINDS] as const).map(kind => <Chip key={kind ?? 'any'} label={t(`inbox.kind.${kind ?? 'any'}`)} selected={filter.kind === kind} onPress={() => setFilter(f => ({ ...f, kind }))} />)}</View>
        {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
        {!listing && !error ? <ActivityIndicator accessibilityState={{ busy: true }} /> : null}
    </View>;
    return <View style={s.screen}>
        <Stack.Screen options={{ title: t('inbox.title') }} />
        {locked ? <UnlockCard feature="inbox" onUnlocked={() => void load()} /> : <FlatList
            data={listing?.threads ?? []} keyExtractor={item => item.id} contentContainerStyle={s.list}
            ListHeaderComponent={header} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
            ListEmptyComponent={listing ? <Text tone="secondary">{t(filter.accountId ? 'publishOps.inbox.emptyAccount' : active ? 'publishOps.inbox.emptyFiltered' : 'inbox.none')}</Text> : undefined}
            renderItem={({ item }) => <Card style={s.card} onPress={() => router.push({ pathname: '/publish/inbox-thread', params: { id: item.id } })}
                accessibilityLabel={rawText(t('publishOps.inbox.rowLabel', { name: item.name, network: networkName(item.network), kind: t(`inbox.kind.${item.kind}`), unread: item.unread ? t('inbox.unread', { count: item.unread }) : '', priority: t(`publishOps.priority.${item.priority}`) }))}>
                <View style={s.chips}><NetworkLogo network={item.network} size={20} /><Text variant={item.unread ? 'bodyStrong' : 'body'}>{item.name || networkName(item.network)}</Text>{item.unread ? <Chip selected label={t('inbox.unread', { count: item.unread })} /> : null}</View>
                <Text numberOfLines={2}>{item.preview || item.subject || t(`inbox.kind.${item.kind}`)}</Text>
                <Text tone="secondary" variant="caption">{t('publishOps.inbox.meta', { network: networkName(item.network), kind: t(`inbox.kind.${item.kind}`), account: item.accountName })}</Text>
                <View style={s.chips}>{item.priority !== 'normal' ? <Chip label={t(`publishOps.priority.${item.priority}`)} /> : null}{item.assignedEmail ? <Chip label={item.assignedEmail} /> : null}{item.tags.slice(0, 3).map(tag => <Chip key={tag} label={tag} />)}</View>
                {item.latestAt ? <Text tone="secondary" variant="caption" style={s.date}>{new Date(item.latestAt).toLocaleDateString(formatLocale())}</Text> : null}
            </Card>}
        />}
    </View>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg, paddingHorizontal: 16 }, list: { paddingBottom: LIST_END_PADDING }, header: { gap: 8, paddingVertical: 8 }, chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, card: { gap: 6, marginBottom: 8 }, date: { textAlign: 'right' } }));
