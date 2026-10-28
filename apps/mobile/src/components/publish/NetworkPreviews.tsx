import { View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import type { PublishAccount } from '../../lib/publish';
import type { MediaChoice } from '../../lib/publishMediaChoice';
import { captionLimit } from '../../lib/publishCompose';
import { networkName } from '../../lib/networkLogos';
import { t } from '../../lib/i18n';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';
import { NetworkLogo } from './NetworkLogo';
import { MediaPreview } from './ChosenMediaPreview';

export function NetworkPreviews({ api, accounts, choice, text, networkText, variants }: {
    api: ApiClient; accounts: PublishAccount[]; choice: MediaChoice | null; text: string; networkText: Record<string, string>; variants: boolean;
}) {
    const s = useThemedStyles(sheets);
    const networks = [...new Set(accounts.map(account => account.network))];
    if (!networks.length) return null;
    return <View style={s.list}>
        <Text accessibilityRole="header" variant="bodyStrong">{t('publishParity.preview.title')}</Text>
        {networks.map(network => {
            const own = variants && !!networkText[network]?.trim();
            const caption = own ? networkText[network] : text;
            const count = [...caption].length, limit = captionLimit(network);
            return <Card key={network} accessibilityLabel={t('publishParity.preview.label', { network: networkName(network) })} style={s.list}>
                <View style={s.header}><NetworkLogo network={network} size={20} /><Text variant="bodyStrong">{networkName(network)}</Text></View>
                {accounts.filter(account => account.network === network).map(account => <Text key={account.id} tone="secondary">{account.displayName}</Text>)}
                {choice?.kind === 'job' ? <MediaPreview api={api} choice={choice} thumbnail /> : null}
                <Text tone={caption.trim() ? 'primary' : 'secondary'}>{caption.trim() ? caption : t('publishParity.preview.empty')}</Text>
                {variants ? <Text tone="secondary">{t(own ? 'publishParity.preview.own' : 'publishParity.preview.main')}</Text> : null}
                {limit !== null ? <Text tone={count > limit ? 'danger' : 'secondary'}>{t('compose.networkTextCount', { count, limit })}</Text> : null}
                {network === 'tiktok' && choice?.mediaType === 'video' ? <Text tone="secondary">{t('publishParity.preview.tiktok')}</Text> : null}
            </Card>;
        })}
    </View>;
}
const sheets = themedStyles(() => ({ list: { gap: 8 }, header: { flexDirection: 'row', alignItems: 'center', gap: 8 } }));
