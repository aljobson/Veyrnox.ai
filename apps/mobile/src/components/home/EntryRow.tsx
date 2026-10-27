import { Link, type Href } from 'expo-router';
import { ListRow } from '../ui';

// One calm row for a place you can go: a title, an optional line under it, and a chevron. Hairlines, no fill, so the
// page has one thing that is lit at a time.
export function EntryRow({ href, title, body, hint }: { href: Href; title: string; body?: string; hint?: string }) {
    return (
        <Link href={href} asChild>
            <ListRow title={title} subtitle={body} accessibilityHint={hint} />
        </Link>
    );
}

