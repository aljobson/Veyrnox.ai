import { routeForContract } from './templateRouteRuntime.js';
export { routeForContract } from './templateRouteRuntime.js';
import data from './templateRoutes.json' with { type: 'json' };

// Profiles intern the few scalar settings used by routing and the selected-template UI.
export function templateRouteContract(id) {
  return typeof id === 'string' && Object.hasOwn(data.templates, id) ? data.profiles[data.templates[id]] : null;
}
export const templateRoute = (preset, legacyModelId, count) => routeForContract(templateRouteContract(preset?.id), legacyModelId, count);

