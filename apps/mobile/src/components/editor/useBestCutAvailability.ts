import { EDITOR_ENABLED, FULL_EDITOR_ENABLED } from '../../lib/editorFlag';
import { useEffect, useState } from 'react';
import type { ApiClient } from '../../lib/api';
import { subscribeCacheUser } from '../../lib/appCache';
import { fetchSpeechQuote, type SpeechQuote } from '../../lib/speechAnalysis';
export function useBestCutAvailability(api: ApiClient) {
    const [quote, setQuote] = useState<SpeechQuote | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        if (EDITOR_ENABLED && FULL_EDITOR_ENABLED && process.env.EXPO_PUBLIC_BEST_CUT_ENABLED === 'true') void fetchSpeechQuote(api, controller.signal, true).then(value => {
            if (!controller.signal.aborted && value?.source_types?.includes('job') && value.source_types.includes('upload')) setQuote(value);
        }).catch(() => {});
        const off = subscribeCacheUser(() => { controller.abort(); setQuote(null); });
        return () => { controller.abort(); off(); };
    }, [api]);
    return { quote, setQuote };
}
