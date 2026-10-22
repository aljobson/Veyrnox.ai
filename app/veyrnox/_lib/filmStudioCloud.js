import { accessibleStage, emptyFilm } from './filmStudio.js';
import { isUuid, validCloudLink, readFilm, MAX_FILM_BYTES } from './filmStudioStorage.js';

const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
function savedProject(row) {
  if (!row || !isUuid(row.id) || typeof row.name !== 'string' || !Number.isInteger(row.shot_count) || row.shot_count < 0 || row.shot_count > 200 || !Number.isSafeInteger(row.revision) || row.revision < 1 || !date(row.created_at) || !date(row.updated_at)) return null;
  const { id, name, shot_count, revision, created_at, updated_at } = row;
  return { id, name, shot_count, revision, created_at, updated_at };
}
export function parseSavedFilms(body) {
  if (!body || !Array.isArray(body.projects)) return null;
  const seen = new Set();
  return body.projects.map(savedProject).filter(row => row && !seen.has(row.id) && seen.add(row.id)).slice(0, 20);
}
export const openPath = id => isUuid(id) ? `/film-studio/${encodeURIComponent(id)}` : null;
export function saveRequest({ film, cloud, userId, sessionUserId }) {
  if (!userId || userId !== sessionUserId || (cloud && !validCloudLink(cloud, userId))) return null;
  const studio_json = JSON.stringify(film);
  if (new TextEncoder().encode(studio_json).length > MAX_FILM_BYTES) return null;
  return cloud ? { method: 'PUT', path: openPath(cloud.id), body: { expected_revision: cloud.revision, studio_json } }
    : { method: 'POST', path: '/film-studio', body: { studio_json } };
}
export function removeRequest(list, row, sessionUserId) {
  if (!sessionUserId || list?.userId !== sessionUserId || !savedProject(row)) return null;
  const selected = list.rows.find(item => item.id === row.id && item.revision === row.revision);
  return selected ? { method: 'DELETE', path: openPath(selected.id), body: { expected_revision: selected.revision } } : null;
}
export function replaceWorkspaceFilm(state, film, cloud = null) {
  return { film, stage: accessibleStage(film), cloud, error: null, saved: false, generation: state.generation + 1, pending: null };
}
export function sessionLoadPatch(storage, userId, prev, cloudEnabled = true) {
  const same = prev.ready && prev.userId === userId;
  if (same && cloudEnabled) return {};
  const loaded = readFilm(storage, userId);
  return { userId, film: loaded.film, error: loaded.error, saved: !!userId && !loaded.error, stage: accessibleStage(loaded.film), ready: true,
    ...(!same ? { cloud: userId ? loaded.cloud : null, generation: prev.generation + 1, pending: null } : {}) };
}
export function boundaryPatch(prev, userId) {
  return prev.userId === userId ? null : { userId, film: emptyFilm(), cloud: null, pending: null, ready: false, saved: false, error: null, stage: 0, generation: prev.generation + 1 };
}
export const pendingVisible = state => !!state.pending && state.pending.userId === state.userId && state.pending.generation === state.generation;
export const isNewerThanSaved = (film, cloud) => !cloud || cloud.savedText !== JSON.stringify(film);
export function acceptSaveResult(state, captured, project) {
  if (state.userId !== captured.userId || state.generation !== captured.generation || !savedProject(project)) return null;
  return { cloud: { userId: captured.userId, id: project.id, revision: project.revision, savedText: captured.text } };
}
export function mergeSavedProject(list, project, userId) {
  const row = savedProject(project);
  if (!row || list?.userId !== userId) return list;
  return { userId, rows: [row, ...list.rows.filter(item => item.id !== row.id)].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 20) };
}
export const unlinkPatch = (state, id) => state.cloud?.id === id ? { cloud: null } : null;
export const persistenceFailurePatch = () => ({ cloud: null, saved: false, error: 'app.film.workspace.saveFailed' });
export function parseCloudParam(search, rows) {
  const id = new URLSearchParams(search).get('cloud');
  return isUuid(id) ? rows.find(row => row.id === id) || null : null;
}
export function cloudErrorKey(err) {
  const code = String(err?.code || '').toLowerCase();
  if (code === 'limit_reached') return 'app.film.cloud.limit';
  if (code === 'conflict' && err?.status === 409) return 'app.film.cloud.conflict';
  if (code === 'not_found' && err?.status === 404) return 'app.film.cloud.removedElsewhere';
  if (code === 'rate_limited' || err?.status === 429) return 'app.film.cloud.rateLimited';
  return 'app.film.cloud.failed';
}
export function saveFailureKeys(state, err) {
  return [cloudErrorKey(err), ...(!state.saved || state.error ? ['app.film.cloud.exportFirst'] : [])];
}
