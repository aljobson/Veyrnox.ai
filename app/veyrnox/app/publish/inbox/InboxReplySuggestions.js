'use client';

import { useState } from 'react';
import { decideSocialInboxSuggestion } from '../../../../lib/socialInboxClient';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';

export default function InboxReplySuggestions({ threadId, suggestions, onUse, onChanged, decide = decideSocialInboxSuggestion }) {
  const pending = suggestions.filter((item) => item.status === 'pending');
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  if (pending.length === 0) return null;
  async function choose(item, action) {
    setBusy(item.id); setError('');
    try {
      const result = await decide(threadId, item.id, action);
      if (action === 'use') onUse(result.suggestedReply || item.suggested_reply);
      await onChanged();
    } catch { setError('The suggestion could not be updated. Try again.'); }
    finally { setBusy(''); }
  }
  return <section aria-label="Suggested replies" className="border-t border-vx-border bg-vx-accent/[0.05] p-4">
    <h3 className="text-sm font-black">Suggested replies</h3>
    <p className="mt-1 text-xs text-vx-fg-muted">Matched by your keyword workflows. Review and edit before sending.</p>
    <ul className="mt-3 space-y-2">{pending.map((item) => <li key={item.id} className="rounded-xl border border-vx-border bg-vx-bg p-3">
      <p className="text-xs font-bold text-vx-accent">{item.workflow_name} · “{item.keyword}”</p>
      <p className="mt-2 whitespace-pre-wrap text-sm">{item.suggested_reply}</p>
      <div className="mt-3 flex gap-2"><button className={button} type="button" disabled={busy === item.id} onClick={() => choose(item, 'use')}>Use suggestion</button>
        <button className={button} type="button" disabled={busy === item.id} onClick={() => choose(item, 'dismiss')}>Dismiss</button></div>
    </li>)}</ul>{error && <p role="alert" className="mt-2 text-sm text-vx-danger">{error}</p>}
  </section>;
}
