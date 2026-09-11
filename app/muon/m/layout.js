import { IOSFrame } from '../_components/IOSFrame';
import { MobileJumps } from './_MobileNav';

// Mobile-web wrapper: iPhone bezel for desktop viewing, jumps strip up top.
export default function MobileLayout({ children }) {
  return (
    <div className="min-h-dvh flex flex-col items-center py-6">
      <MobileJumps />
      <IOSFrame>{children}</IOSFrame>
    </div>
  );
}
