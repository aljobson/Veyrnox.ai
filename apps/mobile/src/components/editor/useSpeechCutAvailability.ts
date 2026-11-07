import { useEffect, useState } from 'react';
import { EDITOR_SPEECH_CUT_ENABLED } from '../../lib/editorFlag';
import { subscribeCacheUser } from '../../lib/appCache';
import type { ApiClient } from '../../lib/api';
import type { SpeechMode } from '../../lib/speechCut';
import { fetchSpeechQuote, type SpeechQuote } from '../../lib/speechAnalysis';
export function useSpeechCutAvailability(api: ApiClient, projectId: string) {
    const [speechQuote, setSpeechQuote] = useState<SpeechQuote | null>(null), [speechMode, setSpeechMode] = useState<SpeechMode | null>(null);
    useEffect(() => {
        const controller = new AbortController(); setSpeechQuote(null); setSpeechMode(null);
        if (EDITOR_SPEECH_CUT_ENABLED) void fetchSpeechQuote(api, controller.signal).then(quote => { if (!controller.signal.aborted) setSpeechQuote(quote); }).catch(() => {});
        const unsubscribe = subscribeCacheUser(() => { controller.abort(); setSpeechQuote(null); setSpeechMode(null); });
        return () => { controller.abort(); unsubscribe(); };
    }, [api, projectId]);
    return { speechQuote, setSpeechQuote, speechMode, setSpeechMode };
}
