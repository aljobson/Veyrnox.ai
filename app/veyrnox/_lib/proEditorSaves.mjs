// Save candidates for the Pro editor (ADR-0358). The upstream editor reports every save as a
// plain {name, bytes, saveAs}: Save, Save a Copy and the old-schema upgrade backup cannot be told
// apart, and arrival order proves nothing. So every project payload is kept as an immutable
// candidate, and the project's current version changes only when the person picks one.
//
// Storage is injected (`persist`, `commitHead`): this module holds the state machine, the leave
// guard and the selection rules, and is tested with fakes. It stores nothing itself.

export const CURRENT_SCHEMA = 17; // FilmCraft 0.20.1 (pro-editor/pins.json)
export const EXPORT_LIBRARY_MAX_BYTES = 25 * 1024 * 1024; // lib/editorRenderApi.js cap
export const PROJECT_MAX_BYTES = 32 * 1024 * 1024; // bounded parse: a project file is JSON, ~1.4 MB for 2,000 clips

/** Library only for what the existing Library path can take (H.264 MP4 within its upload cap). */
export function classifyExport({ name, byteLength }) {
    const isMp4 = /\.mp4$/i.test(name);
    if (isMp4 && byteLength <= EXPORT_LIBRARY_MAX_BYTES) return { route: 'library-candidate', reason: 'mp4-within-cap' };
    return { route: 'download', reason: isMp4 ? 'over-library-cap' : 'not-a-library-format' };
}

/**
 * Bounded, real validation (not header sniffing): UTF-8, JSON, the FilmCraft envelope, an integer
 * schema version and an object `project`. Returns { ok, schemaVersion, content } where `content`
 * is the serialized `project` field (the identity of the edit, independent of envelope metadata,
 * view state and whitespace). The eventual storage API must validate again.
 */
export function validateProjectBytes(bytes) {
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > PROJECT_MAX_BYTES) return { ok: false, reason: 'size' };
    let doc;
    try {
        doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return { ok: false, reason: 'not-json' };
    }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, reason: 'shape' };
    if (doc.format !== 'filmcraft.project') return { ok: false, reason: 'format' };
    if (!Number.isSafeInteger(doc.schema_version) || doc.schema_version < 1 || doc.schema_version > 10000) return { ok: false, reason: 'schema' };
    if (doc.project === null || typeof doc.project !== 'object' || Array.isArray(doc.project)) return { ok: false, reason: 'project' };
    return { ok: true, schemaVersion: doc.schema_version, content: JSON.stringify(doc.project) };
}

/**
 * deps: persist(candidate) -> Promise<{assetId}> (stores the bytes; rejects on failure),
 *       commitHead(candidate, expectedRevision) -> Promise<{revision}> (rejects with
 *       error.code 'revision-conflict' on a stale head), sha256(bytes) -> Promise<hex>,
 *       now(), onChange(snapshot)
 */
