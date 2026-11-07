import Constants from 'expo-constants';
import { EDITOR_ENABLED, FULL_EDITOR_ENABLED } from './editorFlag';
import { t } from './i18n';

const onOff = (value: boolean): string => (value ? 'on' : 'off');

// One line that says why the editor may look unavailable: which build this is, whether the editor switches were on
// when it was built, and how many workspaces the app could read. Nothing here is personal data.
export function editorDiagnostics(workspaceCount: number | null): string {
    return t('editor.diagnostics', {
        version: Constants.expoConfig?.version ?? '?',
        build: Constants.nativeBuildVersion ?? '?',
        editor: onOff(EDITOR_ENABLED),
        full: onOff(FULL_EDITOR_ENABLED),
        workspaces: workspaceCount === null ? '?' : String(workspaceCount),
    });
}
