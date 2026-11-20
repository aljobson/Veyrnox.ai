import { View } from 'react-native';
import { Button, Text, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { REACTIONS, type Counts, type Social } from '../../lib/music/publicTypes';
import type { createPublicFlow } from '../../lib/music/publicFlow';
import { publicSheets } from './PublicShell';
export function PublicSocial({ counts, social, slug, handle, flow, busy }: {
    counts?: Counts; social: Social | null; slug?: string; handle: string; flow: ReturnType<typeof createPublicFlow>; busy: boolean;
}) {
    const s = useThemedStyles(publicSheets), displayed = social ?? counts;
    return <View style={s.group}>
        {displayed ? <Text>{t('musicPublic.followers', { count: displayed.follower_count })}</Text> : null}
        {slug && displayed ? REACTIONS.map(reaction => <View key={reaction}>
            {social ? <Button variant={social.my_reaction === reaction ? 'secondary' : 'tertiary'}
                accessibilityState={{ selected: social.my_reaction === reaction }} disabled={busy || !!flow.attempts.snapshot()}
                label={t('musicPublic.reactionCount', { reaction: t(`musicPublic.reaction.${reaction}`), count: displayed.reactions[reaction] })}
                onPress={() => void flow.write({ kind: 'reaction', slug, reaction: social.my_reaction === reaction ? null : reaction })} />
                : <Text>{t('musicPublic.reactionCount', { reaction: t(`musicPublic.reaction.${reaction}`), count: displayed.reactions[reaction] })}</Text>}
        </View>) : null}
        {social && !social.is_own ? <Button variant="secondary" label={t(social.following ? 'musicPublic.unfollow' : 'musicPublic.follow')}
            disabled={busy || !!flow.attempts.snapshot()} onPress={() => void flow.write({ kind: 'follow', handle, following: !social.following })} /> : null}
    </View>;
}
