const { TestEnvironment } = require('jest-environment-node');
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit');

module.exports = class CanvasKitEnvironment extends TestEnvironment {
    async setup() {
        await super.setup();
        this.global.CanvasKit = await CanvasKitInit({});
    }
};
