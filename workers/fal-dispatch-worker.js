import { runFalDispatchQueue } from '../lib/falDispatchConsumer.js';

export default {
    async queue(batch, env) { await runFalDispatchQueue(batch, env); },
    async fetch() { return new Response('Not found', { status: 404 }); },
};
