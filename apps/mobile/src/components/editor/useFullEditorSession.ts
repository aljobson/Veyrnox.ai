import { useAnnouncement } from '../../lib/useAnnouncement';
import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthProvider';

import { ApiError } from '../../lib/api';
import { documentIdentity, type ProjectDocument } from '../../lib/editorBridge';
import { getDocument, putDocument } from '../../lib/editorProjects';
import { listEditorProjectAssets } from '../../lib/editorProjectAssets';
import { t } from '../../lib/i18n';

import { framesIn, timelineOf, type Clipboard, type Media, type Selection, type Timeline } from '../../lib/nativeEditorModel';
import { fetchProject } from '../../lib/projects';
import type { SlotKind } from '../../lib/sources';

type Tool = 'media' | 'audio' | 'generate' | 'templates' | 'elements' | 'text' | 'captions' | 'transcript' | 'scenes' | 'clips' | 'assistant' | 'effects' | 'transitions' | 'filters' | 'animation' | 'plugins' | 'brand' | 'review' | 'adjust';
type Ripple = 'none' | 'lane' | 'all';

export function useFullEditorSession({ projectId, jobId }: { projectId: string; jobId?: string }) {
    const { api } = useAuth();
    const router = useRouter();
    const mounted = useRef(true);
    const documentRef = useRef<ProjectDocument | null>(null);
    const revisionRef = useRef(0);
    const dirtyRef = useRef(false);
    const savingRef = useRef(false);
    const queuedRef = useRef(false);
    const pastRef = useRef<ProjectDocument[]>([]);
    const futureRef = useRef<ProjectDocument[]>([]);
    const [name, setName] = useState(t('editor.title'));
    const [document, setDocument] = useState<ProjectDocument | null>(null);
    const [revision, setRevision] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    useAnnouncement(document ? (saving ? t('editor.saving') : dirty ? 'Unsaved changes' : t('editor.saved')) : null);
    const [tool, setTool] = useState<Tool>('media');
    const [selection, setSelection] = useState<Selection | null>(null);
    const [selections, setSelections] = useState<Selection[]>([]);
    const [multiSelect, setMultiSelect] = useState(false);
    const [clipboard, setClipboard] = useState<Clipboard>(null);
    const [snap, setSnap] = useState(true);
    const [ripple, setRipple] = useState<Ripple>('none');
    const [zoom, setZoom] = useState(1);
    const [privacyNotice, setPrivacyNotice] = useState(false);
    const [history, setHistory] = useState({ canUndo: false, canRedo: false });
    const [frame, setFrame] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [projectAssets, setProjectAssets] = useState<Media[]>([]);
    const [localMediaUris, setLocalMediaUris] = useState<Record<string, string>>({});
    const [libraryKind, setLibraryKind] = useState<SlotKind | null>(null);
    const initialImport = useRef(false);

    const playbackTimeline = timelineOf(document?.timeline);
    const playbackTotal = framesIn(playbackTimeline);

    const markDocument = useCallback((next: ProjectDocument, record = true) => {
        if (record && documentRef.current) {
            pastRef.current.push(documentRef.current);
            if (pastRef.current.length > 30) pastRef.current.shift();
            futureRef.current = [];
            setHistory({ canUndo: true, canRedo: false });
        }
        documentRef.current = next;
        dirtyRef.current = true;
        setDocument(next);
        setDirty(true);
        setProblem(null);
    }, []);

    const save = useCallback(async (): Promise<boolean> => {
        if (!dirtyRef.current || !documentRef.current) return true;
        if (savingRef.current) { queuedRef.current = true; return false; }
        savingRef.current = true;
        if (mounted.current) setSaving(true);
        try {
            do {
                queuedRef.current = false;
                const snapshot = documentRef.current;
                if (!snapshot) break;
                const result = await putDocument(api, projectId, revisionRef.current, snapshot, randomUUID());
                revisionRef.current = result.revision;
                if (mounted.current) setRevision(result.revision);
                if (documentIdentity(documentRef.current) === documentIdentity(snapshot)) {
                    dirtyRef.current = false;
                    if (mounted.current) setDirty(false);
                }
            } while (queuedRef.current || dirtyRef.current);
            return true;
        } catch (error) {
            if (mounted.current) {
                const status = (error as ApiError).status;
                setProblem(status === 409 ? t('editor.conflict') : status === 0 ? t('editor.offline') : t('editor.retry'));
            }
            return false;
        } finally {
            savingRef.current = false;
            if (mounted.current) setSaving(false);
        }
    }, [api, projectId]);

    useEffect(() => {
        mounted.current = true;
        void Promise.all([fetchProject(api, projectId), getDocument(api, projectId), listEditorProjectAssets(api, projectId)])
            .then(([project, head, assets]) => {
                if (!mounted.current) return;
                if (project) setName(project.name);
                let loaded = head.document;
                if (jobId && !initialImport.current) {
                    initialImport.current = true;
                    const base = timelineOf(loaded.timeline);
                    const mediaId = `j-${jobId}`;
                    if (!base.media[mediaId]) {
                        const media: Media = { id: mediaId, name: project?.name || 'Library video', kind: 'video', frames: 300, hasAudio: true, width: 0, height: 0 };
                        const trackId = base.tracks.find((track) => track.kind === 'video' && !track.locked)?.id;
                        if (trackId) {
                            const seq = base.seq + 1;
                            const timeline: Timeline = { ...base, seq, media: { ...base.media, [mediaId]: media }, video: [...base.video, { id: `v${seq}`, mediaId, start: 0, in: 0, len: media.frames!, trackId, volume: 1, transition: 0, rate: 1 }] };
                            loaded = { ...loaded, schema_version: 3, timeline };
                            dirtyRef.current = true;
                            setDirty(true);
                        }
                    }
                }
                documentRef.current = loaded;
                revisionRef.current = head.revision;
                pastRef.current = [];
                futureRef.current = [];
                setSelection(null);
                setSelections([]);
                setClipboard(null);
                setHistory({ canUndo: false, canRedo: false });
                setProjectAssets(assets);
                setDocument(loaded);
                setRevision(head.revision);
            })
            .catch(() => { if (mounted.current) setProblem(t('editor.fullFailed')); });
        SecureStore.getItemAsync('veyrnox.editorPrivacyNotice.v1')
            .then((value) => { if (mounted.current && value !== 'seen') setPrivacyNotice(true); })
            .catch(() => { if (mounted.current) setPrivacyNotice(true); });
        return () => { mounted.current = false; };
    }, [api, jobId, projectId]);

    useEffect(() => {
        if (!dirty) return;
        const timer = setTimeout(() => { void save(); }, 900);
        return () => clearTimeout(timer);
    }, [dirty, document, save]);

    useEffect(() => {
        if (!playing || playbackTotal <= 0) return;
        const timer = setInterval(() => {
            setFrame((current) => {
                if (current >= playbackTotal - 1) {
                    setPlaying(false);
                    return 0;
                }
                return current + 1;
            });
        }, Math.max(16, Math.round(1000 / playbackTimeline.fps)));
        return () => clearInterval(timer);
    }, [playing, playbackTimeline.fps, playbackTotal]);

    const done = useCallback(async () => {
        const saved = await save();
        if (saved && !dirtyRef.current) router.back();
    }, [router, save]);
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
        markDocument(next, false);
        setSelection(null);
        setSelections([]);
        setHistory({ canUndo: pastRef.current.length > 0, canRedo: futureRef.current.length > 0 });
    }, [markDocument]);

    return { api, router, name, document, revision, dirty, saving, problem, setProblem, tool, setTool, selection, setSelection, selections, setSelections, multiSelect, setMultiSelect, clipboard, setClipboard, snap, setSnap, ripple, setRipple, zoom, setZoom, privacyNotice, history, frame, setFrame, playing, setPlaying, projectAssets, localMediaUris, setLocalMediaUris, libraryKind, setLibraryKind, markDocument, save, done, acknowledgePrivacy, travel };
}
