import { studioSkillIcon } from '../../_lib/studioSkillIcons';

const sizes = {
  chip: 'size-5 rounded-md',
  card: 'size-11 rounded-xl',
  detail: 'size-16 rounded-2xl sm:size-[72px]',
};

export function StudioSkillIcon({ skillId, size = 'card', className = '' }) {
  const icon = studioSkillIcon(skillId);
  if (!icon) return null;

  return (
    <span
      aria-hidden="true"
      data-skill-icon={skillId}
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-white/10 bg-vx-base ${sizes[size] || sizes.card} ${className}`}
      style={{ color: icon.color, boxShadow: `inset 0 0 24px ${icon.color}18, 0 8px 24px #00000024` }}
    >
      <span className="absolute inset-[18%] rounded-full opacity-20 blur-md" style={{ backgroundColor: icon.color }} />
      <svg className={size === 'detail' ? 'relative size-9' : size === 'chip' ? 'relative size-3.5' : 'relative size-6'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        <path d={icon.path} />
      </svg>
    </span>
  );
}
