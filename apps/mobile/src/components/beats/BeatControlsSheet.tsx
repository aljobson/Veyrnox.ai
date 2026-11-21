import { View } from 'react-native';
import { Button, Text } from '../ui';
import { BeatModal } from './BeatModal';
import { t } from '../../lib/i18n';
import { BEAT_SHORTCUTS } from '../../lib/beatNative/labs';
import { SHORTCUT_CAPABILITY, type PhoneCapability } from '../../lib/beatNative/controls';
export function BeatControlsSheet({ capabilities, canReplay, onReplay, onClose }: { capabilities: ReadonlySet<PhoneCapability>; canReplay: boolean; onReplay(): void; onClose(): void }) {
    return <BeatModal title={t('beatLabs.controls')} onClose={onClose}>
        {[...new Set(BEAT_SHORTCUTS.map(row => row.context))].map(context => <View key={context}>
            <Text accessibilityRole="header" variant="title2">{t(`beatLabs.context.${context}`)}</Text>
            {BEAT_SHORTCUTS.filter(row => row.context === context).map(row => <View key={row.id}>
                <Text variant="bodyStrong">{t(`beatLabs.control.${row.id}`)}</Text><Text>{capabilities.has(SHORTCUT_CAPABILITY[row.id]) ? t(`beatLabs.touch.${row.id}`) : t('beatLabs.unavailable')}</Text>
            </View>)}
        </View>)}
        {canReplay ? <Button label={t('beatLabs.replay')} onPress={() => { onClose(); onReplay(); }} /> : null}
        <Button label={t('beatLabs.close')} onPress={onClose} />
    </BeatModal>;
}
