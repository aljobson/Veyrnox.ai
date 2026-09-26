// Auth callback HTML must match the request's nonce (ADR-0060).
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }) {
    return children;
}
