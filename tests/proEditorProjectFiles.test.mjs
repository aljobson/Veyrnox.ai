import test from 'node:test';
import assert from 'node:assert/strict';
import { scanProProject, PROJECT_MAX_BYTES, MAX_SCHEMA, MAX_STRING_BYTES } from '../lib/proProjectScan.mjs';
import { inspectProjectFile, readFileBytes, sha256, withFileInspection } from '../lib/projectFiles.js';
const enc = s => new TextEncoder().encode(s);
const doc = (project, schema = 17) => enc(`{"format":"filmcraft.project","schema_version":${schema},"project":${project}}`);
test('scanner shares the schema range and hashes the exact raw project bytes including whitespace and UTF-8', async () => {
    const bytes = doc('{ "text": "🌍", "escaped": "\\\"}" }');
    const scanned = scanProProject(bytes); assert.equal(scanned.ok, true);
    const verdict = await inspectProjectFile(bytes);
    assert.equal(verdict.content_fingerprint, await sha256(enc('{ "text": "🌍", "escaped": "\\\"}" }')));
    assert.equal(verdict.content_sha256, await sha256(bytes));
    assert.equal(scanProProject(doc('{}', MAX_SCHEMA)).ok, true);
    assert.equal(scanProProject(doc('{}', MAX_SCHEMA + 1)).reason, 'invalid_schema');
});
test('scanner rejects syntax, duplicate/escaped envelope keys, depth, complexity, size, UTF-8 and wrong envelope', async () => {
    for (const project of ['[]','null','1','"text"']) assert.equal(scanProProject(doc(project)).reason, 'invalid_project');
    for (const project of ['{"a":}', '{"a":01}', '{"a":1,}', '{"a":"\\x"}', '{"a":true false}']) assert.equal(scanProProject(doc(project)).ok, false);
    assert.equal(scanProProject(enc('{"format":"filmcraft.project","schema_version":17,"project":{},"pro\\u006aect":{}}')).reason, 'invalid_json');
    assert.equal(scanProProject(doc('{"x":' + '['.repeat(64) + '0' + ']'.repeat(64) + '}')).reason, 'too_deep');
    assert.equal(scanProProject(doc('{"x":"' + 'x'.repeat(MAX_STRING_BYTES + 1) + '"}')).reason, 'too_complex');
    assert.equal(scanProProject(doc('{"x":[' + '0,'.repeat(1500000) + '0]}')).reason, 'too_complex');
    assert.equal(scanProProject(new Uint8Array(PROJECT_MAX_BYTES + 1)).reason, 'too_large');
    const invalid = doc('{"x":"a"}'); invalid[invalid.length - 4] = 255;
    assert.equal(scanProProject(invalid).reason, 'invalid_utf8');
    assert.equal(scanProProject(enc('{"format":"wrong","schema_version":17,"project":{}}')).reason, 'invalid_format');
});
test('bounded streaming refuses short or oversized reads; semaphore never retains a second inspection', async () => {
    await assert.rejects(readFileBytes(new Response('abcd'), 3));
    await assert.rejects(readFileBytes(new Response('ab'), 3));
    assert.deepEqual(await readFileBytes(new Response('abc'), 3), enc('abc'));
    let release;
    const first = withFileInspection(() => new Promise(r => { release = r; }));
    await assert.rejects(withFileInspection(async () => {}), { code: 'inspection-busy' });
    release(); await first;
    assert.equal(await withFileInspection(async () => 1), 1);
});
test('the scanner never decodes or parses the whole document: only the tiny envelope members are parsed', async () => {
    // ~4 MiB of small members: a graph of hundreds of thousands of objects if it were built.
    const body = '{' + Array.from({ length: 200000 }, (_, i) => `"k${i}":{}`).join(',') + '}';
    const bytes = doc(body);
    const originalParse = JSON.parse;
    let longest = 0, calls = 0;
    JSON.parse = (text, ...rest) => { calls += 1; longest = Math.max(longest, String(text).length); return originalParse(text, ...rest); };
    let scanned;
    try { scanned = scanProProject(bytes); } finally { JSON.parse = originalParse; }
    assert.equal(scanned.ok, true);
    assert.ok(longest <= 64, 'longest JSON.parse input was ' + longest);
    assert.ok(calls < 10, 'only top-level keys and the two envelope values: ' + calls + ' parses');
    assert.equal(scanned.projectBytes.length, enc(body).length);
});
test('the envelope is checked from byte ranges: oversized format or version members, and a non-object project by its first byte', async () => {
    assert.equal(scanProProject(enc('{"format":"' + 'f'.repeat(100) + '","schema_version":17,"project":{}}')).reason, 'invalid_format');
    assert.equal(scanProProject(enc('{"format":"filmcraft.project","schema_version":17.5,"project":{}}')).reason, 'invalid_schema');
    assert.equal(scanProProject(enc('{"format":"filmcraft.project","schema_version":' + '1'.repeat(40) + ',"project":{}}')).reason, 'invalid_schema');
    assert.equal(scanProProject(enc('{"format":"filmcraft.project","project":{}}')).reason, 'invalid_schema');
    assert.equal(scanProProject(enc('{"schema_version":17,"project":{}}')).reason, 'invalid_format');
    assert.equal(scanProProject(enc('{"format":"filmcraft.project","schema_version":17}')).reason, 'invalid_project');
    const bad = enc('{"format":"filmcraft.project","schema_version":17,"project":{"s":"abc"}}');
    bad[bad.indexOf(0x62)] = 0xc3; bad[bad.indexOf(0x63)] = 0x28; // an invalid two-byte sequence inside a string
    assert.equal(scanProProject(bad).reason, 'invalid_utf8');
});
test('top-level member cardinality is bounded before any key is decoded or stored', async () => {
    const members = n => Array.from({ length: n }, (_, i) => `,"k${i}":${i}`).join('');
    const envelope = extra => enc(`{"format":"filmcraft.project","schema_version":17,"project":{}${extra}}`);
    assert.equal(scanProProject(envelope(members(29))).ok, true, '32 members in total are allowed');
    assert.equal(scanProProject(envelope(members(30))).reason, 'too_complex', 'the 33rd is refused');
    const originalParse = JSON.parse; let parsed = 0;
    JSON.parse = (...args) => { parsed += 1; return originalParse(...args); };
    let result;
    try { result = scanProProject(envelope(members(300000))); } finally { JSON.parse = originalParse; }
    assert.equal(result.reason, 'too_complex');
    assert.ok(parsed <= 40, 'at most the bounded number of keys was ever decoded: ' + parsed);
});
