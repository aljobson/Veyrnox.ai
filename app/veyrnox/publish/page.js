import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';

export const metadata = {
  title: 'Veyrnox.ai Publish',
  description: 'Make it in Veyrnox.ai, schedule it to YouTube, LinkedIn, X and TikTok, and track the results. One login, no exporting and re-uploading.',
  alternates: { canonical: '/publish' },
  openGraph: { title: 'Veyrnox.ai Publish: make it here, schedule it everywhere', url: '/publish' },
};

const MONDAY = [
  ['9:00 AM', 'Short goes to YouTube'],
  ['9:01 AM', 'Clip goes to TikTok'],
  ['9:02 AM', 'Post goes to X'],
  ['9:02 AM', 'Update goes to LinkedIn'],
];

const FEATURES = [
  ['A calendar you can drag', 'Month, week and list views. Move a post and confirm the new time. A Reschedule button gives a keyboard and touch path.'],
  ['Draft review', 'Approve or discard drafts before anything goes out.'],
  ['Approval links', 'Send a post to a reviewer or client with a link. They approve it without an account.'],
  ['Queues and saved presets', 'Save the captions and accounts you reuse. Add a post to a queue and it takes the next slot.'],
  ['RSS autolists', 'Point Publish at a feed and new items are scheduled for you.'],
  ['One inbox', 'Comments and messages from your connected accounts in a single list, with reply suggestions, labels and assignment.'],
  ['Analytics', 'Followers, growth and your best posts. The Publish Plan keeps 366 days of history and shows the best times to post.'],
  ['SmartLink', 'A link-in-bio page with click counts.'],
  ['Brands and teams', 'Separate brands, roles for teammates, and approval flows for clients.'],
  ['Reports and API', 'Scheduled and exported reports, plus a customer API and webhooks for your own tools.'],
];

const PLANS = [
  ['Price', '$0', '$15 / month'],
  ['Connected accounts', '1', '5'],
  ['Post now', 'Yes', 'Yes'],
  ['Scheduling', 'No', 'Yes'],
  ['Analytics history', 'Basic', '366 days + best-time recommendations'],
];

const FAQ = [
  ['Is the Publish Plan separate from credits?', 'Yes. Credits pay for generation. The Publish Plan pays for scheduling, extra accounts and analytics history. Neither ever pays for the other.'],
  ['Which networks work today?', 'YouTube, LinkedIn, X and TikTok. More are built and are switched on as each platform finishes its review.'],
  ['How many accounts can I connect?', 'One on Free and five on the Publish Plan.'],
  ['Can I use it for client work?', 'Yes. Keep separate brands, give teammates roles, and send clients approval links.'],
  ['Does it post automatically?', 'Yes, at the time you schedule. If a network refuses a post you are told why, and you can reschedule it.'],
];

const link = 'font-bold underline underline-offset-4 hover:text-vx-accent';

export default function PublishPage() {
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-28">
        <article className="max-w-[860px]">
          <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">Veyrnox.ai Publish</p>
          <h1 className="vx-display vx-title-index mt-5">Make it here. Schedule it everywhere.</h1>
          <p className="mt-7 text-lg sm:text-xl text-vx-fg-body leading-[1.6]">
            Generate the video or image, write the caption, pick the days, and Publish posts it to your accounts. One tab, one login, no exporting and re-uploading.
          </p>
          <p className="mt-8">
            <Link href="/app/publish" className="inline-block border-2 border-vx-fg px-6 py-3 font-black hover:text-vx-accent">Start free</Link>
            <span className="ml-4 text-[14px] text-vx-fg-muted">One account and Post now are free.</span>
          </p>

          <section className="mt-20 border-t-2 border-vx-fg pt-6" aria-labelledby="load-once">
            <h2 id="load-once" className="text-2xl font-black">Load it once. Let it run.</h2>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">
              Pick a finished asset from your Veyrnox.ai library, or upload your own. Choose the accounts. Choose the day and time. Change the caption for a network if it should differ.
            </p>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">
              Then close the laptop. Publish sends the post at the time you set and tells you if a network refuses it. Ten minutes on a Monday instead of a little every day.
            </p>
          </section>

          <section className="mt-14" aria-labelledby="monday">
            <h2 id="monday" className="text-2xl font-black">Monday, 9:00 AM. You are still on your first coffee.</h2>
            <ul className="mt-6 border-t border-vx-border">
              {MONDAY.map(([time, what]) => (
                <li key={what} className="grid gap-1 border-b border-vx-border py-4 sm:grid-cols-[120px_1fr] sm:gap-6">
                  <span className="font-vx-mono text-[14px] text-vx-fg-muted">{time}</span>
                  <span className="text-vx-fg-body">{what}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-20 border-t-2 border-vx-fg pt-6" aria-labelledby="more">
            <h2 id="more" className="text-2xl font-black">Everything around the posting</h2>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">
              Posting is the start. The generation, the schedule, the approval and the numbers sit under one login.
            </p>
            <dl className="mt-6 border-t border-vx-border">
              {FEATURES.map(([name, text]) => (
                <div key={name} className="grid gap-1 border-b border-vx-border py-4 sm:grid-cols-[220px_1fr] sm:gap-6">
                  <dt className="font-bold">{name}</dt>
                  <dd className="text-vx-fg-body leading-[1.6]">{text}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-20 border-t-2 border-vx-fg pt-6" aria-labelledby="plans">
            <h2 id="plans" className="text-2xl font-black">Pricing</h2>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[480px] border-t border-vx-border text-left">
                <thead>
                  <tr className="border-b border-vx-border">
                    <th scope="col" className="py-3 pr-4 font-normal text-vx-fg-muted"><span className="sr-only">Feature</span></th>
                    <th scope="col" className="py-3 pr-4 font-black">Free</th>
                    <th scope="col" className="py-3 font-black">Publish Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {PLANS.map(([label, free, paid]) => (
                    <tr key={label} className="border-b border-vx-border">
                      <th scope="row" className="py-3 pr-4 font-normal text-vx-fg-muted">{label}</th>
                      <td className="py-3 pr-4 text-vx-fg-body">{free}</td>
                      <td className="py-3 text-vx-fg-body">{paid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">
              The Publish Plan is its own subscription. It never touches your generation credits. See <Link className={link} href="/pricing">credit pricing</Link> for generation.
            </p>
          </section>

          <section className="mt-20 border-t-2 border-vx-fg pt-6" aria-labelledby="faq">
            <h2 id="faq" className="text-2xl font-black">Questions</h2>
            <dl className="mt-6 border-t border-vx-border">
              {FAQ.map(([q, a]) => (
                <div key={q} className="border-b border-vx-border py-5">
                  <dt className="font-bold">{q}</dt>
                  <dd className="mt-2 text-vx-fg-body leading-[1.65]">{a}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-10">
              <Link href="/app/publish" className="inline-block border-2 border-vx-fg px-6 py-3 font-black hover:text-vx-accent">Start free</Link>
            </p>
          </section>
        </article>
      </Main>
    </div>
  );
}
