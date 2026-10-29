import { Modal, StyleSheet, View } from 'react-native';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';
import { t } from '../../lib/i18n';
import type { EditorSaveSync } from './useEditorSaveSync';

export function EditorSaveSheets({ sync }: { sync: EditorSaveSync }) {
    const conflict = sync.sheet === 'conflict', recovery = sync.sheet === 'recovery';
    return <>
        {sync.retryVisible ? <Button label={t('editor.retryNow')} variant="tertiary" onPress={() => void sync.save()} /> : null}
        <Modal visible={conflict || recovery} transparent animationType="slide" onRequestClose={() => {}} accessibilityViewIsModal>
            <View style={saveSheetStyles.backdrop}><Card style={saveSheetStyles.surface} accessibilityViewIsModal>
                <Text variant="title2" accessibilityRole="header">{t(conflict ? 'editor.conflict' : 'editor.restore')}</Text>
                {sync.problem ? <Text accessibilityRole="alert">{sync.problem}</Text> : null}
                {sync.imports > 0 ? <Text>{t('editorSave.waitingImport')}</Text> : null}
                {conflict ? <>
                    <Button label={t('editor.useSaved')} disabled={!sync.canStart} onPress={sync.useSaved} />
                    <Button label={t('editor.keepCopy')} disabled={!sync.copyAllowed} onPress={() => void sync.keepCopy()} />
                </> : <>
                    <Button label={t('editor.restore')} disabled={!sync.canStart} onPress={sync.recover} />
                    <Button label={t('editor.discard')} variant="destructive" disabled={!sync.canStart} onPress={sync.discard} />
                </>}
            </Card></View>
        </Modal>
    </>;
}
export const saveSheetStyles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
    surface: { maxHeight: '90%', padding: 24, gap: 12 },
});
