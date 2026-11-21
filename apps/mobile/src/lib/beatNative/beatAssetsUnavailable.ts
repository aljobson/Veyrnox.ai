// Metro swaps this in for the web beatAssets.js when the web mixdown imports it (metro.config.js).
// That module pulls in the browser gateway and web auth. Native export refuses every non-take source
// before rendering, so these are never reached; if one is, it fails closed rather than exporting.
const refuse = (): never => { throw new Error('beat_assets_unavailable_on_native'); };
export const assetState = refuse;
export const loadAssetBuffers = refuse;
export const prepareExportCache = refuse;
export const renderSound = refuse;
