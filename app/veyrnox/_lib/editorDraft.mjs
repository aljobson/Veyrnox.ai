import { validateSequence } from './editorSequenceValidation.mjs';

const PREFIX = 'veyrnox-editor-draft-v1';
const SAFE_SCOPE = /^[A-Za-z0-9_-]{1,80}$/;

function identity(actor, scope) {
    const owner = actor || 'guest';
    const place = scope || 'local';
    if (!SAFE_SCOPE.test(owner) || !SAFE_SCOPE.test(place)) throw new Error('This draft belongs to an invalid editor session.');
    return `${PREFIX}:${owner}:${place}`;
}

export function editorDraftScope(url = '') {
    try {
        const project = new URL(url, 'https://veyrnox.invalid').searchParams.get('project');
        return project && SAFE_SCOPE.test(project) ? `project-${project.toLowerCase()}` : 'local';
    } catch {
        return 'local';
    }
}

export function editorHasWork(timeline) {
    return !!timeline && (Object.keys(timeline.media || {}).length>0 || ['video','audio','text','markers'].some(key=>timeline[key]?.length));
}

export function readEditorDraft(storage, actor, scope) {
    if (!storage) return null;
    const raw = storage.getItem(identity(actor, scope));
    if (!raw) return null;
    try {
        const value = JSON.parse(raw);
        if (value?.version !== 1 || !Number.isSafeInteger(value.updatedAt) || validateSequence(value.timeline) || !editorHasWork(value.timeline)) {
            storage.removeItem(identity(actor, scope));
            return null;
        }
        return { timeline: value.timeline, updatedAt: value.updatedAt };
    } catch {
        storage.removeItem(identity(actor, scope));
        return null;
    }
}

export function writeEditorDraft(storage, actor, scope, timeline, updatedAt = Date.now()) {
    if (!storage) throw new Error('Local draft storage is unavailable.');
    const problem = validateSequence(timeline);
    if (problem) throw new Error(problem);
    storage.setItem(identity(actor, scope), JSON.stringify({ version: 1, updatedAt, timeline }));
    return updatedAt;
}

export function removeEditorDraft(storage, actor, scope) {
    storage?.removeItem(identity(actor, scope));
}
