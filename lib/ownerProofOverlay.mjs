// Private discovery lives only in session memory, never in the public catalog cache.
export function mergeOwnerProofModels(models, overlay) {
    const merged = new Map(models.map(model => [model.id, model]));
    for (const model of overlay) merged.set(model.id, model);
    return [...merged.values()];
}
export const ownerProofRefusal = error => [401, 403, 404].includes(error?.status);

export function createOwnerProofOverlay({ load, current, publish }) {
    let revision = 0;
    return {
        clear() { revision++; publish([]); },
        async refresh() {
            const run = ++revision;
            try {
                const data = await load();
                if (run === revision && current() && Array.isArray(data?.models)) publish(data.models);
            } catch (error) {
                if (run === revision && current() && ownerProofRefusal(error)) publish([]);
            }
        },
    };
}

// One request shared by all mounted proof surfaces in the same session.
export function createOwnerProofStore() {
    const empty = Object.freeze([]);
    let key = null, revision = 0, models = empty, pending = null, settled = false;
    const listeners = new Set();
    const publish = value => { models = value; for (const listener of listeners) listener(); };
    return {
        snapshot: session => session !== null && session === key ? models : empty,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        session(session) {
            if (session === key) return;
            key = session; revision++; pending = null; settled = false; publish(empty);
        },
        refresh(session, load, force = false) {
            if (session === null || session !== key) return Promise.resolve();
            if (pending) return pending;
            if (settled && !force) return Promise.resolve();
            const run = revision;
            const work = Promise.resolve().then(load).then(data => {
                if (run !== revision) return;
                if (Array.isArray(data?.models)) { settled = true; publish(data.models); }
            }).catch(error => {
                if (run === revision && ownerProofRefusal(error)) { settled = true; publish(empty); }
            }).finally(() => { if (pending === work) pending = null; });
            pending = work;
            return work;
        },
    };
}

// This is only a client-side request suppression hint. The server verifies JWTs.
export function ownerProofTokenEligible(token) {
    try {
        const part = token.split('.')[1];
        const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
        return claims.aal === 'aal2' && !claims.client_id && claims.exp * 1000 > Date.now();
    } catch { return false; }
}

// Deliberately no refreshing, retries, sign-out, auth events or MFA UI.
export async function readOwnerProof(url, token, request = fetch) {
    const response = await request(url, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw Object.assign(new Error('owner_proof_unavailable'), { status: response.status });
    return response.json();
}

// Ephemeral capability history for the attached image in this account epoch.
export function ownerProofExposure(previous, modelId, epoch, exposed, hasImage) {
    if (!hasImage) return null;
    const models = previous && previous.epoch === epoch ? previous.models : [];
    if (exposed && !models.includes(modelId)) return { epoch, models: [...models, modelId] };
    return models.length ? previous : null;
}
export function hasOwnerProofExposure(exposure, modelId, epoch) {
    return !!exposure && exposure.epoch === epoch && exposure.models.includes(modelId);
}
