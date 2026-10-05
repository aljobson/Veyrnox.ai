// ADR-0067: Chat models stay out of the public media catalog, and Chat ships closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPublicCatalog } from '../lib/publicCatalog.js';

test('the public catalog read excludes text models', async () => {
    let seen;
    const selectRows = async (table, q) => { seen = { table, q }; return []; };
    await readPublicCatalog({ cfg: { supabaseUrl: 'https://x.test', serviceRoleKey: 'k' }, selectRows });
    assert.equal(seen.table, 'model_catalog');
    assert.match(seen.q.filter, /(^|&)modality=neq\.text(&|$)/);
    assert.match(seen.q.filter, /(^|&)active=eq\.true(&|$)/);
});

// Open to every signed-in user (ADR-0067 amendment 4). CHAT_ENABLED is the one control: there is no per-browser switch any more,
// so turning the flag off closes chat for everyone and the page then says so (chat_not_open) instead of a dead tab.
test('chat is switched on in production and nothing else gates it per browser', () => {
    const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const vars = text.slice(text.indexOf('"vars"'));
    const production = vars.slice(0, vars.indexOf('"env"') > 0 ? vars.indexOf('"env"') : undefined);
    assert.match(production, /"CHAT_ENABLED":\s*"true"/);
    for (const f of ['app/veyrnox/app/chat/page.js', 'app/veyrnox/_components/NavBar.js']) {
        const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
        assert.doesNotMatch(src, /useChatPreview|localStorage\.veyrnox_chat|veyrnox_chat['"]/, `${f} has no per-browser chat switch`);
    }
    assert.throws(() => readFileSync(new URL('../app/veyrnox/_lib/useChatPreview.js', import.meta.url)), /ENOENT/, 'the switch hook is gone');
    const nav = readFileSync(new URL('../app/veyrnox/_components/NavBar.js', import.meta.url), 'utf8');
    assert.match(nav, /key: 'chat', href: '\/app\/chat', label: 'Chat'/, 'Chat is a normal tab');
    const api = readFileSync(new URL('../app/veyrnox/_lib/chatApi.js', import.meta.url), 'utf8');
    assert.match(api, /chat_not_open/, 'a closed flag still reads as "not open yet", not an error');
});

// The route, the turn runner and the catalog rows must agree on the provider name. They once did not:
// rows staged as 'openrouter' made /api/v1/chat/models return an empty list on staging, and the unit
// tests could not see it because they mock the database.
test('chat route, turn runner and chat-model migrations all use one provider name', async () => {
    const { readdirSync } = await import('node:fs');
    const root = new URL('..', import.meta.url);
    const turn = readFileSync(new URL('lib/chatTurn.js', root), 'utf8');
    const provider = (turn.match(/const PROVIDER = '([^']+)'/) || [])[1];
    assert.equal(provider, 'openrouter-chat');
    const route = readFileSync(new URL('app/api/v1/chat/models/route.js', root), 'utf8');
    assert.ok(route.includes(`provider=eq.${provider}`), 'the models route filters on the chat provider');
    const dir = new URL('packages/db/schema/supabase/', root);
    const files = readdirSync(dir).filter((f) => /^\d{4}_chat_models.*\.sql$/.test(f));
    assert.ok(files.length >= 1);
    for (const f of files) {
        const sql = readFileSync(new URL(f, dir), 'utf8').replace(/--.*$/gm, '');
        assert.ok(sql.includes(`'${provider}'`), `${f} names provider ${provider}`);
        assert.doesNotMatch(sql, /'openrouter'(?!-)/, `${f} must not use the video provider name`);
    }
});
