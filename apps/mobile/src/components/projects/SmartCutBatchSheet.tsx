import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { useRouter } from 'expo-router';
import type { Project } from '../../lib/projects';
import { studioColors as colors } from '../../theme';
import { Icon, Text } from '../ui';
import { SmartCutBatchQueue } from './SmartCutBatchQueue';
import { t } from '../../lib/i18n';

export function SmartCutBatchSheet({ visible, workspaceId, projects, router, onClose }: {
    readonly visible: boolean;
    readonly workspaceId: string;
    readonly projects: readonly Project[];
    readonly router: ReturnType<typeof useRouter>;
    readonly onClose: () => void;
}) {
    const insets = useSafeAreaInsets();
    return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} accessibilityViewIsModal>
        <View style={[styles.screen, { paddingTop: Math.max(12, insets.top) }]}>
            <View style={styles.header}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.closeBatchAiEdit')} onPress={onClose} style={styles.close}><Icon name="close" size={24} tint={colors.text} /></Pressable>
                <View style={styles.heading}><Text variant="title3">{t('editorParity.batchAiEdit')}</Text><Text variant="caption" tone="secondary">{t('editorParity.batchAiEditDescription')}</Text></View>
                <View style={styles.close} />
            </View>
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
                <SmartCutBatchQueue workspaceId={workspaceId} projects={projects} router={router} />
            </ScrollView>
        </View>
    </Modal>;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
    heading: { flex: 1, alignItems: 'center', gap: 2 },
    close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    content: { padding: 16 },
});
