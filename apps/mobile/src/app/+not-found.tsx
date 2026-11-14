import { Redirect } from 'expo-router';

// A path with no screen (a stale or mistyped link) never shows Expo Router's own "Unmatched Route" page: it goes to
// the root, which sends a signed-in person to the tabs and anyone else to sign-in. It renders no text of its own.
export default function NotFound() {
    return <Redirect href="/" />;
}
