import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import PublishPlanPanel from './PublishPlanPanel';

export const metadata = {
  title: 'Publish plans and billing',
  description: 'Manage your Veyrnox Publish plan and billing.',
  robots: { index: false },
};

export default function PublishPlanPage() {
  return <><AppNav /><Main className="mx-auto max-w-[900px] px-4 py-10 sm:px-8">
    <h1 className="text-3xl font-black">Plans and billing</h1>
    <p className="mb-6 mt-2 text-sm text-vx-fg-muted">Manage advanced Publish features and Stripe billing.</p>
    <PublishPlanPanel />
  </Main></>;
}
