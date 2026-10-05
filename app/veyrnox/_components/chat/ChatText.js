'use client';
import { useState } from 'react';
import { parseMarkdown } from '../../../../lib/chatMarkdown.js';

// Turns parsed blocks into React elements. Every string is a text node: nothing here can inject markup.
function Inline({ parts }) {
  return parts.map((p, i) => (p.t === 'code'
    ? <code key={i} className="rounded bg-vx-border/60 px-1 font-vx-mono text-[0.9em]">{p.v}</code>
    : p.t === 'strong' ? <strong key={i} className="font-semibold text-vx-fg">{p.v}</strong>
    : <span key={i}>{p.v}</span>));
}

function Code({ lang, text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ }
  };
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-vx-border bg-vx-base">
      <div className="flex items-center justify-between border-b border-vx-border bg-vx-panel px-3 py-1 text-xs text-vx-fg-muted">
        <span className="font-vx-mono">{lang || 'code'}</span>
        <button type="button" onClick={copy} className="rounded px-1.5 py-0.5 hover:text-vx-fg" aria-label="Copy code">{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm" tabIndex={0}><code className="font-vx-mono">{text}</code></pre>
    </div>
  );
}

export function ChatText({ text }) {
  return (
    <div className="space-y-3 break-words text-[15px] leading-relaxed text-vx-fg-body">
      {parseMarkdown(text).map((b, i) => {
        if (b.type === 'code') return <Code key={i} lang={b.lang} text={b.text} />;
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type;
          return <List key={i} className={`${b.type === 'ul' ? 'list-disc' : 'list-decimal'} ml-5 space-y-1`}>{b.items.map((it, j) => <li key={j}><Inline parts={it} /></li>)}</List>;
        }
        return <p key={i} className={`whitespace-pre-wrap ${b.type === 'h' ? 'font-semibold text-vx-fg' : ''}`}><Inline parts={b.inline} /></p>;
      })}
    </div>
  );
}
