import { createFrameStore } from './editorFrameStore';
import { PPF_DEFAULT, SEQUENCE_MAX } from '../../lib/editorTimeline';
import { libraryMedia, LIBRARY_STOPPED } from '../../lib/editorLibraryLength';
import { isAccountChanged } from '../../auth/sessionTask';
import { useEditorSaveSync, type EditorSaveSync } from './useEditorSaveSync';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthProvider';

import { editorDeviceMedia } from '../../lib/editorDeviceMedia';
import { probeDuration } from '../../lib/editorMediaDuration';
import { documentIdentity, type ProjectDocument } from '../../lib/editorBridge';
import { getDocument, type DocumentHead } from '../../lib/editorProjects';
import { listEditorProjectAssets } from '../../lib/editorProjectAssets';
import { t } from '../../lib/i18n';

import { framesIn, timelineOf, type Clipboard, type Media, type Selection, type Timeline } from '../../lib/nativeEditorModel';
import { fetchProject } from '../../lib/projects';
import type { SlotKind } from '../../lib/sources';

type Tool = 'media' | 'audio' | 'generate' | 'text' | 'captions' | 'transcript' | 'effects' | 'transitions' | 'filters' | 'animation' | 'markers' | 'brand' | 'adjust';
type Ripple = 'none' | 'lane' | 'all';

