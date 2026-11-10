'use client';

import { useState } from 'react';
import { parsePerformanceProjectManifest, PERFORMANCE_PROJECT_MAX_BYTES } from '../_lib/performanceProjectManifest';

const MESSAGES = {
  invalid_project_json: 'Choose a valid Veyrnox project JSON file.',
  unsupported_project_schema: 'That file is not a supported Veyrnox Performance project.',
  unsupported_project_workflow: 'That project uses a workflow this Studio cannot open.',
};

export function ImportPerformanceProject({ allowedWorkflowIds, onImport, className = '' }) {
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);

  async function importFile(file) {
    if (!file) return;
    setStatus('');
    setError(false);
    try {
      if (file.size > PERFORMANCE_PROJECT_MAX_BYTES) throw new Error('invalid_project_json');
      const draft = parsePerformanceProjectManifest(await file.text(), { allowedWorkflowIds });
      onImport(draft);
      const names = draft.requiredSources.map((source) => source.name);
      setStatus(`Settings imported. ${names.length ? `Reselect ${names.join(', ')}. ` : ''}Rights, consent and the live price must be approved again.`);
    } catch (next) {
      setError(true);
      setStatus(MESSAGES[next?.message] || 'That project could not be imported. Current settings are unchanged.');
    }
  }

  return (
    <>
      <label className={`${className} cursor-pointer`}>
        Import project JSON
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            event.target.value = '';
            importFile(file);
          }}
        />
      </label>
      {status && <p role={error ? 'alert' : 'status'} className={`basis-full text-[11px] leading-4 ${error ? 'text-vx-danger' : 'text-vx-fg-muted'}`}>{status}</p>}
    </>
  );
}
