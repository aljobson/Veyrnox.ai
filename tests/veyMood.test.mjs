import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VEY_MOODS, VEY_SITUATIONS, veyMoodFor, veyErrorSituation, isVeyMood } from '../lib/veyMood.js';

const root = new URL('../', import.meta.url);

test('every situation maps to one of the nine moods and each mood is used once', () => {
  assert.equal(VEY_MOODS.length, 9);
  const used = VEY_SITUATIONS.map(veyMoodFor);
  assert.ok(used.every(isVeyMood));
  assert.deepEqual([...new Set(used)].sort(), [...VEY_MOODS].sort());
  assert.equal(veyMoodFor('nonsense'), null);
});

test('Create errors pick the right situation', () => {
  assert.equal(veyErrorSituation('insufficient_balance'), 'out-of-credits');
  assert.equal(veyErrorSituation('provider_moderation'), 'prompt-blocked');
  assert.equal(veyErrorSituation('provider_submit_failed'), 'generation-failed');
  assert.equal(veyErrorSituation('whatever', { refunded: true }), 'generation-failed');
  assert.equal(veyErrorSituation('inputs_invalid_prompt'), null);
  assert.equal(veyErrorSituation(undefined), null);
});

test('VeyCharacter draws a face and prop for every mood', async () => {
  const faces = await readFile(new URL('app/veyrnox/_components/VeyFace.jsx', root), 'utf8');
  const character = await readFile(new URL('app/veyrnox/_components/VeyCharacter.jsx', root), 'utf8');
  for (const mood of VEY_MOODS) assert.match(faces, new RegExp(`\\n  ${mood}: \\{`), `missing face ${mood}`);
  assert.match(character, /mood = null/);
  assert.match(character, /<VeyMoodProp mood=\{mood\}/);
});

test('the helper listens for mood signals and goes sleepy offline', async () => {
  const source = await readFile(new URL('app/veyrnox/_components/MascotAssistant.jsx', root), 'utf8');
  assert.match(source, /VEY_MOOD_EVENT/);
  assert.match(source, /offline \? 'sleepy'/);
});

test('each mood moves the arms, but never interrupts walking or pointing', async () => {
  const { VEY_MOOD_POSE, veyPoseFor } = await import('../lib/veyMood.js');
  assert.deepEqual(Object.keys(VEY_MOOD_POSE).sort(), [...VEY_MOODS].sort());
  assert.equal(veyPoseFor('idle', 'welcome'), 'wave');
  assert.equal(veyPoseFor('listening', 'sleepy'), 'droop');
  assert.equal(veyPoseFor('walking', 'happy'), 'walking');
  assert.equal(veyPoseFor('guiding', 'firm'), 'guiding');
  assert.equal(veyPoseFor('idle', null), 'idle');
});

test('job results and refused submits drive Vey from one shared place each', async () => {
  const history = await readFile(new URL('app/veyrnox/_lib/jobHistory.js', root), 'utf8');
  assert.match(history, /signalVeyMood\('generation-succeeded'\)/);
  assert.match(history, /markJobSettled\(job_id, state, errorCode, credits, refunded = false\)/);
  for (const file of ['app/veyrnox/_components/JobWatcher.js', 'app/veyrnox/_lib/useStudioJobs.js']) {
    assert.match(await readFile(new URL(file, root), 'utf8'), /\.error_code, next\.credits, next\.refunded\)/, `${file} passes the error code`);
  }
  for (const file of ['app/veyrnox/app/create/page.js', 'app/veyrnox/app/text-to-speech/TextToSpeechStudioClient.js', 'app/veyrnox/app/dialogue/DialogueStudioClient.js', 'app/veyrnox/app/performance/PerformanceStudioClient.js', 'app/veyrnox/app/video-agent/page.js', 'app/veyrnox/_components/TemplateGenerate.js']) {
    assert.match(await readFile(new URL(file, root), 'utf8'), /veyErrorSituation|useVeyErrorMood\(error\?\.code\)/, `${file} reports its errors to Vey`);
  }
});
