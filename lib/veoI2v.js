import { appRuntimeFlag } from './appRuntime.js';

// Route endpoints stay t2v. Proof markers are appended only after the owner's billed signed-source proof.
export const VEO_I2V = Object.freeze({
    'veo-3.1-lite-kie': { flag: 'veoI2vLite', model: 'google/veo3-1-lite-i2v' },
    'veo-3.1-fast-kie': { flag: 'veoI2vFast', model: 'google/veo3-1-fast-i2v' },
    'veo-3.1-kie': { flag: 'veoI2v31', model: 'google/veo3-1-i2v' },
});
export const veoI2vOffer = id => Object.hasOwn(VEO_I2V, id) ? VEO_I2V[id] : null;
export const veoI2vEnabled = (id, env = process.env) => !!veoI2vOffer(id) && appRuntimeFlag(VEO_I2V[id].flag, env);
export const anyVeoI2vEnabled = (env = process.env) => Object.values(VEO_I2V).some(({ flag }) => appRuntimeFlag(flag, env));
export const veoI2vMarker = model => `[veo-i2v:${model}:signed-source:v1]`;
export const VEO_IMAGE_SLOT = Object.freeze({ field: 'img_urls', list: true, max: 1 });
export function veoI2vCapability(endpoint, record, env = process.env) {
    const variant = Object.values(VEO_I2V).find(({ model }) => endpoint === `crun:${model.replace(/-i2v$/, '-t2v')}`);
    return variant && appRuntimeFlag(variant.flag, env) ? { ...record, media: { image: VEO_IMAGE_SLOT } } : record;
}

