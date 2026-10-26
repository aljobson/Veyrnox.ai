import net from 'node:net';

/** Concat's newline-delimited JSON-RPC protocol, with bounded waits and buffers. */
export async function connectConcat(token, { port = 7420, signal } = {}) {
    const socket = net.connect(port, '127.0.0.1');
    let next = 0, buffer = '', exportDone;
    const pending = new Map();
    const outcome = new Promise((resolve, reject) => { exportDone = { resolve, reject }; });
    outcome.catch(() => {});
    const close = () => socket.destroy();
    const fail = () => { for (const p of pending.values()) p.reject(new Error('concat_disconnected')); pending.clear(); exportDone.reject(new Error('concat_disconnected')); };
    socket.on('error', fail); socket.on('close', fail);
    socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 4 * 1024 * 1024) { close(); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
            let message;
            try { message = JSON.parse(buffer.slice(0, end)); } catch { close(); return; }
            buffer = buffer.slice(end + 1);
            if (pending.has(message.id)) {
                const p = pending.get(message.id); pending.delete(message.id);
                if (message.error) p.reject(new Error('concat_command_failed')); else p.resolve(message.result);
            } else if (message.method === 'export.done') exportDone.resolve(message.params);
            else if (message.method === 'export.failed') exportDone.reject(new Error('concat_export_failed'));
        }
    });
    signal?.addEventListener('abort', close, { once: true });
    const call = (method, params) => new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('concat_timeout')); }, 30000);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    await call('auth', { token });
    return { call, outcome, close: () => { signal?.removeEventListener('abort', close); close(); } };
}

export async function executeCalls(calls, rpc, { location, output, files }) {
    const refs = new Map([['location', location], ['path', `${location}/project`], ['output', output], ...Object.entries(files).map(([id, path]) => [`file:${id}`, path])]);
    const resolve = value => {
        if (Array.isArray(value)) return value.map(resolve);
        if (value && typeof value === 'object') {
            if (Object.keys(value).length === 1 && typeof value.$ref === 'string') {
                if (!refs.has(value.$ref)) throw new Error('unknown_reference');
                return refs.get(value.$ref);
            }
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
        }
        return value;
    };
    for (const entry of calls) {
        if (!['project.create', 'media.import', 'edit.apply', 'export.run'].includes(entry.method)) throw new Error('invalid_method');
        const result = await rpc.call(entry.method, resolve(entry.params));
        if (entry.capture === 'project') {
            const timeline = result.project.timelines.find(t => t.id === result.project.activeTimelineId);
            if (!timeline?.tracks?.[2]) throw new Error('invalid_project');
            refs.set('track:video', timeline.tracks[0].id);
            refs.set('track:audio', timeline.tracks[2].id);
        } else if (entry.capture) {
            if (!result?.createdId) throw new Error('missing_created_id');
            refs.set(entry.capture, result.createdId);
        }
    }
    await rpc.outcome;
}
