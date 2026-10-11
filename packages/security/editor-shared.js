import { ApiError } from './errors.js';
export function requireEditorShared() {
    if(process.env.EDITOR_SHARED_TOOLS_ENABLED!=='true')throw new ApiError(404,'NOT_FOUND','The resource was not found.');
}
export function expectedVersion(value) {
    if(!Number.isSafeInteger(value) || value<0 || value>2147483646)throw new ApiError(400,'INVALID_VERSION','A non-negative version is required.');return value;
}
