import { editorServerRenderHandlers } from '../../../../../../lib/editorServerRender.js';
import { editorServerRenderDeps } from '../../../../../../lib/editorServerRenderRuntime.js';
import { editorServerRenderMode } from '../../../../../../lib/editorRuntimeFlags.mjs';
export const POST = request => editorServerRenderHandlers(editorServerRenderDeps(), {
    mode: editorServerRenderMode(), previewUserIds: process.env.EDITOR_SERVER_RENDER_PREVIEW_USER_IDS,
    publicHost: process.env.PUBLIC_HOST,
}).quote(request);
