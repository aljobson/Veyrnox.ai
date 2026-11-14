import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// A private Music audio_url is /api/v1/jobs/:id/asset: a Bearer-only route that
// answers JSON. Used directly as an <audio> src it answered 401, so no private song
// played on the song page, in the Library or in the Crop and Render dialogs (staging,
// 2026-11-14). Every Music player now asks the route for the signed URL first.

const src = readFileSync(new URL('../app/veyrnox/_lib/useMusicAudioSrc.jsx', import.meta.url), 'utf8');
const pattern = new RegExp(src.match(/const PRIVATE_ASSET = \/(.+)\/i;/)[1], 'i');
const path = (url) => { const m = pattern.exec(url); return m ? m[1] : null; };
const JOB = '123e4567-e89b-42d3-a456-426614174000';

test('a private job asset url is signed through the gateway path', () => {
    assert.equal(path(`/api/v1/jobs/${JOB}/asset`), `/jobs/${JOB}/asset`);
});

test('anything else is left to play as it is', () => {
    for (const url of [`https://bucket.r2.example/${JOB}.wav`, `/api/music/shared/abc/asset`, `/api/v1/jobs/${JOB}/asset?download=1`, `/api/v1/jobs/../asset`]) {
        assert.equal(path(url), null, url);
    }
});

test('no Music component hands audio_url straight to an <audio> element', () => {
    const dir = new URL('../app/veyrnox/_components/music/', import.meta.url);
    for (const name of readdirSync(dir)) {
        if (!name.endsWith('.jsx')) continue;
        const code = readFileSync(new URL(name, dir), 'utf8');
        assert.doesNotMatch(code, /<audio\b[^]*?src=\{[\w.?]*audio_url\}/, name);
    }
});
