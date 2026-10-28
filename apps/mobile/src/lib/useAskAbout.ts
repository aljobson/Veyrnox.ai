import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ApiClient } from './api';
import { imagesExtra, type ChatModel } from './chat';
import type { ChatImage } from './chatAttach';
import { mediaApi } from './media';
import { t } from './i18n';
import { captureChat, currentCapture } from './chatLocal';

export const isAssetId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function useAskAbout(api: ApiClient, asset: unknown, model: ChatModel | null, max: number, setImages: Dispatch<SetStateAction<ChatImage[]>>, notice: (value: string) => void) {
    const started = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        if (started.current || !model || !isAssetId(asset)) return;
        started.current = true;
        if (imagesExtra(model) === null) { notice(t('chatDepth.noImageModel')); return; }
        const capture = captureChat(asset);
        void mediaApi(api).getAsset(asset).then(result => {
            if (!mounted.current || !currentCapture(capture)) return;
            if (!result.mime_type.startsWith('image/')) { notice(t('chatDepth.imagesOnly')); return; }
            setImages(current => current.length < max && !current.some(image => image.assetId === asset)
                ? [...current, { id: `a-${asset}`, assetId: asset, preview: result.url }] : current);
        }, () => { if (mounted.current && currentCapture(capture)) notice(t('chatDepth.imageExpired')); });
    }, [api, asset, model, max, setImages, notice]);
}
