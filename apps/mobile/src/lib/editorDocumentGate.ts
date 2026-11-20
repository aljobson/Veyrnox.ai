import { validProjectDocument } from '../../../../lib/projectDocument.js';
import { utf8Bytes, type ProjectDocument } from './editorBridge';

export function documentProblem(doc: ProjectDocument): 'invalid' | 'tooLarge' | null {
    try {
        if (utf8Bytes(JSON.stringify(doc)) > 32768) return 'tooLarge';
        // Reuse the server envelope contract, including matching timeline versions and sequence limits.
        return validProjectDocument(doc, doc.project_id) ? null : 'invalid';
    } catch { return 'invalid'; }
}
