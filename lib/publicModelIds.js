/**
 * Public model ids (supplier-neutral).
 *
 * A model_catalog id may end in the wholesale supplier that serves it
 * (`nano-banana-pro-grsai`). That id is the database key and stays as it is;
 * nothing public may carry the supplier. Anonymous and external outputs
 * (GET /api/catalog, the Developer API and MCP model lists, /models pages)
 * show `publicModelId(id)`: the supplier suffix becomes a neutral tag
 * (`nano-banana-pro-a2`). The same offer sold through two suppliers at two
 * prices keeps two distinct public ids.
 *
 * Input is resolved with `internalModelId`: a public id maps back, and any
 * other id (including every old one) passes through untouched, so existing
 * clients, saved links and developer integrations keep working.
 * Pure and dependency-free so web and mobile clients can share it.
 */
const SUPPLIER_TAG = { kie: 'a1', grsai: 'a2', crun: 'a3', byteplus: 'a4', higgsfield: 'a5', openrouter: 'a6', fal: 'a7' };
const TAG_SUPPLIER = Object.fromEntries(Object.entries(SUPPLIER_TAG).map(([supplier, tag]) => [tag, supplier]));
const SUPPLIER_SUFFIX = /-(kie|grsai|crun|byteplus|higgsfield|openrouter|fal)$/;
const TAG_SUFFIX = /-(a[1-7])$/;

export function publicModelId(id) {
    return typeof id === 'string' ? id.replace(SUPPLIER_SUFFIX, (_, supplier) => `-${SUPPLIER_TAG[supplier]}`) : id;
}

export function internalModelId(id) {
    return typeof id === 'string' ? id.replace(TAG_SUFFIX, (_, tag) => `-${TAG_SUPPLIER[tag]}`) : id;
}

/** Same rows with supplier-neutral ids; the input is not changed. */
export function withPublicModelIds(models) {
    return Array.isArray(models) ? models.map((model) => (model && typeof model.id === 'string' ? { ...model, id: publicModelId(model.id) } : model)) : models;
}

/**
 * A job read, or a list of them, with supplier-neutral model ids. GET /api/v1/jobs[/:id] answers the web app with the
 * database id; the MCP and the Developer API are external and show the public one. Input is not changed.
 */
export function withPublicJobModelIds(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const out = { ...body };
    if (typeof out.model_id === 'string') out.model_id = publicModelId(out.model_id);
    if (Array.isArray(out.jobs)) out.jobs = out.jobs.map((job) => (job && typeof job.model_id === 'string' ? { ...job, model_id: publicModelId(job.model_id) } : job));
    return out;
}
