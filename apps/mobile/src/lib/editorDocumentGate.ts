import { validProjectDocument } from '../../../../lib/projectDocument.js';
import { utf8Bytes, type ProjectDocument } from './editorBridge';

export type DocumentCommitResult =
    | { status: 'accepted' }
    | { status: 'refused'; reason: 'invalid' | 'tooLarge' }
    | { status: 'not-live' };

export type DocumentCommitFailure = Exclude<DocumentCommitResult, { status: 'accepted' }>;

export function documentProblem(doc: ProjectDocument): 'invalid' | 'tooLarge' | null {
    try {
        if (utf8Bytes(JSON.stringify(doc)) > 32768) return 'tooLarge';
        if (doc.timeline != null && utf8Bytes(JSON.stringify(doc.timeline)) > 30000) return 'tooLarge';
        // Reuse the server envelope contract, including matching timeline versions and sequence limits.
        return validProjectDocument(doc, doc.project_id) ? null : 'invalid';
    } catch { return 'invalid'; }
}
