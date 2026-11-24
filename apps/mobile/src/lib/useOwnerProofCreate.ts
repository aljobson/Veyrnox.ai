import { useMemo, useState } from 'react';
import { mergeOwnerProofModels, ownerProofExposure, hasOwnerProofExposure, type OwnerProofExposure } from '../../../../lib/ownerProofOverlay.mjs';
import { useOwnerProofModels } from './useOwnerProofModels';
import { isSupported, type CatalogModel } from './media';

interface OwnerProofCreateInput<R extends { slot: string }, F> {
    publicCatalog: CatalogModel[];
    publicModel: CatalogModel | null;
    swapScene: unknown;
    accountEpoch: number;
    references: readonly R[];
    startFile: F | null;
    setReferences: (update: (current: readonly R[]) => readonly R[]) => void;
    setStartFile: (file: F | null) => void;
    setError: (error: string | null) => void;
}

/**
 * The Create form's owner-proof overlay: merges the private models, picks the private record for the
 * current model (never for a swap scene), and reports an attached source whose private slot was withdrawn
 * so the form can block submit and offer removal instead of silently dropping it.
 */
export function useOwnerProofCreate<R extends { slot: string }, F>(input: OwnerProofCreateInput<R, F>) {
    const { publicCatalog, publicModel, swapScene, accountEpoch, references, startFile } = input;
    const privateModels = useOwnerProofModels();
    const catalog = useMemo(() => mergeOwnerProofModels(publicCatalog, privateModels.filter(isSupported)), [publicCatalog, privateModels]);
    const model = swapScene ? publicModel : publicModel ? privateModels.find(m => m.id === publicModel.id) ?? publicModel : null;
    const [proofExposure, setProofExposure] = useState<OwnerProofExposure | null>(null);
    const privateImage = !swapScene && !!privateModels.find(m => m.id === model?.id)?.capabilities?.media?.image && !publicModel?.capabilities?.media?.image;
    const exposed = ownerProofExposure(proofExposure, model?.id ?? '', accountEpoch, privateImage, references.some(ref => ref.slot === 'image') || !!startFile);
    if (exposed !== proofExposure) setProofExposure(exposed);
    const exposedHere = !swapScene && hasOwnerProofExposure(exposed, model?.id ?? '', accountEpoch);
    const media = model?.capabilities?.media as Record<string, unknown> | undefined;
    const withdrawn = exposedHere ? references.filter(ref => !media?.[ref.slot]) : [];
    const unsupportedProofSource = withdrawn.length > 0 || (exposedHere && !!startFile && !media?.image);
    const removeProofImage = () => {
        input.setReferences(current => current.filter(ref => !withdrawn.includes(ref)));
        input.setStartFile(null);
        input.setError(null);
    };
    return { catalog, model, unsupportedProofSource, removeProofImage };
}
