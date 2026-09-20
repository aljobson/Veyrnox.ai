import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ALLOWED_UPLOAD_TYPES, checkDeclared, uploadKeyFor, ownsUploadKey, sniffType, checkSniffed,
} from '../lib/uploadSource.js';

const AUTH = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ── gate 1: the claim ────────────────────────────────────────────────
test('only allowlisted media types are signed for', () => {
    assert.equal(checkDeclared('image/png', 1024).ok, true);
    for (const bad of ['image/heic', 'image/svg+xml', 'text/html', 'application/pdf', 'image/gif', '', null, 'image/png; charset=utf-8']) {
        assert.equal(checkDeclared(bad, 1024).error, 'upload_type_not_allowed', `${bad} must be refused`);
    }
});

test('an inherited Object property is not a media type', () => {
    // A plain `ALLOWED[type]` lookup would resolve these off the prototype.
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        assert.equal(checkDeclared(bad, 1024).error, 'upload_type_not_allowed');
    }
});

test('media type matching is case and whitespace insensitive', () => {
    assert.equal(checkDeclared('  Image/PNG  ', 1024).contentType, 'image/png');
});

test('size is required and capped per type', () => {
    assert.equal(checkDeclared('image/png', 20 * 1024 * 1024).ok, true);
    assert.equal(checkDeclared('image/png', 20 * 1024 * 1024 + 1).error, 'upload_too_large');
    // Video gets a larger ceiling than an image, and an image may not borrow it.
    assert.equal(checkDeclared('video/mp4', 80 * 1024 * 1024).ok, true);
    assert.equal(checkDeclared('image/png', 80 * 1024 * 1024).error, 'upload_too_large');
    for (const bad of [0, -1, 1.5, NaN, '1024', null, undefined, Infinity]) {
        assert.equal(checkDeclared('image/png', bad).error, 'upload_size_required', `${bad} must be refused`);
    }
});

// ── keys ─────────────────────────────────────────────────────────────
test('the key is built only from server-controlled values', () => {
    const { key } = uploadKeyFor(AUTH, 'image/png', UUID);
    assert.equal(key, `uploads/${AUTH}/${UUID}.png`);
    assert.equal(uploadKeyFor(AUTH, 'video/mp4', UUID).key, `uploads/${AUTH}/${UUID}.mp4`);
});

test('a non-UUID auth id never reaches a storage key', () => {
    for (const bad of ['../../etc/passwd', 'a/b', '', 'not-a-uuid', `${AUTH}/x`, null, 42]) {
        assert.equal(uploadKeyFor(bad, 'image/png', UUID).error, 'auth_id_invalid', `${bad} must be refused`);
    }
});

test('ownership is decided by the key path, and only on an exact match', () => {
    const { key } = uploadKeyFor(AUTH, 'image/png', UUID);
    assert.equal(ownsUploadKey(AUTH, key), true);
    assert.equal(ownsUploadKey(OTHER, key), false);
    for (const forged of [
        `uploads/${OTHER}/${UUID}.png`,
        `uploads/${AUTH}/${UUID}.png/../../${OTHER}/x.png`,
        `uploads/${AUTH}/${UUID}.png?x=1`,
        `uploads/${AUTH}/../${OTHER}/${UUID}.png`,
        `results/${AUTH}/${UUID}.png`,
        `uploads/${AUTH}/${UUID}.exe`,
        `uploads/${AUTH}/${UUID}.png\n`,
        '', null,
    ]) {
        assert.equal(ownsUploadKey(AUTH, forged), false, `${forged} must not read as owned`);
    }
});

test('a key for one user is never owned by another, whatever the casing', () => {
    const { key } = uploadKeyFor(AUTH.toUpperCase(), 'image/png', UUID);
    assert.equal(ownsUploadKey(AUTH, key), true);
    assert.equal(ownsUploadKey(OTHER, key), false);
});

// ── gate 2: the bytes ────────────────────────────────────────────────
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = new Uint8Array([...b('RIFF'), 0x24, 0, 0, 0, ...b('WEBPVP8 ')]);
const MP4 = new Uint8Array([0, 0, 0, 0x20, ...b('ftypisom'), 0, 0, 2, 0]);
const HTML = new Uint8Array(b('<!DOCTYPE html><html>'));

function b(s) { return [...s].map((c) => c.charCodeAt(0)); }

test('known containers are identified from their leading bytes', () => {
    assert.equal(sniffType(JPEG), 'image/jpeg');
    assert.equal(sniffType(PNG), 'image/png');
    assert.equal(sniffType(WEBP), 'image/webp');
    assert.equal(sniffType(MP4), 'video/mp4');
});

test('anything unrecognised is refused rather than guessed at', () => {
    assert.equal(sniffType(HTML), null);
    assert.equal(sniffType(new Uint8Array(12)), null);
    assert.equal(sniffType(new Uint8Array([0xff, 0xd8])), null, 'too short to judge');
    assert.equal(sniffType(undefined), null);
    // 'RIFF' alone is a WAV or an AVI, not a WebP.
    assert.equal(sniffType(new Uint8Array([...b('RIFF'), 0, 0, 0, 0, ...b('WAVEfmt ')])), null);
});

test('a file that is not what it claims is rejected', () => {
    assert.equal(checkSniffed('image/png', PNG).ok, true);
    assert.equal(checkSniffed('image/png', HTML).error, 'upload_unreadable');
    assert.equal(checkSniffed('video/mp4', PNG).error, 'upload_type_mismatch');
    assert.equal(checkSniffed('image/png', MP4).error, 'upload_type_mismatch');
    assert.equal(checkSniffed('image/png', JPEG).error, 'upload_type_mismatch');
});

test('every allowlisted type can actually be recognised by gate 2', () => {
    // A type that gate 1 accepts but gate 2 can never confirm would be an
    // upload that always fails after a successful PUT.
    const samples = { 'image/jpeg': JPEG, 'image/png': PNG, 'image/webp': WEBP, 'video/mp4': MP4 };
    for (const type of Object.keys(ALLOWED_UPLOAD_TYPES)) {
        assert.ok(samples[type], `no gate-2 sample for ${type}`);
        assert.equal(checkSniffed(type, samples[type]).ok, true, `${type} must round-trip`);
    }
});
