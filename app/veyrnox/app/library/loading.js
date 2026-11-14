import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { LibrarySkeleton } from '../../_components/LibraryAccessState';

// Route-level skeleton for Library: the same nav and placeholder the page shows
// before it has read the session, so nothing moves between the two.
export default function Loading() {
  return (
    <div className="min-h-dvh">
      <AppNav active="library" readAccount={false} />
      <Main aria-busy="true"><LibrarySkeleton page /></Main>
    </div>
  );
}
