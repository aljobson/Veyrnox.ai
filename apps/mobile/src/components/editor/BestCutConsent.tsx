import { useState } from 'react';
import { Modal, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rawText, t } from '../../lib/i18n';
import { colors } from '../../theme';
import { Button, Text } from '../ui';

type Props = { busy: boolean; onClose(): void; onConfirm(): void };

export function BestCutConsent({ busy, onClose, onConfirm }: Props) {
    const insets = useSafeAreaInsets();
    // Entry agreement is local only; the editor's existing gate authorises upload.
    const [agreed, setAgreed] = useState(false);
    const close = () => { if (!busy) onClose(); };
    return <Modal visible animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: colors.background }}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: 16, gap: 16 }}>
                <Text variant="title2">{t('bestCut.title')}</Text>
                <Text>{t('bestCut.intro')}</Text>
                <Text>{t('bestCut.consent')}</Text>
                <Text>{t('bestCut.metadata')}</Text>
                <Text>{t('bestCut.agree')}</Text>
                <Switch accessibilityLabel={rawText(t('bestCut.agree'))} disabled={busy} value={agreed} onValueChange={setAgreed} />
                <Button label={t('bestCut.title')} disabled={!agreed || busy} onPress={() => { if (agreed && !busy) onConfirm(); }} />
                <Button variant="tertiary" label={t('bestCut.notNow')} disabled={busy} onPress={close} />
            </ScrollView>
        </View>
    </Modal>;
}
