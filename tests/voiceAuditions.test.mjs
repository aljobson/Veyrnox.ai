import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_AUDITION_VOICES,
  MIN_AUDITION_VOICES,
  auditionBatchNote,
  auditionCost,
  normalizeAuditionVoices,
  toggleAuditionVoice,
} from '../app/veyrnox/_lib/voiceAuditions.js';

test('Audition Board keeps two or three distinct known stock voices', () => {
  assert.equal(MIN_AUDITION_VOICES, 2);
  assert.equal(MAX_AUDITION_VOICES, 3);
  assert.deepEqual(normalizeAuditionVoices(['Calm_Woman', 'Calm_Woman', 'not-a-voice', 'Wise_Woman']), ['Calm_Woman', 'Wise_Woman']);
  let voices = [];
  for (const id of ['Calm_Woman', 'Wise_Woman', 'Patient_Man', 'Lively_Girl']) voices = toggleAuditionVoice(voices, id);
  assert.deepEqual(voices, ['Calm_Woman', 'Wise_Woman', 'Patient_Man']);
  assert.deepEqual(toggleAuditionVoice(voices, 'Wise_Woman'), ['Calm_Woman', 'Patient_Man']);
});

test('Audition Board quotes one catalog unit per voice', () => {
  assert.equal(auditionCost(7, ['Calm_Woman', 'Wise_Woman']), 14);
  assert.equal(auditionCost(7, ['Calm_Woman', 'Wise_Woman', 'Patient_Man']), 21);
  assert.equal(auditionCost(-1, ['Calm_Woman', 'Wise_Woman']), 0);
});

test('partial audition submission copy is exact without making charge claims', () => {
  const voices = ['Calm_Woman', 'Wise_Woman', 'Patient_Man'];
  assert.equal(auditionBatchNote(1, voices), '1 of 3 auditions started; voice 2 did not.');
  assert.equal(auditionBatchNote(1, voices, true), '1 of 3 auditions started; voice 2 may have too — check Library.');
  assert.doesNotMatch(auditionBatchNote(1, voices, true), /charged/i);
});

test('the voice library exposes an accessible capped board control', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/TextToSpeechControls.js', import.meta.url), 'utf8');
  assert.match(source, /Audition Board/);
  assert.match(source, /Add \$\{voice\.label\} to Audition Board/);
  assert.match(source, /Every board voice reads the exact current script/);
});
