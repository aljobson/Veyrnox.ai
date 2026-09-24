import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// "Claim 50 credits" is a sign-up CTA. Linking to bare /app opened the auth
// modal from the gateway's 401 with no mode, which defaults to sign-in: new
// users typed a new password into the sign-in form and got "don't match".
for (const file of ['hero.js', 'footer.js']) {
    test(`${file}: Claim 50 credits opens the sign-up form`, () => {
        const src = readFileSync(new URL(`../app/veyrnox/_sections/${file}`, import.meta.url), 'utf8');
        const i = src.indexOf('Claim 50 credits');
        assert.ok(i > 0, 'CTA not found');
        const tag = src.slice(src.lastIndexOf('<Link', i), i);
        assert.match(tag, /href="\/app\?auth=sign_up"/);
    });
}
