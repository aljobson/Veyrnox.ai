import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import OddlingStudio from '../../_components/OddlingStudio';

export default function OddlingsPage() {
  return (
    <div className="min-h-dvh bg-vx-base">
      <AppNav active="oddlings" />
      <Main>
        <OddlingStudio />
      </Main>
    </div>
  );
}
