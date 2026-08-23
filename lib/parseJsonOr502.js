// Shared upstream response guard used by API proxy routes. If the upstream
// returns something that isn't JSON (HTML error page, empty body, gateway
// error), we surface a generic 502 instead of leaking whatever text came back
// or throwing an unhandled error into the client.
export async function parseJsonOr502(response, context = '') {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        console.error(`[proxy] upstream non-JSON ${response.status} for ${context}`);
        return { data: { error: 'Bad upstream response' }, status: 502 };
    }
    try {
        return { data: await response.json(), status: response.status };
    } catch (err) {
        console.error(`[proxy] JSON parse error for ${context}:`, err.message);
        return { data: { error: 'Bad upstream response' }, status: 502 };
    }
}
