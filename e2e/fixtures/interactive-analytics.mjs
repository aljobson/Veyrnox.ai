// Model an interactive navigator only inside the fail-closed loopback fixture.
export async function installInteractiveAnalyticsNavigator(context, origin) {
  if (!/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/.test(origin || ''))
    throw new Error('Interactive analytics fixtures require exact loopback HTTP');
  await context.addInitScript(() => {
    // The SDK deliberately suppresses webdriver / HeadlessChrome events.
    // Exercise its interactive-visitor path without disabling sanitization or
    // changing production SDK configuration. The harness blocks all outbound
    // requests and fulfills every analytics transport before the local proxy.
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false });
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => undefined });
  });
}
