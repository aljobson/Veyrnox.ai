import { editorRenderHandlers } from '../../../../../../../lib/editorRenderApi.js';
export async function POST(request, { params }) { return editorRenderHandlers().inspectSaved(request, (await params).id); }
