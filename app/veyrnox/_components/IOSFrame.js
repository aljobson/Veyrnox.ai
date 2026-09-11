// iPhone bezel — 390pt logical width, mobile-web wrapper for the /veyrnox/m/* screens.
// Simplified from the design handoff's ios-frame.jsx.
export function IOSFrame({ children }) {
  return (
    <div className="mx-auto" style={{ width: 430, maxWidth: '100%' }}>
      <div
        className="relative mx-auto rounded-[54px] border border-[#2a2a2f] bg-[#0A0A0B] shadow-2xl overflow-hidden"
        style={{ width: 430, height: 900 }}
      >
        {/* Dynamic Island */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 h-8 w-32 rounded-full bg-black z-30 flex items-center justify-between px-4">
          <div className="h-2 w-2 rounded-full bg-[#1a1a1a]" />
          <div className="h-2 w-2 rounded-full bg-[#1a1a1a]" />
        </div>
        {/* Status bar */}
        <div className="absolute top-0 inset-x-0 h-12 flex items-center justify-between px-8 z-20 text-white font-muon text-[13px] font-semibold">
          <span className="muon-num">9:41</span>
          <span className="flex items-center gap-1.5 text-[11px]">
            <span>􀙇</span><span>􀛨</span><span>􀛩</span>
          </span>
        </div>
        {/* Content */}
        <div className="absolute inset-0 pt-12 pb-8 flex flex-col">
          {children}
        </div>
        {/* Home indicator */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 h-1.5 w-32 rounded-full bg-white/60 z-20" />
      </div>
    </div>
  );
}
