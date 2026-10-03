// Library filters (app/library): by job state, and by what was made.

export const STATE_TABS = ['all', 'succeeded', 'running', 'queued', 'failed'];
export const KIND_TABS = ['all', 'image', 'video', 'audio'];
export const KIND_LABEL = { all: 'All types', image: 'Images', video: 'Video', audio: 'Audio' };
export const VIEW_KEY = 'veyrnox_library_view';
export const VIEWS = ['grid', 'list'];

/**
 * What a row made: the file's own type once it is known, otherwise the kind
 * of the model that ran it (catalog), so queued and failed jobs filter too.
 * @returns {'image'|'video'|'audio'|null}
 */
export function kindOfRow(row, models) {
  const mime = String(row?.mime_type || '');
  for (const kind of ['image', 'video', 'audio']) if (mime.startsWith(`${kind}/`)) return kind;
  const model = Array.isArray(models) ? models.find((m) => m.id === row?.model_id) : null;
  return model?.kind || null;
}

/** Rows matching both filters; 'all' matches everything, unknown kinds only match 'all'. */
export function filterRows(rows, { state = 'all', kind = 'all' }, models) {
  return rows.filter((r) => (state === 'all' || r.state === state) && (kind === 'all' || kindOfRow(r, models) === kind));
}

/** The saved layout, or 'grid' when storage is blocked or holds anything else. */
export function readView(storage) {
  try {
    const v = storage.getItem(VIEW_KEY);
    return VIEWS.includes(v) ? v : 'grid';
  } catch {
    return 'grid';
  }
}
