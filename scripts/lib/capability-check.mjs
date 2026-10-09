// The comparison behind scripts/check-capabilities.mjs: one capability record
// against the input schema fal serves for its endpoint. No network here, so
// `npm test` covers it (tests/capabilityCheck.test.mjs).

const BILLED = ['duration', 'duration_seconds', 'resolution', 'generate_audio', 'num_images',
    'num_outputs', 'max_images', 'image_size', 'thinking', 'video_quality', 'quality'];

// fal's OpenAPI document -> the endpoint's input schema, plus every named
// schema so a $ref can be followed. Null when the document has no input schema.
export function inputSchemaOf(doc) {
    const schemas = doc && doc.components && doc.components.schemas;
    if (!schemas) return null;
    const name = Object.keys(schemas).find((k) => k.endsWith('Input') && schemas[k].properties);
    return name ? { schema: schemas[name], schemas } : null;
}

function enumOf(prop) {
    if (!prop) return null;
    if (Array.isArray(prop.enum)) return prop.enum;
    const variant = (prop.anyOf || []).find((a) => Array.isArray(a.enum));
    return variant ? variant.enum : null;
}

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The object schema among a field's anyOf variants, following a $ref. fal
// types image_size as anyOf(ImageSize, preset name), so {width, height} is as
// valid there as "landscape_4_3". Null when no variant is an object, or when
// the schema a variant points at is not in the document.
function objectVariant(prop, schemas) {
    for (const variant of (prop && prop.anyOf) || []) {
        const target = variant.$ref ? schemas[variant.$ref.split('/').pop()] : variant;
        if (target && target.type === 'object') return target;
    }
    return null;
}

function numberProblem(value, spec) {
    if (spec.type !== 'integer' && spec.type !== 'number') return null;
    if (typeof value !== 'number' || (spec.type === 'integer' && !Number.isInteger(value))) return `is not ${spec.type === 'integer' ? 'an integer' : 'a number'}`;
    if (typeof spec.minimum === 'number' && value < spec.minimum) return `is below the minimum ${spec.minimum}`;
    if (typeof spec.exclusiveMinimum === 'number' && value <= spec.exclusiveMinimum) return `is not above ${spec.exclusiveMinimum}`;
    if (typeof spec.maximum === 'number' && value > spec.maximum) return `is above the maximum ${spec.maximum}`;
    if (typeof spec.exclusiveMaximum === 'number' && value >= spec.exclusiveMaximum) return `is not below ${spec.exclusiveMaximum}`;
    return null;
}

// An object we send against the object schema fal accepts for the field: a
// key fal does not know is dropped for fal's own default, and a number out of
// bounds is refused. A schema that lists no keys, or takes others, is not
// held to its list.
function objectProblems(label, value, shape) {
    const problems = [];
    const known = shape.properties;
    if (!known) return problems;
    for (const [key, item] of Object.entries(value)) {
        if (!has(known, key)) {
            if (!shape.additionalProperties) problems.push(`${label}.${key} does not exist`);
            continue;
        }
        const why = numberProblem(item, known[key]);
        if (why) problems.push(`${label}.${key}=${JSON.stringify(item)} ${why}`);
    }
    return problems;
}

// JSON with object keys sorted, so two objects with the same content compare
// equal whatever order their keys came in.
function canonical(value) {
    return JSON.stringify(value, (_key, item) => (isObject(item)
        ? Object.fromEntries(Object.keys(item).sort().map((k) => [k, item[k]]))
        : item));
}

export function checkRecord(record, schema, schemas = {}) {
    const problems = [];
    const props = schema.properties;
    const sent = new Set();
    const need = (field, why) => {
        sent.add(field);
        if (!has(props, field)) problems.push(`${why} field "${field}" does not exist`);
    };
    const inEnum = (field, value, why) => {
        // An object goes to the field's object variant when it has one; the
        // enum only binds a value no other variant takes.
        const shape = isObject(value) ? objectVariant(props[field], schemas) : null;
        if (shape) { problems.push(...objectProblems(`${why} ${field}`, value, shape)); return; }
        const values = enumOf(props[field]);
        if (values && !values.map(String).includes(String(value))) problems.push(`${why} ${field}=${JSON.stringify(value)} not in ${JSON.stringify(values)}`);
    };

    for (const [key, rule] of Object.entries(record.inputs)) {
        if (record.rename[key] === null) continue; // consumed by derive, never sent
        const field = record.rename[key] || key;
        need(field, 'input');
        if (rule.type === 'enum') for (const v of rule.values) inEnum(field, v, 'input');
    }
    for (const spec of Object.values(record.media)) need(spec.field, 'media');
    for (const field of record.derives || []) need(field, 'derived');
    if (record.lengths) {
        need(record.lengths.field, 'length');
        for (const v of Object.values(record.lengths.map)) inEnum(record.lengths.field, v, 'length');
    }
    for (const [field, value] of Object.entries(record.fixed)) {
        need(field, 'pinned');
        inEnum(field, value, 'pinned');
    }
    for (const [field, value] of Object.entries(record.assumes)) {
        if (!has(props, field)) { problems.push(`assumed field "${field}" does not exist`); continue; }
        const live = props[field].default;
        // By value: fal has served Seedream's {width, height} default with
        // the keys in either order.
        if (canonical(live) !== canonical(value)) problems.push(`assumed default ${field}=${JSON.stringify(value)} but fal now defaults to ${JSON.stringify(live)}`);
    }
    for (const field of schema.required || []) {
        if (!sent.has(field)) problems.push(`fal requires "${field}", which we never send`);
    }
    for (const field of BILLED) {
        if (!has(props, field)) continue;
        if (sent.has(field) || has(record.assumes, field)) continue;
        problems.push(`billing-sensitive "${field}" (default ${JSON.stringify(props[field].default)}) is neither pinned nor assumed`);
    }
    return problems;
}
