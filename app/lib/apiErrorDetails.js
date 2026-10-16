/** Read both legacy string errors and the structured security/foundation contract. */
export function apiErrorDetails(body, status) {
  const error = body?.error;
  if (typeof error === 'string' && error) return { code: error, message: error };
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    return {
      code: typeof error.code === 'string' && error.code ? error.code : 'gateway_error',
      message: typeof error.message === 'string' && error.message ? error.message : `HTTP ${status}`,
    };
  }
  return { code: 'gateway_error', message: `HTTP ${status}` };
}
