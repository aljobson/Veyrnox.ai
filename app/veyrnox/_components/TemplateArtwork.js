const hash = (value) => [...value].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 17);

// Legacy bookmarked recipes predate the generated preview library. Give their
// Create handoff a labelled visual reference without pretending it is a video.
export function TemplateArtwork({ preset, eyebrow, title, compact = false }) {
  const seed = hash(preset.id);
  const glowX = 18 + (seed % 65);
  const glowY = 12 + ((seed >>> 5) % 58);
  const orbitX = 12 + ((seed >>> 9) % 60);
  const orbitY = 18 + ((seed >>> 13) % 56);
  const angle = 18 + (seed % 58);
  const scale = compact ? 'scale-[1.08]' : 'scale-[1.16]';

  return (
    <div
      data-template-art={preset.id}
      className="absolute inset-0 isolate overflow-hidden text-white"
      style={{ background: preset.bg }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-90"
        style={{
          background: [
            `radial-gradient(circle at ${glowX}% ${glowY}%, rgba(255,255,255,.42), transparent 24%)`,
            `radial-gradient(circle at ${100 - glowX}% ${100 - glowY}%, rgba(104,255,225,.2), transparent 32%)`,
            `repeating-linear-gradient(${angle}deg, transparent 0 22px, rgba(255,255,255,.055) 23px 24px)`,
          ].join(','),
        }}
      />
      <div
        aria-hidden
        className={`absolute size-[70%] rounded-full border border-white/25 ${scale}`}
        style={{ left: `${orbitX - 32}%`, top: `${orbitY - 30}%`, boxShadow: '0 0 90px rgba(255,255,255,.12), inset 0 0 70px rgba(255,255,255,.08)' }}
      />
      <div
        aria-hidden
        className="absolute -end-[18%] bottom-[8%] h-[18%] w-[82%] -skew-y-6 border-y border-white/20 bg-white/10 backdrop-blur-sm"
      />
      <div aria-hidden className="absolute end-[7%] top-[7%] font-vx text-[clamp(72px,13vw,168px)] font-black leading-none text-white/[.09]">V</div>
      <div className={`absolute inset-0 flex flex-col justify-between ${compact ? 'p-5' : 'p-7 sm:p-10'}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-white/80 sm:text-[11px]">{eyebrow}</span>
          <span className="rounded-full border border-white/25 bg-black/10 px-2.5 py-1 font-vx-mono text-[9px] font-bold tracking-[0.12em] text-white/75 backdrop-blur-sm">
            {preset.category}
          </span>
        </div>
        <div>
          <div className="mb-3 flex items-center gap-2 font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-white/70">
            <span>{preset.model}</span>
            <span aria-hidden>·</span>
            <span>{preset.previewAspect || preset.aspect}</span>
          </div>
          <span className={`${compact ? 'text-[24px] sm:text-[28px]' : 'text-[40px] sm:text-[52px]'} block max-w-[12ch] font-extrabold leading-[0.92] tracking-tight drop-shadow-sm`}>
            {title}
          </span>
        </div>
      </div>
    </div>
  );
}
