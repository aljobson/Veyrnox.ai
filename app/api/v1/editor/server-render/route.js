import { editorServerRenderHandlers } from '../../../../../lib/editorServerRender.js';
import { editorServerRenderDeps } from '../../../../../lib/editorServerRenderRuntime.js';
import { editorFeatureEnabled } from '../../../../../lib/editorRuntimeFlags.mjs';
const handlers = () => editorServerRenderHandlers(editorServerRenderDeps(), {
    enabled: editorFeatureEnabled('EDITOR_SERVER_RENDER_ENABLED'), publicHost: process.env.PUBLIC_HOST,
});
export const POST = request => handlers().create(request);
export const GET = request => handlers().status(request);
export const DELETE = request => handlers().cancel(request);
