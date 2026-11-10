const SAFE_ID = /^[A-Za-z0-9-]{1,128}$/;

export function buildProvenanceDownload(record) {
  if (!record || typeof record !== 'object' || !SAFE_ID.test(String(record.job_id || ''))) {
    throw new Error('invalid_provenance_record');
  }
  const document = {
    schema: 'https://veyrnox.ai/schemas/generation-provenance/v1',
    ...record,
  };
  return {
    filename: `veyrnox-${record.job_id.slice(0, 8)}-provenance.json`,
    mimeType: 'application/json',
    text: `${JSON.stringify(document, null, 2)}\n`,
  };
}
