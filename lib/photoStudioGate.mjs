import { editorFeatureEnabled } from './editorRuntimeFlags.mjs';
export function photoStudioRouteDisabled(pathname, env) {
    return /^\/(?:veyrnox\/)?app\/photo-studio(?:\/|$)/.test(pathname) && !editorFeatureEnabled('PHOTO_STUDIO_ENABLED', env);
}
/** Vey must not recommend a dark route, even though the generated inventory records it. */
const withoutPhotoStudio = new WeakMap();
export function visiblePhotoStudioInventory(inventory, env) {
    if (editorFeatureEnabled('PHOTO_STUDIO_ENABLED', env)) return inventory;
    if (!withoutPhotoStudio.has(inventory)) withoutPhotoStudio.set(inventory, Object.freeze(inventory.filter(entry => entry.route !== '/app/photo-studio')));
    return withoutPhotoStudio.get(inventory);
}
