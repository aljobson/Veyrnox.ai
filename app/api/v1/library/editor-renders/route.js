import { editorRenderHandlers } from '../../../../../lib/editorRenderApi.js';
export async function GET(request) { return editorRenderHandlers().list(request); }
export async function POST(request) { return editorRenderHandlers().reserve(request); }
export async function DELETE(request) { return editorRenderHandlers().remove(request); }
