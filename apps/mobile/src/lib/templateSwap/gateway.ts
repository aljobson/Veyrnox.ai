import { ApiError, type ApiClient, type ClientTask } from '../api';
export function createSwapGateway(api: ApiClient, beginSessionTask: () => ClientTask) {
    return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
        if (!/^\/(generations|balance|jobs(?:\?idempotency_key=[^#]*))$/.test(path)) throw Error('invalid_swap_path');
        const task = beginSessionTask();
        const check = () => { if (!task.current()) throw new ApiError(409, 'account_changed'); };
        check();
        const result = await api.request<T>(`/api/v1${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }, { task, owner: task.user ?? undefined });
        check(); return result;
    };
}
