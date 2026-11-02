// ADR-0319. An absent kill override preserves the deployment's own gates.
export const RUNTIME_SWITCHES = Object.freeze({
  generation: { label: 'Generation submissions', kind: 'kill', admission: 'app/api/v1/generations/route.js:POST (paid, free, developer API and MCP)' },
  chat: { label: 'Chat turns', kind: 'kill', admission: 'lib/chatTurn.js:runChatTurn' },
  publish: { label: 'New publishing dispatches', kind: 'kill', admission: 'lib/socialPublishSweep.js:dispatch; claim_due_social_post_targets_v2 excludes paused fresh work before LIMIT so provider checkpoints continue' },
  cinema: { label: 'New Cinema activity', kind: 'kill', admission: 'worker.js:fetch via cinemaRuntimeGate; explicit admission routes in lib/runtimeAdmission.js' },
  telemetry: { label: 'Traffic telemetry', kind: 'enable', admission: 'worker.js:fetch via lib/telemetry.js; aggregate ingest rechecks DB switch' },
  support_intake: { label: 'Support intake', kind: 'enable', admission: 'app/api/v1/support/tickets/route.js:POST; support_ticket_create rechecks DB switch' },
});
export function runtimeSwitchState(key, state) {
  const entry = RUNTIME_SWITCHES[key];
  if (!entry) throw new Error('unknown_runtime_switch');
  return entry.kind === 'kill' ? (state === 'off' ? 'Paused' : 'Deployment controlled') : (state === 'on' ? 'Enabled' : 'Off');
}