export function createSaveTracker(deps) {
    const candidates = [];
    const exportsUndelivered = new Set();
    const state = { editorDirty: false, headContent: null, headRevision: null, nextId: 1, chain: Promise.resolve(), pendingHead: null, disposed: false };

    const snapshot = () => ({
        editorDirty: state.editorDirty,
        candidates: candidates.map((c) => { const rest = { ...c }; delete rest.bytes; delete rest.content; return { ...rest, hasBytes: c.bytes !== null }; }),
        exportsUndelivered: [...exportsUndelivered],
        pendingHead: state.pendingHead && { ...state.pendingHead },
        canLeave: canLeave(),
    });
    // After dispose() nothing is reported: a retired session must not update the UI or the head.
    const changed = () => { if (state.disposed) return; try { deps.onChange?.(snapshot()); } catch { /* UI listener only */ } };

    function canLeave() {
        const uncommitted = candidates.some((c) => c.kind === 'project' && c.state !== 'committed');
        return !state.editorDirty && !uncommitted && exportsUndelivered.size === 0 && state.pendingHead === null;
    }

    const find = (id) => candidates.find((c) => c.id === id);

    // The payload is registered synchronously (so the leave guard and idle() already know about
    // it) and processed strictly in receive order, whatever order hashing finishes in.
    function process(candidate) {
        state.chain = state.chain.then(async () => {
            if (state.disposed) return;
            candidate.state = 'hashing';
            candidate.error = undefined;
            changed();
            try {
                candidate.sha256 = await deps.sha256(candidate.bytes);
                if (state.disposed) return; // fence: no validation or write for a retired session
                const checked = validateProjectBytes(candidate.bytes);
                if (!checked.ok) {
                    candidate.valid = false;
                    candidate.state = 'failed';
                    candidate.error = 'not a valid FilmCraft project (' + checked.reason + ')';
                    changed();
                    return;
                }
                candidate.valid = true;
                candidate.schemaVersion = checked.schemaVersion;
                candidate.content = await deps.sha256(new TextEncoder().encode(checked.content));
                if (state.disposed) return;
                candidate.backup = checked.schemaVersion < CURRENT_SCHEMA;
                candidate.newer = checked.schemaVersion > CURRENT_SCHEMA;
                candidate.state = 'uploading';
                changed();
                const stored = await deps.persist(candidate);
                if (state.disposed) return;
                candidate.asset = stored && stored.assetId ? stored.assetId : null;
                candidate.state = 'committed';
                candidate.bytes = null; // durable now: keep the reference, not the buffer
            } catch (error) {
                if (state.disposed) return;
                candidate.state = 'failed';
                candidate.error = String(error && error.message || error).slice(0, 200);
            }
            changed();
        });
        return state.chain;
    }

    return {
        setEditorDirty(dirty) { if (state.disposed) return; state.editorDirty = dirty === true; changed(); },

        /** A parsed host:save message (bytes still attached). Returns the candidate id. */
        async receive(msg) {
            if (state.disposed) return null;
            const kind = /\.fcproj$/i.test(msg.name) ? 'project' : 'export';
            const id = 'c' + state.nextId++;
            const base = {
                id, kind, name: msg.name, saveAs: msg.saveAs === true, seq: msg.seq, engine: msg.engine, sessionId: msg.sessionId,
                bytes: msg.bytes, byteLength: msg.bytes.byteLength, receivedAt: deps.now(), sha256: null,
            };
            if (kind === 'export') {
                exportsUndelivered.add(id);
                candidates.push({ ...base, state: 'received', ...classifyExport({ name: msg.name, byteLength: msg.bytes.byteLength }) });
                changed();
                return id;
            }
            candidates.push({ ...base, state: 'pending', valid: null, schemaVersion: null, backup: false, newer: false, content: null, asset: null });
            changed();
            process(find(id));
            return id;
        },

        async retry(id) {
            const candidate = find(id);
            if (state.disposed || !candidate || candidate.kind !== 'project' || candidate.state !== 'failed' || candidate.bytes === null || candidate.valid === false) return false;
            candidate.state = 'pending';
            changed();
            await process(candidate);
            return candidate.state === 'committed';
        },

        /** The bytes of an undelivered export (null once released). */
        exportBytes(id) {
            const c = find(id);
            return c && c.kind === 'export' ? c.bytes : null;
        },
        /** The person received the file: it is no longer ours to guard, and its buffer is released. */
        markExportDelivered(id) {
            if (state.disposed) return;
            exportsUndelivered.delete(id);
            const c = find(id);
            if (c && c.kind === 'export') c.bytes = null;
            changed();
        },

        /**
         * What the UI should preselect: the newest committed project of exactly the current
         * schema whose edit content differs from the head. Only a suggestion.
         */
        suggestedHead() {
            const eligible = candidates.filter((c) => c.kind === 'project' && c.state === 'committed' && c.schemaVersion === CURRENT_SCHEMA && c.content !== state.headContent);
            return eligible.length ? eligible[eligible.length - 1].id : null;
        },

        /** The person's explicit choice. Tracked as pending work until it succeeds or is abandoned. */
        async promote(id) {
            const candidate = find(id);
            if (state.disposed) return { ok: false, reason: 'disposed' };
            if (!candidate || candidate.kind !== 'project' || candidate.state !== 'committed') return { ok: false, reason: 'not-promotable' };
            if (state.pendingHead && state.pendingHead.state === 'committing') return { ok: false, reason: 'busy' };
            state.pendingHead = { id, state: 'committing', reason: null };
            changed();
            const run = (async () => {
                try {
                    const result = await deps.commitHead(candidate, state.headRevision);
                    if (state.disposed) return { ok: false, reason: 'disposed' };
                    state.headContent = candidate.content;
                    state.headRevision = result.revision;
                    state.pendingHead = null;
                    changed();
                    return { ok: true, revision: result.revision };
                } catch (error) {
                    if (state.disposed) return { ok: false, reason: 'disposed' };
                    const reason = error && error.code === 'revision-conflict' ? 'revision-conflict' : 'commit-failed';
                    state.pendingHead = { id, state: 'failed', reason };
                    changed();
                    return { ok: false, reason };
                }
            })();
            state.chain = state.chain.then(() => run);
            return run;
        },
        /** Retry the failed promotion, or drop it (the person gives up on changing the head). */
        retryHead() { return state.pendingHead && state.pendingHead.state === 'failed' ? this.promote(state.pendingHead.id) : Promise.resolve({ ok: false, reason: 'nothing-to-retry' }); },
        abandonHead() { if (state.pendingHead && state.pendingHead.state === 'failed') { state.pendingHead = null; changed(); } },

        /** Adopt a head that already exists (project open): the edit content fingerprint and revision. */
        setHead(content, revision) { state.headContent = content; state.headRevision = revision; changed(); },

        /** Session teardown: release every buffer and forget pending work. */
        dispose() {
            state.disposed = true;
            for (const c of candidates) c.bytes = null;
            exportsUndelivered.clear();
            state.pendingHead = null;
        },
        snapshot,
        canLeave,
        idle() { return state.chain; },
    };
}
