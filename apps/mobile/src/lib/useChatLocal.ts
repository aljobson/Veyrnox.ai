import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { subscribeCacheUser } from './appCache';
import { captureChat, currentCapture, readDraft, readStars, toggleStar, writeDraft, type ChatCapture } from './chatLocal';

export function useChatLocal(threadId: string, prompt?: string) {
    const [draft, setText] = useState('');
    const [stars, setStars] = useState<string[]>([]);
    const [starredOnly, setStarredOnly] = useState(false);
    const mounted = useRef(false);
    const value = useRef('');
    const revision = useRef(0);
    const starsRevision = useRef(0);
    const pending = useRef<{ text: string; capture: ChatCapture } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const flush = useCallback(() => {
        clearTimeout(timer.current);
        const p = pending.current; pending.current = null;
        if (p) void writeDraft(p.capture.threadId, p.text, undefined, p.capture.owner, p.capture);
    }, []);
    const setDraft = useCallback((action: SetStateAction<string>) => {
        const text = typeof action === 'function' ? action(value.current) : action;
        revision.current++; value.current = text; setText(text);
        pending.current = { text, capture: captureChat(threadId) };
        clearTimeout(timer.current);
        if (!text) flush(); else timer.current = setTimeout(flush, 400);
    }, [threadId, flush]);
    useEffect(() => {
        mounted.current = true;
        value.current = prompt ?? ''; setText(prompt ?? ''); setStars([]); setStarredOnly(false);
        const capture = captureChat(threadId);
        const started = revision.current, starStarted = starsRevision.current;
        let active = true;
        void readDraft(threadId).then(text => {
            if (active && currentCapture(capture) && started === revision.current && prompt === undefined && !value.current) { value.current = text; setText(text); }
        });
        void readStars(threadId).then(ids => { if (active && currentCapture(capture) && starStarted === starsRevision.current) setStars(ids); });
        const unsubscribe = subscribeCacheUser(() => {
            clearTimeout(timer.current); pending.current = null; value.current = '';
            setText(''); setStars([]); setStarredOnly(false);
        });
        return () => { active = false; mounted.current = false; unsubscribe(); flush(); };
    }, [threadId, flush, prompt]);
    const star = useCallback(async (messageId: string) => {
        starsRevision.current++;
        const capture = captureChat(threadId);
        const ids = await toggleStar(threadId, messageId);
        if (ids && mounted.current && currentCapture(capture)) { setStars(ids); if (!ids.length) setStarredOnly(false); }
    }, [threadId]);
    return { draft, setDraft, stars, star, starredOnly, setStarredOnly, mounted };
}
