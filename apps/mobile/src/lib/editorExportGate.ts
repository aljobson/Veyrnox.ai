import { EDITOR_SERVER_EXPORT_ENABLED } from './editorFlag';
// Export from the phone needs two switches (ADR-0275): this build's
// EXPO_PUBLIC_EDITOR_SERVER_EXPORT_ENABLED and server render admitting the account.
// With the build switch off there is no export path in the app, so Export is shown
// as unavailable up front instead of failing after a tap.
export type ExportGate = { available: boolean; hintKey: 'editorSimple.exportHint' | 'editorSimple.exportOffHint'; messageKey: 'editorSimple.exportOff' };

export function editorExportGate(buildEnabled: boolean): ExportGate {
    return buildEnabled
        ? { available: true, hintKey: 'editorSimple.exportHint', messageKey: 'editorSimple.exportOff' }
        : { available: false, hintKey: 'editorSimple.exportOffHint', messageKey: 'editorSimple.exportOff' };
}

export const EDITOR_EXPORT_GATE = editorExportGate(EDITOR_SERVER_EXPORT_ENABLED);
