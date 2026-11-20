// Reproducible post-process of the pinned upstream FilmCraft web build's index.html
// (plan rev 7 and 8). Every replacement is an exact string match against the pinned release;
// if upstream text differs the build fails instead of guessing.
//
//  - the two inline <script> blocks become external files (so the child CSP needs no inline
//    script hash);
//  - a gate runs before the wasm is imported (single-use nonce from our host page);
//  - the two self-reload paths (WebGPU failure -> ?webgl, fatal overlay Reload) become
//    host-mediated restarts.

import { createHash } from 'node:crypto';

const SCRIPT_CLASSIC = /<script>\n([\s\S]*?)<\/script>/;
const SCRIPT_MODULE = /<script type="module">\n([\s\S]*?)<\/script>/;
const STYLE_BLOCK = /<style>([\s\S]*?)<\/style>/;

const RELOAD_BUTTON = 'document.getElementById("fatal-reload").onclick = () => location.reload();';
const RELOAD_BUTTON_NEW =
  'document.getElementById("fatal-reload").onclick = () => { const r = window.__proRestart; if (typeof r === "function") r({ renderer: "default", reason: "fatal-reload" }); };';

const WEBGL_RELOAD = [
  '        params.set("webgl", "");',
  '        location.replace(location.pathname + "?" + params.toString().replace(/=(&|$)/g, "$1") + location.hash);',
].join('\n');
const WEBGL_RELOAD_NEW =
  '        if (typeof window.__proRestart === "function") window.__proRestart({ renderer: "webgl", reason: "webgpu-init" });';

// The module moves from the document (/fc/index.html) to /pro/pro-boot.mjs, so its relative
// import of the glue must point back into /fc/. (The wasm URL is built from location.href and
// still resolves against the document.)
const GLUE_IMPORT = 'await import("./filmcraft_web.js" + v)';
const GLUE_IMPORT_NEW = 'await import("../fc/filmcraft_web.js" + v)';

// Upstream promises that a reload brings unsaved changes back. A host restart wipes local
// recovery data on purpose (it keeps accounts apart), so the copy and the button say so.
const FATAL_COPY = '<div>Unsaved changes are kept in the browser every few seconds and come back when you reload.</div>';
const FATAL_COPY_NEW = '<div>Restarting the editor clears its local recovery data. Only work you already saved in the Pro editor is kept.</div>';
const FATAL_BUTTON = '<button id="fatal-reload" type="button">Reload</button>';
const FATAL_BUTTON_NEW = '<button id="fatal-reload" type="button">Restart editor</button>';

function once(source, needle, label) {
  const first = source.indexOf(needle);
  if (first === -1 || source.indexOf(needle, first + needle.length) !== -1) {
    throw new Error('upstream index.html changed: expected exactly one ' + label);
  }
  return first;
}

function replaceExact(source, needle, replacement, label) {
  const at = once(source, needle, label);
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

function sha256Base64(text) {
  return createHash('sha256').update(text).digest('base64');
}

/**
 * @param {string} html upstream index.html
 * @returns {{html: string, files: Record<string,string>, styleHashes: string[]}}
 *   files are relative to the inner document ("../pro/..." is how the page references them).
 */
export function transformIndexHtml(html) {
  const classic = html.match(SCRIPT_CLASSIC);
  const module = html.match(SCRIPT_MODULE);
  const style = html.match(STYLE_BLOCK);
  if (!classic || !module || !style) throw new Error('upstream index.html changed: script/style blocks not found');
  if (html.split('<script').length !== 3) throw new Error('upstream index.html changed: expected exactly two scripts');
  if (html.split('<style>').length !== 2) throw new Error('upstream index.html changed: expected exactly one style block');

  const fatalSource = replaceExact(classic[1], RELOAD_BUTTON, RELOAD_BUTTON_NEW, 'fatal Reload handler');

  let bootBody = replaceExact(module[1], WEBGL_RELOAD, WEBGL_RELOAD_NEW, 'WebGL reload');
  bootBody = replaceExact(bootBody, GLUE_IMPORT, GLUE_IMPORT_NEW, 'glue import');
  // The upstream module body is wrapped so nothing runs unless the gate passes.
  const indented = bootBody.split('\n').map((line) => (line ? '  ' + line : line)).join('\n');
  const bootSource = [
    'import { evaluateGate } from "./gateLogic.mjs";',
    '',
    'const gate = evaluateGate({ win: window });',
    'if (!gate.ok) {',
    '  const s = document.getElementById("status");',
    '  if (s) s.textContent = "Open this editor from the Veyrnox.ai Pro editor.";',
    '  window.filmcraftLoad = Object.assign(window.filmcraftLoad || {}, { gate: gate.reason });',
    '} else {',
    '  window.__proRestart = gate.requestRestart;',
    indented.replace(/\n+$/, ''),
    '}',
    '',
  ].join('\n');

  let out = replaceExact(html, FATAL_COPY, FATAL_COPY_NEW, 'fatal recovery copy');
  out = replaceExact(out, FATAL_BUTTON, FATAL_BUTTON_NEW, 'fatal Reload button');
  out = out.replace(classic[0], '<script src="../pro/pro-fatal.js"></script>');
  out = out.replace(module[0], '<script type="module" src="../pro/pro-boot.mjs"></script>');

  return {
    html: out,
    files: { 'pro-fatal.js': fatalSource, 'pro-boot.mjs': bootSource },
    styleHashes: ["'sha256-" + sha256Base64(style[1]) + "'"],
  };
}