export function useFullEditorSession({ projectId, jobId, onOwnerChange = () => {}, onCopy = () => {} }: { projectId: string; jobId?: string; onOwnerChange?: () => void; onCopy?: (id: string) => void }) {
    const { api, beginSessionTask } = useAuth();
    const router = useRouter();
    const mounted = useRef(true);
    const documentRef = useRef<ProjectDocument | null>(null);
    const revisionRef = useRef(0);
    const dirtyRef = useRef(false);
    const syncRef = useRef<EditorSaveSync | null>(null);
    const pastRef = useRef<ProjectDocument[]>([]);
    const futureRef = useRef<ProjectDocument[]>([]);
    const [name, setName] = useState(t('editor.title'));
    const projectName = useRef(name);
    const [document, setDocument] = useState<ProjectDocument | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [tool, setTool] = useState<Tool>('media');
    const [selection, setSelection] = useState<Selection | null>(null);
    const [selections, setSelections] = useState<Selection[]>([]);
    const [multiSelect, setMultiSelect] = useState(false);
    const [clipboard, setClipboard] = useState<Clipboard>(null);
    const [snap, setSnap] = useState(true);
    const [ripple, setRipple] = useState<Ripple>('none');
    const [zoom, setZoom] = useState(PPF_DEFAULT);
    const [privacyNotice, setPrivacyNotice] = useState(false);
    const [history, setHistory] = useState({ canUndo: false, canRedo: false });
    const [frameStore] = useState(createFrameStore);
    const setFrame = frameStore.set;
    const [playing, setPlaying] = useState(false);
    const [projectAssets, setProjectAssets] = useState<Media[]>([]);
    const [localMediaUris, setLocalMediaUris] = useState<Record<string, string>>({});
    const [libraryKind, setLibraryKind] = useState<SlotKind | null>(null);
    const initialImport = useRef(false);
    const backups = useRef<Record<string, NonNullable<Media['assetSource']>>>({});
    const mergeBackups = useCallback((doc: ProjectDocument): ProjectDocument => {
        if (!doc.timeline) return doc;
        const tl = doc.timeline as Timeline;
        return { ...doc, timeline: { ...tl, media: Object.fromEntries(Object.entries(tl.media).map(([id, media]) => [id, backups.current[id] ? { ...media, assetSource: backups.current[id] } : media])) } };
    }, []);

    const playbackTimeline = timelineOf(document?.timeline);
    const playbackTotal = framesIn(playbackTimeline);

    const markDocument = useCallback((next: ProjectDocument, record = true) => {
        if (!syncRef.current?.live()) return;
        if (record && documentRef.current) {
            pastRef.current.push(documentRef.current);
            if (pastRef.current.length > 30) pastRef.current.shift();
            futureRef.current = [];
            setHistory({ canUndo: true, canRedo: false });
        }
        next = mergeBackups(next);
        documentRef.current = next;
        dirtyRef.current = true;
        setDocument(next);
        syncRef.current?.changed();
        setProblem(null);
    }, [mergeBackups]);

    const applyBackup = useCallback((mediaId: string, source: NonNullable<Media['assetSource']>) => {
        if (!syncRef.current?.live()) return;
        backups.current[mediaId] = source;
        pastRef.current = pastRef.current.map(mergeBackups);
        futureRef.current = futureRef.current.map(mergeBackups);
        syncRef.current.settle();
    }, [mergeBackups]);

    const baseline = useCallback((head: DocumentHead) => {
        documentRef.current = head.document; revisionRef.current = head.revision; dirtyRef.current = false;
        pastRef.current = []; futureRef.current = [];
        setSelection(null); setSelections([]); setClipboard(null);
        setHistory({ canUndo: false, canRedo: false }); setDocument(head.document);
        void editorDeviceMedia.hydrate(projectId, head.document).then(uris => {
            if (syncRef.current?.live() && documentIdentity(documentRef.current) === documentIdentity(head.document)) setLocalMediaUris(uris);
        }).catch(() => {});
    }, [projectId]);
    const entryImport = useCallback(async () => {
        if (!jobId || initialImport.current) return;
        const token = syncRef.current?.beginImport(); if (!token) return;
        initialImport.current = true;
        try {
            if (timelineOf(documentRef.current?.timeline).media[`j-${jobId}`]) return;
            const media = await libraryMedia(api, { jobId, name: projectName.current || t('editor.libraryvideo2') }, 'video', () => token.valid());
            if (media === LIBRARY_STOPPED || !token.valid()) return;
            if (!media) { setProblem(t('editorCore.lengthUnknown')); return; }
            const current = documentRef.current; if (!current) return;
            const base = timelineOf(current.timeline);
            const trackId = base.tracks.find(track => track.kind === 'video' && !track.locked)?.id;
            if (!trackId) { setProblem(t('editor.unlockoraddatrackfirst', { value1: 'video' })); return; }
            const seq = base.seq + 1;
            markDocument({ ...current, schema_version: 3, timeline: { ...base, seq, media: { ...base.media, [media.id]: media }, video: [...base.video, { id: `v${seq}`, mediaId: media.id, start: 0, in: 0, len: Math.min(media.frames!, SEQUENCE_MAX), trackId, volume: 1, transition: 0, rate: 1 }] } });
        } catch (error) { if (isAccountChanged(error)) syncRef.current?.accountChanged(); else if (token.valid()) setProblem(t('editorCore.lengthUnknown')); }
        finally { token.end(); }
    }, [api, jobId, markDocument]);
    const sync = useEditorSaveSync({ api, projectId, name, documentRef, revisionRef, dirtyRef, baseline, markDocument, mergeBackups, problem, setProblem, onOwnerChange, onCopy, entryImport,
        clearDocument: () => { documentRef.current = null; setDocument(null); setPlaying(false); },
    });
    syncRef.current = sync;
    const { save, leaveEditor, beginImport, replacing, saveStatus, dirty, revision, saving } = sync;

    useEffect(() => {
        mounted.current = true;
        let cancelled = false;
        void Promise.all([fetchProject(api, projectId), getDocument(api, projectId), listEditorProjectAssets(api, projectId)])
            .then(async ([project, head, assets]) => {
                if (cancelled || !sync.live()) return;
                if (project) { projectName.current = project.name; setName(project.name); }
                baseline(head); setProjectAssets(assets);
                await sync.loaded(head, project?.workspaceId ?? null);
            })
            .catch(error => { if (isAccountChanged(error)) sync.accountChanged(); else if (sync.live()) setProblem(t('editor.fullFailed')); });
        SecureStore.getItemAsync('veyrnox.editorPrivacyNotice.v1')
            .then((value) => { if (mounted.current && value !== 'seen') setPrivacyNotice(true); })
            .catch(() => { if (mounted.current) setPrivacyNotice(true); });
        return () => { cancelled = true; mounted.current = false; };
    }, [api, baseline, projectId, sync]);

    useEffect(() => {
        if (!playing || playbackTotal <= 0) return;
        const timer = setInterval(() => {
            const current = frameStore.get();
            if (current >= playbackTotal - 1) {
                clearInterval(timer);
                setPlaying(false);
                frameStore.set(0);
            } else frameStore.set(current + 1);
        }, Math.max(16, Math.round(1000 / playbackTimeline.fps)));
        return () => clearInterval(timer);
    }, [playing, playbackTimeline.fps, playbackTotal, frameStore]);

    const acknowledgePrivacy = useCallback(() => {
        setPrivacyNotice(false);
        SecureStore.setItemAsync('veyrnox.editorPrivacyNotice.v1', 'seen').catch(() => {});
    }, []);
    const travel = useCallback((direction: 'undo' | 'redo') => {
        const source = direction === 'undo' ? pastRef.current : futureRef.current;
        const destination = direction === 'undo' ? futureRef.current : pastRef.current;
        const next = source.pop();
        if (!next || !documentRef.current) return;
        destination.push(documentRef.current);
        markDocument(mergeBackups(next), false);
        setSelection(null);
        setSelections([]);
        setHistory({ canUndo: pastRef.current.length > 0, canRedo: futureRef.current.length > 0 });
    }, [markDocument, mergeBackups]);

    const preparePicked = async (asset: { uri: string; mimeType?: string | null; duration?: number | null }, mediaId: string, kind: string, requireCopy = false) => {
        const token = sync.beginImport(); if (!token) return null;
        const task = beginSessionTask();
        try {
            const seconds = typeof asset.duration === 'number' && Number.isFinite(asset.duration) && asset.duration > 0 ? asset.duration / 1000 : kind === 'image' ? null : await probeDuration(asset.uri);
            if (!token.valid()) return null;
            const file = await editorDeviceMedia.copy(projectId, mediaId, asset.uri, asset.mimeType || '', seconds);
            if (!token.valid()) return null;
            if (requireCopy && !file) return null;
            setLocalMediaUris(current => ({ ...current, [mediaId]: file?.file || asset.uri }));
            if (file) void editorDeviceMedia.backup(api, projectId, mediaId, file).then(source => { if (source && sync.live() && task.current()) applyBackup(mediaId, source); });
            return seconds ?? (kind === 'image' ? 3 : 10);
        } finally { token.end(); }
    };
    const savedDocument = async () => {
        const saved = await save(); if (!sync.live()) return null;
        if (!saved || dirtyRef.current) { if (dirtyRef.current) setProblem(current => current || t('editor.unsavedchanges2')); return null; }
        return documentRef.current;
    };

    return { beginImport, replacing, leaveEditor, saveStatus, sync, currentDocument: () => documentRef.current, preparePicked, savedDocument, applyBackup, api, router, name, document, revision, dirty, saving, problem, setProblem, tool, setTool, selection, setSelection, selections, setSelections, multiSelect, setMultiSelect, clipboard, setClipboard, snap, setSnap, ripple, setRipple, zoom, setZoom, privacyNotice, history, frameStore, setFrame, playing, setPlaying, projectAssets, localMediaUris, setLocalMediaUris, libraryKind, setLibraryKind, markDocument, save, acknowledgePrivacy, travel };
}
