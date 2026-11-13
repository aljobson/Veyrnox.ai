const fs = require('node:fs');
const path = require('node:path');
const { readEnabled, writeDarkStub } = require('./live-edit-build-state.cjs');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
// A clean dark checkout bundles without downloading 32 MB. An enabled build MUST prepare.
module.exports = function ensureLiveEdit() {
    const directory = path.join(__dirname, '../assets/live-edit');
    const file = path.join(directory, 'runtime.html');
    const enabled = readEnabled();
    if (!enabled) { writeDarkStub(); return; }
    if (enabled && (!fs.existsSync(path.join(directory, 'manifest.json')) || !fs.existsSync(file))) throw Error('Run node scripts/prepare-live-edit.mjs before enabling Live Edit');
    if (enabled) {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
        const html = fs.readFileSync(file);
        if (manifest.inventorySha256 !== digest(fs.readFileSync(path.join(__dirname, '../../../scripts/editor-vision-assets.mjs'))) || manifest.htmlBytes !== html.length || manifest.htmlSha256 !== digest(html) ||
            manifest.runnerSha256 !== digest(fs.readFileSync(path.join(__dirname, 'live-edit-webview.js'))) ||
            manifest.prepareSha256 !== digest(fs.readFileSync(path.join(__dirname, 'prepare-live-edit.mjs')))) throw Error('Stale mobile vision asset: run prepare-live-edit.mjs');
    }
};
