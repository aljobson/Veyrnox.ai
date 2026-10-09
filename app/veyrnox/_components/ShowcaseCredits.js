import { SHOWCASE_SOURCES } from '../_lib/showcase';

export function ShowcaseCredits() {
  return (
    <p className="mt-4 text-xs leading-relaxed text-vx-fg-muted">
      Viral inspiration from{' '}
      {SHOWCASE_SOURCES.map((source, index) => (
        <span key={source.url}>
          {index > 0 && ' and '}
          <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-vx-fg">
            {source.name}
          </a>
        </span>
      ))}.
    </p>
  );
}
