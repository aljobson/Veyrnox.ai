import { select, envConfig } from '../packages/db/supabase-client.js';
import { RUNTIME_SWITCHES } from './runtimeSwitches.js';

export function createRuntimeSwitchCache({ read, now = Date.now, timeoutMs = 400, log = () => console.error('[runtime-switches] read failed; retaining last good overrides') }) {
  let values = Object.create(null), nextRead = 0, flight;
  const cachedEnabled = key => RUNTIME_SWITCHES[key]?.kind === 'enable' && values[key] === 'on';
  function cachedKilled(key) {
    if (!Object.hasOwn(RUNTIME_SWITCHES,key) || RUNTIME_SWITCHES[key].kind !== 'kill') throw Error('unknown_kill_switch');
    return values[key] === 'off';
  }
  function refresh(cfg) {
    if (flight) return flight;
    if (now() < nextRead) return Promise.resolve();
    flight = (async () => {
      await Promise.resolve(); // Assign the shared promise even if read throws synchronously.
      let timer;
      try {
        const rows = await Promise.race([read(cfg), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('switch_timeout')), timeoutMs);
        })]);
        if (!Array.isArray(rows) || rows.length > Object.keys(RUNTIME_SWITCHES).length) throw Error('invalid_switches');
        const updated = Object.create(null);
        for (const row of rows) {
          if (!Object.hasOwn(RUNTIME_SWITCHES, row.key) || !['on','off'].includes(row.state) || Object.hasOwn(updated,row.key)) throw Error('invalid_switch');
          updated[row.key] = row.state;
        }
        values = updated;
        nextRead = now() + 15000;
      } catch { nextRead = now() + 5000; log(); }
      finally { clearTimeout(timer); flight = undefined; }
    })();
    return flight;
  }
  return {
    refresh, cachedEnabled, cachedKilled,
    refreshIfDue: cfg => (flight || now() >= nextRead) ? refresh(cfg) : null,
    async isKilled(key,cfg) {
      if (!Object.hasOwn(RUNTIME_SWITCHES,key) || RUNTIME_SWITCHES[key].kind !== 'kill') throw Error('unknown_kill_switch');
      await refresh(cfg);
      return cachedKilled(key);
    },
  };
}
// OpenNext handler chunks and the Worker entry can bundle this module separately.
// Share their state explicitly within the isolate, not across hosts or processes.
const slot = Symbol.for('veyrnox.runtimeSwitchCache.v1');
const cache = globalThis[slot] ??= createRuntimeSwitchCache({ read: cfg => select('runtime_switches', { columns: 'key,state', limit: 7 }, { ...(cfg || envConfig()), timeoutMs: 400 }) });
// Admission itself never performs I/O or logs. The Worker owns refreshes; a cold
// direct handler invocation preserves its existing sequence and defaults open.
export const isFeatureKilled = key => cache.cachedKilled(key);
// S5 can inspect this without fetching or awaiting anything on its hot path.
export const cachedRuntimeEnabled = key => cache.cachedEnabled(key);
export const refreshRuntimeSwitches = cfg => cache.refresh(cfg);
export const refreshRuntimeSwitchesIfDue = cfg => cache.refreshIfDue(cfg);
