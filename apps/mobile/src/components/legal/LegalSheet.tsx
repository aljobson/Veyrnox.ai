import { useState } from 'react';
import { Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
import { type LegalDoc } from '../../lib/legal';
import { LegalDocumentView, type LegalLocation } from './LegalDocumentView';
import { ds } from '../../theme';

// Also used inside AiConsentHost's existing Modal. No second native Modal is mounted there.
export function LegalSheetContent({ doc, onClose }: { doc: LegalDoc; onClose(): void }) {
    const styles = useThemedStyles(sheets);
    const [history, setHistory] = useState<LegalLocation[]>([{ doc }]);
    const current = history[history.length - 1];
    return <SafeAreaView style={styles.screen}>
        <View style={styles.toolbar}>
            {history.length > 1 && <Button variant="tertiary" label={t('common.back')} onPress={() => setHistory(items => items.slice(0, -1))} />}
            <Button variant="tertiary" label={t('common.close')} onPress={onClose} />
        </View>
        <LegalDocumentView {...current} onNavigate={location => setHistory(items => [...items, location])} />
    </SafeAreaView>;
}
export function LegalSheet({ doc, onClose }: { doc: LegalDoc | null; onClose(): void }) {
    if (!doc) return null;
    return <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={onClose} accessibilityViewIsModal>
        <LegalSheetContent key={doc} doc={doc} onClose={onClose} />
    </Modal>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    toolbar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: ds.space.md },
}));
