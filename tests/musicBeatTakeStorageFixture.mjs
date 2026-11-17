// In-memory stand-in for the beat take IndexedDB stores (metadata, audio rows, checkpoint chunks).
export function memoryBeatTakeStorage(rows = [], { failListState = 0, failPut = false } = {}) {
  const audio = new Map(), chunks = new Map(), states = new Map();
  let stateReads = 0;
  for (const row of rows) {
    audio.set(row.id, row);
    states.set(row.id, { id: row.id, beatId: row.beatId, label: row.label, sampleRate: row.sampleRate, length: row.samples.length, createdAt: row.createdAt, state: row.state, pending: row.pending });
  }
  const adapter = {
    listState: async () => { if (++stateReads <= failListState) throw Error('IndexedDB unavailable'); return [...states.values()]; },
    putState: async r => { states.set(r.id, structuredClone(r)); return true; },
    get: async id => audio.get(id),
    put: async r => { if (failPut) return false; audio.set(r.id, structuredClone(r)); return true; },
    listChunksFor: async id => [...chunks.values()].filter(c => c.takeId === id),
    putChunk: async r => { if (failPut) return false; chunks.set(r.id, structuredClone(r)); return true; },
  };
  return { adapter, audio, chunks, states, get stateReads() { return stateReads; } };
}
