// Full audit contract: server generation guard and offline audit/tests only.
// Browser/native callers use templateClientContract and the selected API response.
import contracts from './templateFidelityContracts.json' with { type: 'json' };
export { templatePhotoHints, templatePhotosUnavailable, templateBoundPrompt, fidelityBlocked, fidelityTemplateId, templatePhotoError } from './templateFidelityRuntime.js';
import { expandFidelityContract } from './expandTemplateContract.js';
export const templateContract = id => expandFidelityContract(contracts, id);

export { templateRoute } from './templateRoute.js';
