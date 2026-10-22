export function StudioWorkflowIcon({ workflow, size = 'card' }) {
  if (!workflow) return null;
  const detail = size === 'detail';
  return (
    <span
      aria-hidden="true"
      data-workflow-icon={workflow.id}
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-white/10 bg-vx-base ${detail ? 'size-16 rounded-2xl sm:size-[72px]' : 'size-12 rounded-2xl'}`}
      style={{ color: workflow.accent, boxShadow: `inset 0 0 28px ${workflow.accent}1f, 0 10px 26px #00000030` }}
    >
      <span className="absolute -bottom-3 -right-3 size-10 rounded-full opacity-25 blur-lg" style={{ backgroundColor: workflow.accent }} />
      <svg className={`relative ${detail ? 'size-9' : 'size-7'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        <path d={workflow.path} />
      </svg>
    </span>
  );
}
