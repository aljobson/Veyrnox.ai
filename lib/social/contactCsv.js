const REQUIRED = ['external_id', 'name'];
const ALLOWED = new Set(['external_id', 'name', 'tags', 'subscription_status', 'notes']);
const STATUSES = new Set(['unknown', 'subscribed', 'unsubscribed']);
const TAG = /^[a-z0-9][a-z0-9 _-]*$/;

function rows(text) {
  const result = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); result.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (quoted) throw new Error('Unclosed quoted field.');
  if (field || row.length) { row.push(field); result.push(row); }
  return result.filter((item) => item.some((value) => value.trim()));
}

export function parseContactCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The CSV file is empty.');
  const parsed = rows(text); if (parsed.length < 2) throw new Error('Add a header row and at least one contact.');
  const headers = parsed[0].map((value) => value.trim().toLowerCase());
  if (headers.some((value) => !ALLOWED.has(value)) || new Set(headers).size !== headers.length
    || REQUIRED.some((value) => !headers.includes(value))) throw new Error('Use the supported CSV headers: external_id, name, tags, subscription_status, notes.');
  const contacts = parsed.slice(1).map((values, index) => {
    if (values.length > headers.length) throw new Error(`Row ${index + 2} has too many columns.`);
    const item = Object.fromEntries(headers.map((header, column) => [header, (values[column] || '').trim()]));
    const tags = [...new Set((item.tags || '').split('|').map((value) => value.trim().toLowerCase()).filter(Boolean))];
    const status = (item.subscription_status || 'unknown').toLowerCase();
    if (!item.external_id || item.external_id.length > 256 || !item.name || item.name.length > 120
      || tags.length > 10 || tags.some((tag) => tag.length > 32 || !TAG.test(tag))
      || !STATUSES.has(status) || (item.notes || '').length > 2000) throw new Error(`Row ${index + 2} contains an invalid contact.`);
    return { externalId: item.external_id, name: item.name, tags, subscriptionStatus: status, notes: item.notes || '' };
  });
  if (contacts.length > 250) throw new Error('Import at most 250 contacts at a time.');
  if (new Set(contacts.map((item) => item.externalId)).size !== contacts.length) throw new Error('Each external_id must be unique in the file.');
  return contacts;
}
