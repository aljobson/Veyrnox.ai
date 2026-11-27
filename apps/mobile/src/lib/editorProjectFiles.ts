import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { exportProjectFile, parseProjectFile, PROJECT_FILE_LIMIT } from '../../../../app/veyrnox/_lib/editorProjectFile.mjs';
import { exportDirectory } from './appCache';
import type { ProjectDocument } from './editorBridge';
import { timelineOf, type Timeline } from './nativeEditorModel';

export type NativeProjectFile = { document: ProjectDocument; timeline: Timeline; sourceVersion: number };
export type ProjectFilePick = NativeProjectFile | { refused: 'tooLarge' | 'unreadable' | 'invalid' } | null;
const createProjectFile = exportProjectFile as unknown as (timeline: Timeline, options: { readonly projectDocument: ProjectDocument; readonly name: string }) => { readonly json: string; readonly name: string };
const openProjectFile = parseProjectFile as unknown as (text: string) => NativeProjectFile;

/** Shares data and edit metadata only. Source media, signed URLs and account state are never read. */
export async function shareNativeProjectFile(document: ProjectDocument, name: string, live: () => boolean = () => true): Promise<'unavailable' | void> {
    if (!await Sharing.isAvailableAsync() || !live()) return 'unavailable';
    const result = createProjectFile(timelineOf(document.timeline), { projectDocument: document, name });
    const directory = exportDirectory(); directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, result.name);
    try {
        file.create({ overwrite: true }); await file.write(result.json); if (!live()) return;
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
    } finally {
        // Android can still be reading a shared content URI after the sheet closes. Its private export cache is reclaimed by the app cache policy.
        if (Platform.OS !== 'android') try { if (file.exists) file.delete(); } catch { /* Best-effort private export cleanup. */ }
    }
}

/** Preflights byte size before reading and validates the complete project before returning any timeline. */
export async function pickNativeProjectFile(live: () => boolean = () => true): Promise<ProjectFilePick> {
    let file: File | undefined;
    try {
        const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/json', '*/*'], multiple: false, copyToCacheDirectory: true });
        if (result.canceled) return null;
        const asset = result.assets[0]; file = new File(asset.uri); if (!live()) return null;
        const size = asset.size ?? file.info().size;
        if (!Number.isSafeInteger(size) || Number(size) < 1 || Number(size) > PROJECT_FILE_LIMIT) return { refused: 'tooLarge' };
        const text = await file.text(); if (!live()) return null;
        try {
            const opened = openProjectFile(text);
            return { document: opened.document, timeline: opened.timeline, sourceVersion: opened.sourceVersion };
        } catch { return { refused: 'invalid' }; }
    } catch { return live() ? { refused: 'unreadable' } : null; }
    finally { try { if (file?.exists) file.delete(); } catch { /* Best-effort private picker cleanup. */ } }
}
