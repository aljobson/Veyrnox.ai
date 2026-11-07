import { editorAiEditHandlers } from '../../../../../lib/editorAiEdit.js';
export const POST = request => editorAiEditHandlers().run(request);
