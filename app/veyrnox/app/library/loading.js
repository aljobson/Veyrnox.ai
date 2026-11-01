import { Main } from '../../_components/Main';

// Route-level skeleton for Library: a grid of tile-shaped placeholders so the
// page does not jump when the real grid replaces it. Same shimmer as the
// marketing shell's loading.js.
export default function Loading() {
  return (
    <Main className="mx-auto max-w-[1300px] px-4 sm:px-6 pt-8" aria-busy="true">
      <div aria-hidden="true" className="vx-shimmer bg-vx-panel h-8 w-48 rounded-full" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} aria-hidden="true" className="vx-shimmer bg-vx-panel aspect-square rounded-2xl" />
        ))}
      </div>
    </Main>
  );
}
