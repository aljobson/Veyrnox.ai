import test from 'node:test';
import assert from 'node:assert/strict';
import { withFilmStackDefaults } from '../app/veyrnox/_lib/authenticatedMedia.js';
import { emptyFilm, stageIssues } from '../app/veyrnox/_lib/filmStudio.js';

const models = [
  { id: 'img-a', kind: 'image', name: 'Img A' },
  { id: 'vid-gated', kind: 'video', gated: true, durations: [10] },
  { id: 'vid-short', kind: 'video', durations: [5] },
  { id: 'vid-a', kind: 'video', durations: [10, 15], aspects: ['16:9', '9:16'] },
];

test('empty Studio stack gets the first eligible models, so setup is complete', () => {
  const film = withFilmStackDefaults(emptyFilm(), models);
  assert.equal(film.stack.image, 'img-a');
  assert.equal(film.stack.video, 'vid-a');
  assert.deepEqual(stageIssues(film, 0), []);
});

test('a chosen model and an External workflow are left alone, and no change returns the same film', () => {
  const chosen = { ...emptyFilm(), stack: { ...emptyFilm().stack, image: 'mine', imageAccess: 'External', video: 'vid-a' } };
  assert.equal(withFilmStackDefaults(chosen, models), chosen);
});

test('no eligible models leaves the film untouched', () => {
  const film = emptyFilm();
  assert.equal(withFilmStackDefaults(film, []), film);
});
