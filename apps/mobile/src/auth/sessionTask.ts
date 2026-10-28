import { useAuth } from './AuthProvider';
import type { TokenSource } from '../lib/auth/accountCalls';
export { isAccountChanged } from '../lib/auth/tokenUser';

export interface SessionTask {
    readonly gen: number;
    readonly user: string | null;
    current(): boolean;
    readonly tokens: TokenSource;
}

export function useSessionTask(): () => SessionTask {
    return useAuth().beginSessionTask;
}
