import { editorServerRenderHandlers } from '../../../../../lib/editorServerRender.js';
import { editorServerRenderDeps } from '../../../../../lib/editorServerRenderRuntime.js';
import { editorServerRenderMode } from '../../../../../lib/editorRuntimeFlags.mjs';
const handlers = () => editorServerRenderHandlers(editorServerRenderDeps(), {
    mode: editorServerRenderMode(), previewUserIds: process.env.EDITOR_SERVER_RENDER_PREVIEW_USER_IDS, publicHost: process.env.PUBLIC_HOST,
});
export const POST = request => handlers().create(request);
export const GET = request => handlers().status(request);
export const DELETE = request => handlers().cancel(request);
