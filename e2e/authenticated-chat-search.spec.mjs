// Synthetic critical flow: real local Chat UI and real turn/search orchestration;
// database, model output and MCP HTTP are scripted. No provider or database writes.
import { test, expect, installProductFixtures, SYNTHETIC_USER } from './fixtures/authenticated-product.mjs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const THREAD = '00000000-0000-4000-8000-000000000067';
const JOB = '00000000-0000-4000-8000-000000000068';
const QUESTION = 'Which release is current in this synthetic example?';
const ANSWER = 'The synthetic release is version 22.';
const SOURCE = 'https://example.com/synthetic-release';
const MODEL = {
  id: 'synthetic-capped-chat', name: 'Synthetic capped chat', provider: 'openrouter-chat',
  provider_endpoint: 'synthetic/exact-model', modality: 'text', active: true,
  credits_5s: 2, chat_web_engine: 'capped', chat_web_extra_credits: 1,
};

const runtimePath = fileURLToPath(new URL('./fixtures/chat-search-runtime.mjs', import.meta.url));
function runtime(input) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [runtimePath], {
      env: { PATH: process.env.PATH }, timeout: 10000, maxBuffer: 512000,
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`Synthetic runtime failed: ${error.message} ${stderr}`));
      try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function installChat(page, { provider, limited = false } = {}) {
  // Deliberately omit EXA_API_KEY and every unrelated feature/credential flag.
  const env = { OPENROUTER_API_KEY: 'synthetic-model-key', ...(provider ? { CHAT_SEARCH_PROVIDER: provider } : {}) };
  const state = { thread: null, messages: [], calls: [], modelCalls: [], mcp: [], submitted: [], reads: 0, balance: 1000 };
  const input = { env, model: MODEL, authId: SYNTHETIC_USER.id, threadId: THREAD, jobId: JOB, limited, answer: ANSWER, source: SOURCE };
  const offer = await runtime(input);
  state.userAgent = offer.userAgent;
  const fixture = await installProductFixtures(page, { routes: async ({ url, origin, method, body, json, route }) => {
    if (url.origin !== origin) return false;
    if (method === 'GET' && url.pathname === '/api/v1/chat/models') return json({
      models: [{ id: MODEL.id, name: MODEL.name, maker: 'other', maker_label: 'Other', credits_per_reply: MODEL.credits_5s,
        max_reply_tokens: 1024, gated: false, options: offer.options }],
      max_reply_tokens: 1024, max_attachments: 4, max_image_edge: 2048,
    });
    if (url.pathname === '/api/v1/chat/threads') {
      if (method === 'GET') return json({ threads: state.thread ? [state.thread] : [] });
      if (method === 'POST') {
        if (body.model_id !== MODEL.id) throw new Error('Synthetic chat only accepts its scripted model');
        state.thread = { id: THREAD, model_id: MODEL.id, title: 'Synthetic search conversation', system_prompt: '', pinned: false, folder_id: null };
        return json({ thread: state.thread });
      }
    }
    if (url.pathname === `/api/v1/chat/threads/${THREAD}`) {
      if (method === 'GET') { state.reads++; return json({ thread: state.thread, messages: state.messages }); }
      if (method === 'DELETE') { state.thread = null; return json({ ok: true }); }
    }
    if (url.pathname === `/api/v1/chat/threads/${THREAD}/messages` && method === 'POST') {
      state.submitted.push(body);
      const result = await runtime({ ...input, body });
      Object.assign(state, result.state);
      await route.fulfill({ status: result.status, headers: result.headers, body: result.body });
      return true;
    }
    return false;
  } });
  return { fixture, state };
}

async function openChat(fixture, page) {
  expect((await fixture.open('/app/chat')).status()).toBe(200);
  await expect(page.getByRole('combobox', { name: 'Model for next reply', exact: true })).toHaveValue(MODEL.id);
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
}
async function sendQuestion(page, price) {
  await page.getByLabel('Message', { exact: true }).fill(QUESTION);
  await page.getByRole('button', { name: `Send · ${price} Credits`, exact: true }).click();
}
async function reopenStoredChat(page) {
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Model for next reply', exact: true })).toHaveValue(MODEL.id);
  const drawer = page.getByRole('button', { name: 'Chats', exact: true });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByRole('button', { name: 'Synthetic search conversation', exact: true }).click({ position: { x: 20, y: 12 } });
}

