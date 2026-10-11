import { editorRenderHandlers } from '../../../../../../../lib/editorRenderApi.js';
export async function GET(request, { params }) { return editorRenderHandlers().asset(request, (await params).id); }
