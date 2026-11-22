import { documentProblem, type DocumentCommitResult } from '../../lib/editorDocumentGate';
import { createFrameStore } from './editorFrameStore';
import { PPF_DEFAULT, SEQUENCE_MAX } from '../../lib/editorTimeline';
import { libraryMedia, LIBRARY_STOPPED } from '../../lib/editorLibraryLength';
import { cutFrames, type Cut } from '../../lib/smartCutHandoff';
import { isAccountChanged } from '../../auth/sessionTask';
import { useEditorSaveSync, type EditorSaveSync } from './useEditorSaveSync';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthProvider';

import { editorDeviceMedia } from '../../lib/editorDeviceMedia';
import { editorMedia } from '../../lib/editorMedia';
import { probeDuration } from '../../lib/editorMediaDuration';
import { documentIdentity, type ProjectDocument } from '../../lib/editorBridge';
import { getDocument, type DocumentHead } from '../../lib/editorProjects';
import { listEditorProjectAssets } from '../../lib/editorProjectAssets';
import { t } from '../../lib/i18n';

import { framesIn, timelineOf, type Clipboard, type Media, type Selection, type Timeline } from '../../lib/nativeEditorModel';
import { fetchProject } from '../../lib/projects';
import type { SlotKind } from '../../lib/sources';

type Tool = 'media' | 'audio' | 'generate' | 'text' | 'captions' | 'transcript' | 'scenes' | 'effects' | 'transitions' | 'filters' | 'animation' | 'motion' | 'mask' | 'markers' | 'brand' | 'adjust';
type Ripple = 'none' | 'lane' | 'all';
const EDITOR_LOAD_TIMEOUT_MS = 15000;

