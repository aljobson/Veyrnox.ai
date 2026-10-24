import FacelessReelStudio from '../../_components/FacelessReelStudio';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';

export default function FacelessReelPage() {
  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav active="create" />
      <Main className="mx-auto max-w-[1320px] px-4 pb-20 pt-8 sm:px-8 sm:pt-12">
        <FacelessReelStudio />
      </Main>
    </div>
  );
}
