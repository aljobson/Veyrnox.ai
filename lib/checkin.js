import { appRuntimeFlag } from './appRuntime.js';

// The legacy CHECKIN_ENABLED var still works (staging); production uses APP_RUNTIME_FLAGS.checkin.
export const checkinEnabled = (env) => env?.CHECKIN_ENABLED === 'true' || appRuntimeFlag('checkin', env);
