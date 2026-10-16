export default function VeyConversation({ messages, answer, plan, busy, showButton, actionLabel, doAction, activeTarget, park, answerSource, feedback, rateAnswer, starters, ask }) {
  return <>
    {messages.length === 0 ? (
      <div role="status" aria-live="polite" className="rounded-lg bg-vx-base px-2 py-1.5 text-[11px] leading-4 text-vx-fg-body">{answer}</div>
    ) : (
      <div className="space-y-1.5">
        {messages.map((message, index) => {
          const lastAssistant = message.role === 'assistant' && index === messages.length - 1;
          return (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div role={lastAssistant ? 'status' : undefined} aria-live={lastAssistant ? 'polite' : undefined}
                className={`max-w-[96%] rounded-lg px-2 py-1.5 text-[11px] leading-4 ${message.role === 'user' ? 'rounded-br-md bg-vx-accent text-vx-accent-ink' : 'rounded-bl-md bg-vx-base text-vx-fg-body'} ${message.pending ? 'animate-pulse' : ''}`}>
                {message.content}
              </div>
            </div>
          );
        })}
      </div>
    )}
    {showButton && <button type="button" onClick={doAction}
      className="mt-1.5 min-h-8 rounded-lg bg-vx-accent px-2 py-1 text-[11px] font-bold text-vx-accent-ink hover:bg-vx-accent-hover">{actionLabel}</button>}
    {activeTarget && <button type="button" onClick={park}
      className="ml-1 mt-1.5 min-h-8 rounded-lg border border-vx-border px-2 py-1 text-[11px] font-semibold text-vx-fg-muted hover:text-vx-fg">Park Vey</button>}
    {plan && !busy && (
      <div className="mt-1.5 flex items-center justify-between gap-1 border-t border-vx-border/70 pt-1">
        <span className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.1em] text-vx-fg-faint">
          {answerSource === 'local' ? 'Saved Oddling guide · browser only' : answerSource === 'ai' ? 'Live AI · grounded in Veyrnox' : 'Built-in Veyrnox guide'}
        </span>
        <div className="flex items-center gap-1" aria-label="Was this answer useful?">
          <button type="button" onClick={() => rateAnswer(true)} aria-label="Helpful answer" aria-pressed={feedback === 'helpful'}
            className={`rounded-full px-2 py-1 text-xs ${feedback === 'helpful' ? 'bg-vx-accent/15 text-vx-accent' : 'text-vx-fg-faint hover:text-vx-fg'}`}>Yes</button>
          <button type="button" onClick={() => rateAnswer(false)} aria-label="Unhelpful answer" aria-pressed={feedback === 'not_helpful'}
            className={`rounded-full px-2 py-1 text-xs ${feedback === 'not_helpful' ? 'bg-vx-fg/10 text-vx-fg' : 'text-vx-fg-faint hover:text-vx-fg'}`}>No</button>
        </div>
      </div>
    )}
    {!plan && messages.length === 0 && <details className="mt-1.5 text-[11px] text-vx-fg-muted"><summary className="cursor-pointer py-1">Example questions</summary><div className="mt-1 flex flex-col gap-1">
      {starters.map((starter) => <button key={starter} type="button" disabled={busy} onClick={() => ask(starter)}
        className="min-h-8 rounded-lg border border-vx-border px-2 py-1 text-left text-[11px] font-semibold text-vx-fg-body hover:border-vx-accent hover:text-vx-fg disabled:opacity-50">{starter}</button>)}
    </div></details>}
    {!!plan?.savedChoices?.length && <div className="mt-1.5 flex flex-col gap-1" aria-label="Choose a saved Oddling passport">
      {plan.savedChoices.map((item) => <button key={item.id} type="button" disabled={busy}
        onClick={() => ask('Guide me through using this saved Oddling passport.', item.id)}
        className="min-h-8 rounded-lg border border-vx-border px-2 py-1 text-left text-[11px] font-semibold text-vx-fg-body hover:border-vx-accent hover:text-vx-fg disabled:opacity-50">
        {item.name} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(item.savedAt)}
      </button>)}
    </div>}
  </>;
}
