import { View } from 'react-native';
import { Button, Chip, Text } from '../ui';
import { themedStyles, useThemedStyles } from '../ui/AppearanceContext';
import { NetworkLogo } from './NetworkLogo';
import { networkName } from '../../lib/networkLogos';
import { t } from '../../lib/i18n';
import type { PublishAccount } from '../../lib/publish';
import type { Member } from '../../lib/publishInbox';
import { PRIORITIES, type InboxFilter } from '../../lib/publishInboxList';

export function InboxFilters({ filter, accounts, members, tags, onChange, onClear }: {
    filter: InboxFilter; accounts: PublishAccount[]; members: Member[] | null; tags: string[];
    onChange: (next: InboxFilter) => void; onClear: () => void;
}) {
    const s = useThemedStyles(sheets);
    return <View style={s.panel}>
        <Text accessibilityRole="header">{t('publishOps.inbox.account')}</Text>
        <View style={s.chips}>
            <Chip label={t('publishOps.inbox.allAccounts')} selected={!filter.accountId} onPress={() => onChange({ ...filter, accountId: null })} />
            {accounts.map(a => <Chip key={a.id} label={t('publishOps.accountLabel', { network: networkName(a.network), name: a.displayName })} selected={filter.accountId === a.id} onPress={() => onChange({ ...filter, accountId: a.id })}>
                <NetworkLogo network={a.network} /><Text>{t('publishOps.accountLabel', { network: networkName(a.network), name: a.displayName })}</Text>
            </Chip>)}
        </View>
        {members ? <><Text accessibilityRole="header">{t('publishOps.inbox.assignee')}</Text><View style={s.chips}>
            <Chip label={t('publishOps.inbox.anyone')} selected={!filter.assignee} onPress={() => onChange({ ...filter, assignee: null })} />
            <Chip label={t('publishOps.inbox.unassigned')} selected={filter.assignee === 'unassigned'} onPress={() => onChange({ ...filter, assignee: 'unassigned' })} />
            {members.map(m => <Chip key={m.userId} label={m.email} selected={filter.assignee === m.userId} onPress={() => onChange({ ...filter, assignee: m.userId })} />)}
        </View></> : null}
        <Text accessibilityRole="header">{t('publishOps.inbox.priority')}</Text><View style={s.chips}>
            <Chip label={t('publishOps.inbox.anyPriority')} selected={!filter.priority} onPress={() => onChange({ ...filter, priority: null })} />
            {PRIORITIES.map(p => <Chip key={p} label={t(`publishOps.priority.${p}`)} selected={filter.priority === p} onPress={() => onChange({ ...filter, priority: p })} />)}
        </View>
        <Text accessibilityRole="header">{t('publishOps.inbox.tags')}</Text><View style={s.chips}>
            <Chip label={t('publishOps.inbox.anyTag')} selected={!filter.tag} onPress={() => onChange({ ...filter, tag: null })} />
            {tags.map(tag => <Chip key={tag} label={tag} selected={filter.tag === tag} onPress={() => onChange({ ...filter, tag })} />)}
        </View>
        <Button label={t('publishOps.inbox.clear')} variant="tertiary" onPress={onClear} />
    </View>;
}
const sheets = themedStyles(() => ({ panel: { gap: 8 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } }));
