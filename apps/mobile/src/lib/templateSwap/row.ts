import { useEffect, useState } from 'react';
import { API_BASE } from '../api';
import { TEMPLATE_SWAP_RUNTIME } from './runtimeFlag';
import { fetchSwapRow } from '../../../../../app/veyrnox/_lib/swapRowClient.mjs';
import { TEMPLATE_SWAP_ROW } from '../../../../../app/veyrnox/_lib/templateSwapRow.js';
export type SwapRowCard = (typeof TEMPLATE_SWAP_ROW)[number] & { readonly credits: number };
/** The live "Put yourself in" cards for the phone home: [] while the build has the swap runtime off or the server's switch is off. */
export function useSwapRow(): readonly SwapRowCard[] {
    const [cards, setCards] = useState<readonly SwapRowCard[]>([]);
    useEffect(() => {
        if (!TEMPLATE_SWAP_RUNTIME) return;
        const controller = new AbortController();
        void fetchSwapRow(fetch, API_BASE, controller.signal).then(rows => { if (!controller.signal.aborted) setCards(rows); });
        return () => controller.abort();
    }, []);
    return TEMPLATE_SWAP_RUNTIME ? cards : [];
}
/** Poster address: the static path joined to the API origin, never a hardcoded host. */
export const swapRowPoster = (path: string, base: string = API_BASE) => `${base}${path}`;
