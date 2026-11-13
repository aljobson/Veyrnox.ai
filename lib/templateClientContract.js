import { templateRouteContract } from './templateRoute.js';
import { clientContractFor } from './templateClientContractRuntime.js';
export { templatePhotoHints, templatePhotosUnavailable, templateBoundPrompt, fidelityBlocked, fidelityTemplateId, templatePhotoError } from './templateFidelityRuntime.js';
export const templateContract = preset => preset?.kind === 'image' ? null : clientContractFor(preset, templateRouteContract(preset?.id));