export function useFullEditorSession({ projectId, jobId, cuts, onOwnerChange = () => {}, onCopy = () => {} }: { projectId: string; jobId?: string; cuts?: readonly Cut[] | null; onOwnerChange?: () => void; onCopy?: (id: string) => void }) {
    const { api, beginSessionTask } = useAuth();
    const router = useRouter();
    const mounted = useRef(true);
    const documentRef = useRef<ProjectDocument | null>(null);
    const revisionRef = useRef(0);
    // Local monotonic freshness, independent of save revisions and timeline.seq.
    const editRevisionRef = useRef(0);
    const dirtyRef = useRef(false);
    const syncRef = useRef<EditorSaveSync | null>(null);
    const pastRef = useRef<ProjectDocument[]>([]);
    const futureRef = useRef<ProjectDocument[]>([]);
    const baselineSnapshots = useRef(new WeakSet<ProjectDocument>());
    const [name, setName] = useState(t('editor.title'));
    const projectName = useRef(name);
    const [document, setDocument] = useState<ProjectDocument | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
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
        if (!tl.media || typeof tl.media !== 'object') return doc;
        return { ...doc, timeline: { ...tl, media: Object.fromEntries(Object.entries(tl.media).map(([id, media]) => [id, backups.current[id] ? { ...media, assetSource: backups.current[id] } : media])) } };
    }, []);

    const playbackTimeline = timelineOf(document?.timeline);
    const playbackTotal = framesIn(playbackTimeline);

    const commitDocument = useCallback((next: ProjectDocument, record = true, historyBase?: ProjectDocument, restoreSnapshot = false): DocumentCommitResult => {
        if (!syncRef.current?.live()) return { status: 'not-live' };
        const currentIsValid = documentRef.current && documentProblem(documentRef.current) === null;
        const historyProblem = historyBase && documentProblem(historyBase);
        if (historyProblem && currentIsValid) {
            setProblem(t(`editorEditGate.${historyProblem}`));
            return { status: 'refused', reason: historyProblem };
        }
        let candidate = mergeBackups(next);
        let problem = documentProblem(candidate);
        // History may restore an exact accepted snapshot, but never a refused backup merge.
        const nextProblem = documentProblem(next), knownSnapshot = restoreSnapshot && baselineSnapshots.current.has(next);
        // Pending metadata must not block a valid edit or legacy undo; retain it for later.
        if (problem && (nextProblem === null || knownSnapshot)) { candidate = next; problem = nextProblem; }
        if (problem && !knownSnapshot && currentIsValid) {
            setProblem(t(`editorEditGate.${problem}`));
            return { status: 'refused', reason: problem };
        }
        next = candidate;
        if (record && documentRef.current) {
            // A failing base is allowed only when derived from an already-invalid live document.
            if (historyBase && historyProblem) baselineSnapshots.current.add(historyBase);
            pastRef.current.push(historyBase ?? documentRef.current);
            if (pastRef.current.length > 30) pastRef.current.shift();
            futureRef.current = [];
            setHistory({ canUndo: true, canRedo: false });
        }
        editRevisionRef.current++;
        documentRef.current = next;
        if (problem) baselineSnapshots.current.add(next);
        dirtyRef.current = true;
        setDocument(next);
        syncRef.current?.changed();
        setProblem(null);
        return { status: 'accepted' };
    }, [mergeBackups]);
    const markDocument = useCallback((next: ProjectDocument, record = true, historyBase?: ProjectDocument) =>
        commitDocument(next, record, historyBase), [commitDocument]);

    const applyBackup = useCallback((mediaId: string, source: NonNullable<Media['assetSource']>) => {
        if (!syncRef.current?.live()) return;
        // Keep metadata pending until the exact merged candidate is accepted.
        backups.current[mediaId] = source;
        syncRef.current.settle();
    }, []);

    const baseline = useCallback((head: DocumentHead) => {
        // A baseline replaces the whole project document (initial load, recovery, conflict,
        // restore or “use saved”). Fence native work before adopting the replacement.
        void editorMedia.bumpProjectGeneration(projectId).catch(() => undefined);
        editRevisionRef.current++;
        documentRef.current = head.document; revisionRef.current = head.revision; dirtyRef.current = false;
        pastRef.current = []; futureRef.current = [];
        baselineSnapshots.current = new WeakSet([head.document]);
        setSelection(null); setSelections([]); setClipboard(null);
        setHistory({ canUndo: false, canRedo: false }); setDocument(head.document);
        void editorDeviceMedia.hydrate(projectId, head.document).then(uris => {
            if (syncRef.current?.live() && documentIdentity(documentRef.current) === documentIdentity(head.document)) setLocalMediaUris(uris);
        }).catch(() => {});
    }, [projectId]);
    const saved = useCallback((doc: ProjectDocument) => {
        baselineSnapshots.current.add(doc);
        // Only ancestors of the acknowledged save become known baseline history.
        // A save may finish after more edits or an undo, so never bless the whole stack.
        const history = [...pastRef.current, ...(documentRef.current ? [documentRef.current] : []), ...futureRef.current.slice().reverse()];
        const index = history.indexOf(doc);
        for (const snapshot of history.slice(0, index + 1)) baselineSnapshots.current.add(snapshot);
    }, []);
    const entryImport = useCallback(async () => {
        if ((!jobId && !cuts) || initialImport.current) return;
        const token = syncRef.current?.beginImport(); if (!token) return;
        initialImport.current = true;
        try {
            if (cuts) {
                // Smart Cut's plan: each segment becomes a trimmed clip on the first video track, joined on the phone.
                const current = documentRef.current; if (!current) return;
                const base = timelineOf(current.timeline);
                if (base.video.length > 0) return;
                const trackId = base.tracks.find(track => track.kind === 'video' && !track.locked)?.id;
                if (!trackId) { setProblem(t('editor.unlockoraddatrackfirst', { value1: 'video' })); return; }
                const media: Record<string, Media> = { ...base.media };
                const byJob = new Map<string, Media>();
                for (const cut of cuts) {
                    if (byJob.has(cut.jobId)) continue;
                    const found = await libraryMedia(api, { jobId: cut.jobId, name: projectName.current || t('editor.libraryvideo2') }, 'video', () => token.valid());
                    if (found === LIBRARY_STOPPED || !token.valid()) return;
                    if (!found) { setProblem(t('editorCore.lengthUnknown')); return; }
                    media[found.id] = found;
                    byJob.set(cut.jobId, found);
                }
                let seq = base.seq, at = 0;
                const video = [...base.video];
                for (const cut of cuts) {
                    const frames = cutFrames(cut), source = byJob.get(cut.jobId);
                    if (!source) { setProblem(t('editorCore.lengthUnknown')); return; }
                    const len = Math.min(frames.len, Math.max(1, (source.frames ?? frames.in + frames.len) - frames.in), SEQUENCE_MAX - at);
                    if (len < 1) break;
                    seq += 1;
                    video.push({ id: `v${seq}`, mediaId: source.id, start: at, in: frames.in, len, trackId, volume: 1, transition: 0, rate: 1 });
                    at += len;
                }
                markDocument({ ...current, schema_version: 3, timeline: { ...base, seq, media, video } });
                return;
            }
            if (!jobId) return;
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
    }, [api, jobId, cuts, markDocument]);
    const sync = useEditorSaveSync({ api, projectId, name, documentRef, revisionRef, dirtyRef, baseline, saved, markDocument, mergeBackups, problem, setProblem, onOwnerChange, onCopy, entryImport,
        clearDocument: () => { editRevisionRef.current++; documentRef.current = null; setDocument(null); setPlaying(false); },
    });
    syncRef.current = sync;
    const { save, leaveEditor, beginImport, replacing, saveStatus, dirty, revision, saving } = sync;

    useEffect(() => {
        return () => { void editorMedia.bumpProjectGeneration(projectId).catch(() => undefined); };
    }, [projectId]);

    useEffect(() => {
        mounted.current = true;
        let cancelled = false;
        // Only the document gates the editor. The project name/workspace and the media list are best effort, so a slow or failing one cannot hide the timeline.
        const timer = setTimeout(() => { if (!cancelled && sync.live()) { cancelled = true; setProblem(t('editor.fullFailed')); } }, EDITOR_LOAD_TIMEOUT_MS);
        void Promise.all([fetchProject(api, projectId).catch(() => null), getDocument(api, projectId), listEditorProjectAssets(api, projectId).catch(() => [] as Media[])])
            .then(async ([project, head, assets]) => {
                if (cancelled || !sync.live()) return;
                clearTimeout(timer);
                if (project) { projectName.current = project.name; setName(project.name); }
                baseline(head); setProjectAssets(assets);
                await sync.loaded(head, project?.workspaceId ?? null);
            })
            .catch(error => { clearTimeout(timer); if (cancelled) return; if (isAccountChanged(error)) sync.accountChanged(); else if (sync.live()) setProblem(t('editor.fullFailed')); });
        SecureStore.getItemAsync('veyrnox.editorPrivacyNotice.v1')
            .then((value) => { if (mounted.current && value !== 'seen') setPrivacyNotice(true); })
            .catch(() => { if (mounted.current) setPrivacyNotice(true); });
        return () => { cancelled = true; clearTimeout(timer); mounted.current = false; };
    }, [api, baseline, projectId, sync, attempt]);
    const retryLoad = useCallback(() => { setProblem(null); setAttempt(count => count + 1); }, []);

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
        const next = source.at(-1), current = documentRef.current;
        if (!next || !current || commitDocument(next, false, undefined, true).status !== 'accepted') return;
        source.pop();
        destination.push(current);
        setSelection(null);
        setSelections([]);
        setHistory({ canUndo: pastRef.current.length > 0, canRedo: futureRef.current.length > 0 });
    }, [commitDocument]);

    const preparePicked = async (asset: { uri: string; mimeType?: string | null; duration?: number | null }, mediaId: string, kind: string,
        policy: boolean | { requireCopy?: boolean; backup?: boolean; expectedSha256?: string; expectedKind?: 'image' | 'video' | 'audio';
            onProgress?(stage: 'copying' | 'verifying'): void; live?(): boolean } = {}) => {
        const options = typeof policy === 'boolean' ? { requireCopy: policy } : policy;
        const token = sync.beginImport(); if (!token) return null;
        const task = beginSessionTask();
        try {
            const seconds = typeof asset.duration === 'number' && Number.isFinite(asset.duration) && asset.duration > 0 ? asset.duration / 1000 : kind === 'image' ? null : await probeDuration(asset.uri);
            if (!token.valid()) return null;
            const verified = options.expectedSha256 || options.expectedKind || options.onProgress || options.live;
            const file = verified ? await editorDeviceMedia.copy(projectId, mediaId, asset.uri, asset.mimeType || '', seconds,
                { expectedSha256: options.expectedSha256, expectedKind: options.expectedKind, onProgress: options.onProgress, live: options.live })
                : await editorDeviceMedia.copy(projectId, mediaId, asset.uri, asset.mimeType || '', seconds);
            if (!token.valid()) { if (file) await editorDeviceMedia.remove(projectId, mediaId); return null; }
            if (options.requireCopy && !file) return null;
            setLocalMediaUris(current => ({ ...current, [mediaId]: file?.file || asset.uri }));
            if (file && options.backup !== false) void editorDeviceMedia.backup(api, projectId, mediaId, file).then(source => {
                if (source && sync.live() && task.current()) applyBackup(mediaId, source);
            });
            return seconds ?? (kind === 'image' ? 3 : 10);
        } finally { token.end(); }
    };
    const savedDocument = async () => {
        const saved = await save(); if (!sync.live()) return null;
        if (!saved || dirtyRef.current) { if (dirtyRef.current) setProblem(current => current || t('editor.unsavedchanges2')); return null; }
        return documentRef.current;
    };

    return { getEditRevision: () => editRevisionRef.current, beginImport, replacing, leaveEditor, saveStatus, sync, currentDocument: () => documentRef.current, preparePicked, savedDocument, applyBackup, api, router, name, document, retryLoad, revision, dirty, saving, problem, setProblem, tool, setTool, selection, setSelection, selections, setSelections, multiSelect, setMultiSelect, clipboard, setClipboard, snap, setSnap, ripple, setRipple, zoom, setZoom, privacyNotice, history, frameStore, setFrame, playing, setPlaying, projectAssets, localMediaUris, setLocalMediaUris, libraryKind, setLibraryKind, markDocument, save, acknowledgePrivacy, travel };
}
