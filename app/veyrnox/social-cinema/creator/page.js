import Link from 'next/link';
import { AccountBoundary } from '../../_components/AccountBoundary';
import { CreatorWorkspace } from './CreatorWorkspace';
export const metadata = { title: 'Creator workspace — Veyrnox Cinema', robots: { index: false } };
export default function CreatorPage() {
  return <main id="main" className="mx-auto max-w-[1100px] px-4 py-10 pb-40 sm:px-8">
    <Link href="/social-cinema" className="text-sm text-vx-accent hover:underline">← Social Cinema</Link>
    <h1 className="mt-6 text-3xl font-black sm:text-4xl">Creator workspace</h1>
    <p className="mt-4 max-w-2xl text-vx-fg-body">Develop your films and series in private. Uploading, review and publishing will follow in a later release.</p>
    <AccountBoundary><CreatorWorkspace /></AccountBoundary>
  </main>;
}