test('synthetic no-key Web search reaches the real MCP dispatcher and persists safe sources in Chat', async ({ page }) => {
  const { fixture, state } = await installChat(page);
  await openChat(fixture, page);
  const web = page.getByRole('button', { name: /Web \+1/ });
  await expect(web).toHaveAttribute('aria-pressed', 'false');
  await web.click();
  await expect(web).toHaveAttribute('aria-pressed', 'true');
  await sendQuestion(page, 3);
  const reply = page.getByRole('article', { name: 'Assistant', exact: true });
  await expect(reply).toContainText(ANSWER);
  await expect(reply.getByRole('link', { name: 'Synthetic release source', exact: true })).toHaveAttribute('href', SOURCE);
  await expect(reply).not.toContainText('Unsafe source');
  await expect(page.getByRole('button', { name: 'Copy reply', exact: true })).toBeVisible();
  expect(state.submitted).toHaveLength(1);
  expect(state.submitted[0].options.web).toBe(true);
  expect(state.mcp.map(row => row.request.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  expect(state.mcp.every(row => row.userAgent === state.userAgent)).toBe(true);
  expect(state.mcp.at(-1).request.params.arguments).toMatchObject({ session_id: THREAD, model_name: MODEL.provider_endpoint });
  expect(state.modelCalls).toHaveLength(1);
  expect(state.modelCalls[0].webSearch).toBe(false);
  expect(JSON.stringify(state.modelCalls[0].messages)).toContain('The current synthetic release is version 22.');
  expect(JSON.stringify(state.modelCalls[0].messages)).not.toContain('javascript:');
  expect(state.calls.filter(row => row.name === 'ledger_debit')).toHaveLength(1);
  expect(state.calls.filter(row => row.name === 'chat_complete_turn')).toHaveLength(1);
  expect(state.messages[1].content).toContain(SOURCE);
  expect(state.balance).toBe(997);
  await reopenStoredChat(page);
  await expect(page.getByRole('article', { name: 'Assistant', exact: true }).getByRole('link', { name: 'Synthetic release source', exact: true })).toHaveAttribute('href', SOURCE);
  expect(state.reads).toBeGreaterThan(1);
});

test('synthetic explicit off hides capped Web search and a plain Chat reply makes no MCP request', async ({ page }) => {
  const { fixture, state } = await installChat(page, { provider: 'off' });
  await openChat(fixture, page);
  await expect(page.getByRole('button', { name: /Web \+1/ })).toHaveCount(0);
  await sendQuestion(page, 2);
  await expect(page.getByRole('article', { name: 'Assistant', exact: true })).toContainText(ANSWER);
  await expect(page.getByRole('button', { name: 'Copy reply', exact: true })).toBeVisible();
  expect(state.submitted[0].options.web).toBe(false);
  expect(state.mcp).toHaveLength(0);
  expect(state.calls.filter(row => row.name === 'ledger_debit')).toHaveLength(1);
  expect(state.balance).toBe(998);
});

test('synthetic anonymous quota refusal shows the existing no-charge Web warning', async ({ page }) => {
  const { fixture, state } = await installChat(page, { limited: true });
  await openChat(fixture, page);
  await page.getByRole('button', { name: /Web \+1/ }).click();
  await sendQuestion(page, 3);
  await expect(page.getByRole('alert').filter({ hasText: 'Web search is busy.' })).toContainText('Web search is busy. Try again in a moment. No Credits were used.');
  expect(state.mcp).toHaveLength(1);
  expect(state.modelCalls).toHaveLength(0);
  expect(state.calls.filter(row => row.name === 'ledger_debit')).toHaveLength(0);
  expect(state.messages).toHaveLength(0);
  expect(state.balance).toBe(1000);
});
