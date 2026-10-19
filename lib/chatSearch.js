import { searchApiKey } from './chat.js';
import { searchWeb as searchExa, SearchError } from '../packages/adapters/exa.js';
import { searchWeb as searchParallel } from '../packages/adapters/parallelSearch.js';

/** Capped-search deployment choice. Configured Exa stays selected; invalid choices fail closed. */
export function resolveChatSearch(env) {
    const apiKey = searchApiKey(env);
    const selected = env?.CHAT_SEARCH_PROVIDER;
    if (selected !== undefined && selected !== '' && selected !== 'exa' && selected !== 'parallel') return { provider: 'off', apiKey: '' };
    const provider = selected || (apiKey ? 'exa' : 'parallel');
    if (provider === 'exa') return { provider: apiKey ? 'exa' : 'off', apiKey };
    return { provider: 'parallel', apiKey: '' };
}

/** Dispatch once. A configured provider's failure never invokes another provider. */
export async function searchChatWeb({ env, ...args }) {
    const config = resolveChatSearch(env);
    if (config.provider === 'off') throw new SearchError('search_not_configured');
    if (config.provider === 'exa') return searchExa({ ...args, apiKey: config.apiKey });
    return searchParallel(args);
}
