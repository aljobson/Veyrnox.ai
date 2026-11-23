import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function select(file, predicate) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX), found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(ast); return { ast, found };
}
const evaluate = (text, context) => new Function('context', `with(context) { return (${text}); }`)(context);

test('TemplateGenerate forwards idempotent and only its own uncertain submission evidence', () => {
  const { ast, found } = select('app/veyrnox/_lib/useTemplateGenerate.js', n => ts.isPropertyAssignment(n) && n.name.getText() === 'onJob');
  const recorded = [], run = { unknown: new Set() };
  const callback = evaluate(found[0].initializer.getText(ast), {
    run, model: { id: 'm' }, presentation: {}, prompt: 'p', startJobs() {}, setBalance() {}, pushJobHistory: entry => recorded.push(entry),
  });
  callback({ job_id: 'old', idempotent: true }, 5);
  run.unknown.add(0); callback({ job_id: 'own', idempotent: true }, 5);
  assert.deepEqual(recorded.map(({ idempotent, recovering }) => ({ idempotent, recovering })), [
    { idempotent: true, recovering: false }, { idempotent: true, recovering: true },
  ]);
});

test('Video Agent marks only a retry of its own approved POST as recovery', async () => {
  const { ast, found } = select('app/veyrnox/app/video-agent/page.js', n => ts.isFunctionDeclaration(n) && n.name?.text === 'onApprove');
  const recorded = [], posts = []; let fail = true;
  const context = { inFlight: { current: false }, approvalAttempt: { current: null }, plan: { plan_id: 'p', idempotency_key: 'k', draftVersion: 0, brief: 'Film', aspect: '9:16', credits: 4 },
    expired: false, cannotAfford: false, stalePlan: false, narration: { ok: true }, draftVersion: { current: 0 }, MODEL_ID: 'video-agent',
    setBusy() {}, setApproving() {}, setError() {}, setPlan() {}, startJobs() {}, setBalance() {}, notifyBalanceChanged() {}, errorFor: e => e,
    pushJobHistory: entry => recorded.push(entry), gatewayFetch: async (_path, init) => {
      posts.push(JSON.parse(init.body)); if (fail) { fail = false; throw Error('lost response'); } return { job_id: 'j', idempotent: true };
    },
  };
  const approve = evaluate(found[0].getText(ast), context);
  await approve(); await approve();
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(recorded[0].idempotent, true); assert.equal(recorded[0].recovering, true);
  context.approvalAttempt.current = null;
  await approve(); assert.equal(recorded[1].recovering, false, 'first response has no local retry evidence');
});

test('every Performance history write forwards the attempt helper recovery and server replay flags', () => {
  const { ast, found } = select('app/veyrnox/app/performance/PerformanceStudioClient.js', n => ts.isCallExpression(n) && n.expression.getText() === 'pushJobHistory');
  assert.equal(found.length, 9);
  for (const call of found) {
    const fields = call.arguments[0].properties.filter(p => ['idempotent', 'recovering'].includes(p.name?.getText()));
    assert.equal(fields.length, 2);
    for (const recovering of [true, undefined]) {
      const actual = evaluate(`({${fields.map(p => p.getText(ast)).join(',')}})`, { submitted: { idempotent: true, recovering } });
      assert.deepEqual(actual, { idempotent: true, recovering });
    }
  }
});

test('EditSheet forwards server idempotent through its Library callback and Library preserves it', () => {
  const { ast, found } = select('app/veyrnox/_components/EditSheet.js', n => ts.isCallExpression(n) && n.expression.getText() === 'onSubmitted');
  const outgoing = evaluate(found[0].arguments[0].getText(ast), { r: { job_id: 'old-edit', idempotent: true, balance_after: 10 }, cost: 5,
    t: () => 'Edit', pluralKey: () => '', locale: 'en', items: [], number: String });
  const library = select('app/veyrnox/app/library/page.js', n => ts.isFunctionDeclaration(n) && n.name?.text === 'onEditSubmitted');
  const recorded = [];
  const receive = evaluate(library.found[0].getText(library.ast), { pushJobHistory: entry => recorded.push(entry), setRows() {}, setBalance() {}, notifyBalanceChanged() {}, setSelected() {}, setEditing() {} });
  receive(outgoing);
  assert.equal(outgoing.idempotent, true); assert.equal(recorded[0].idempotent, true);
});
