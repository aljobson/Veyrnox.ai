// What a template upload tells the customer. Each figure is at or inside the limit its validator enforces:
// lib/uploadSource.js (20 MB), TemplatePhotoSlots (256 px), lib/templateSwapCutout.mjs and the phone's photoPlan.ts (swap).
export const TEMPLATE_PHOTO_LIMITS = Object.freeze({
  upload: Object.freeze({ key: 'presets.photoExample.limits', values: Object.freeze({ size: 20, side: 256 }) }),
  swap: Object.freeze({ key: 'presets.photoExample.swapLimits', values: Object.freeze({ size: 20, minSide: 300, maxSide: '8,000', megapixels: 24 }) }),
});

export const TEMPLATE_PHOTO_COPY = Object.freeze({
  face: 'presets.photoExample.face',
  fullBody: 'presets.photoExample.fullBody',
  scene: 'presets.photoExample.scene',
});
