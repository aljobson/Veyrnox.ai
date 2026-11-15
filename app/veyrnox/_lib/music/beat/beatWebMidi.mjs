export function parseMidiMessage(bytes) {
  if (!bytes || bytes.length !== 3 || !Array.from(bytes).every(Number.isInteger)) return null;
  const [status, pitch, velocity] = bytes;
  if (status < 128 || status > 255 || pitch < 0 || pitch > 127 || velocity < 0 || velocity > 127) return null;
  const kind = status & 0xf0;
  if (kind !== 0x90 && kind !== 0x80) return null;
  return { type: kind === 0x80 || velocity === 0 ? 'off' : 'on', pitch, velocity, channel: status & 15 };
}
// Own listeners, not device properties: switching, hotplug and disposal are symmetric.
export function bindMidiAccess(access, onMessage, onDevices) {
  let selected = null, input = null, disposed = false;
  const message = (e) => { const parsed = parseMidiMessage(e.data); if (parsed) onMessage(parsed, e.timeStamp); };
  function update() {
    if (disposed) return;
    input?.removeEventListener('midimessage', message);
    const devices = [...access.inputs.values()].filter((d) => d.state !== 'disconnected');
    input = devices.find((d) => d.id === selected) || devices[0] || null;
    selected = input?.id || null;
    input?.addEventListener('midimessage', message);
    onDevices(devices, selected);
  }
  access.addEventListener('statechange', update); update();
  return { select(id) { selected = id; update(); }, dispose() { disposed = true; input?.removeEventListener('midimessage', message); access.removeEventListener('statechange', update); } };
}
export function inputContextTime(context, timeStamp, performanceNow) {
  return context.currentTime + (Number.isFinite(timeStamp) ? (timeStamp - performanceNow) / 1000 : 0) - (context.outputLatency || context.baseLatency || 0);
}
