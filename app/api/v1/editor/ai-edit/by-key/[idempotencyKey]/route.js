import { editorAiEditHandlers } from '../../../../../../../lib/editorAiEdit.js';
export async function GET(request, context) {
    const { idempotencyKey } = await context.params;
    return editorAiEditHandlers().recover(request, idempotencyKey);
}
