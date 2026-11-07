// Metro loads the same compact map without pulling in any prompt contracts.
import { routeForContract } from '../../../../lib/templateRouteRuntime.js';
const data = require('../../../../lib/templateRoutes.json');
const routes = data.default || data;
export function templateRouteContract(id) {
    return typeof id === 'string' && Object.hasOwn(routes.templates, id) ? routes.profiles[routes.templates[id]] : null;
}
export function templateRoute(preset, legacyModelId, count) {
    return routeForContract(templateRouteContract(preset?.id), legacyModelId, count);
}
