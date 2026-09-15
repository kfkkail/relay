# Initial loading splash proposal

## Recommendation

Add a root Next.js loading boundary that shows a small, branded Relay splash as soon as the application shell can render. It should remain visible while the server checks the session and loads tasks, workers, and owner actions, then disappear automatically when the sign-in, setup, or dashboard screen is ready.

Keep the splash lightweight and honest: a Relay mark, the product name, an indeterminate activity indicator, and “Loading your Relay…” are enough. Do not impose a minimum display time or animate a fake percentage. Fast launches should stay fast.

The installed PWA's operating-system launch screen and the in-app loading state are separate layers. The existing manifest already supplies a matching warm background color, but the OS-controlled screen ends when the first document paints. The proposed loading boundary owns the interval after that first paint and before Relay's server-rendered content is available.

## User experience

On a cold PWA launch, the user should see this sequence:

1. The platform displays its native launch treatment using Relay's manifest metadata.
2. Relay paints a full-viewport warm-paper screen with the existing forest “R” mark.
3. A subtle indeterminate indicator and “Loading your Relay…” confirm that startup is still in progress.
4. The splash is replaced directly by the appropriate destination: setup, sign-in, or the authenticated dashboard.

The splash should use the current application palette (`--paper`, `--forest`, `--ink`, and `--ink-soft`) so the native background, loading screen, and destination feel continuous. It must cover the full dynamic viewport and safe areas, including overscroll, without a white flash. The mark should be centered slightly above the visual midpoint, with the status immediately below it.

Animation should be restrained: a small orbit or spinner can rotate continuously, while the logo remains still. Under `prefers-reduced-motion: reduce`, replace rotation with a static indicator; loading text continues to communicate state. The status should be exposed as a polite screen-reader status, but decorative artwork should be hidden from accessibility APIs.

No cancel, retry, navigation, or sign-in control belongs on this transient screen. A load failure should eventually be represented by a separate actionable error state, not by changing the loading message or leaving an apparently active spinner forever.

## Technical design

### Loading boundary

Add `app/loading.tsx`. In the App Router, this file becomes the root route segment's Suspense fallback and can be sent before the asynchronous work in `app/page.tsx` completes. That work currently includes `supabase.auth.getUser()` followed by three parallel database queries, which is the interval most likely to make a cold launch look blank.

The component should be server-renderable static markup. It does not need `"use client"`, React state, timers, effects, Lucide, or another dependency. A suggested structure is:

```tsx
export default function Loading() {
  return (
    <main className="launch-splash" aria-busy="true">
      <div className="launch-splash__content" role="status" aria-live="polite">
        <div className="launch-splash__mark" aria-hidden="true">R</div>
        <div className="launch-splash__indicator" aria-hidden="true" />
        <p>Loading your Relay…</p>
      </div>
    </main>
  );
}
```

Style these classes in `app/globals.css`. Use `min-height: 100dvh` with a `100vh` fallback, safe-area-aware padding, and the root background color. Keep the animation CSS-only and disable it in the stylesheet's existing `prefers-reduced-motion` block. The component must not depend on client hydration to become visible or to disappear.

### First-paint continuity

Retain `#f3f0e8` as the manifest `background_color`, document theme color, `html` background, `body` background, and splash background. These values already agree. This is important because any mismatch is visible as a flash during the handoff from native PWA chrome to the streamed page.

Keep `app/manifest.ts` as the source of PWA launch metadata. The application loading boundary should not try to reproduce platform-specific launch images. As a follow-up compatibility check, verify the installed icon on target iOS and Android versions; the current manifest provides only `/icon.svg`, and platform support for SVG and maskable icons varies. If testing finds a platform using a generic icon, add generated PNG icon sizes and an Apple touch icon in a separate asset-focused change. That is not required to deliver the in-app splash.

### Error behavior

The splash should exist only while Next.js considers the route pending. Add or verify a root error boundary (`app/error.tsx`) as part of the implementation so a rejected startup request becomes an explicit “Relay couldn't load” screen with a Retry action. This prevents an error from being perceived as endless loading. The error UI should reuse the same full-viewport shell but must not look animated or still busy.

The current service worker intentionally ignores navigation requests, so it cannot serve the loading page or dashboard while offline. Do not describe this change as offline launch support. A true offline shell would require a navigation caching and data-consistency design beyond this request.

## Tradeoffs

- A root `loading.tsx` is idiomatic, small, and covers both cold loads and future route-level suspense, but it cannot control the OS-native screen before the browser begins painting Relay's document.
- Static CSS and markup appear without hydration and have negligible runtime cost, but the visual must stay simple because application data and authentication state are not available yet.
- An indeterminate indicator accurately communicates unknown duration. It is less informative than progress, but the current startup work exposes no meaningful completion percentage.
- A branded loading state improves perceived responsiveness but does not reduce the underlying Supabase latency. Startup query performance should still be monitored independently.
- Adding a root error boundary slightly broadens implementation scope, but it is the necessary terminal counterpart to a loading state and avoids an indefinite-spinner failure mode.

## Rollout and validation

Ship this as a presentation-only change with no feature flag, database migration, API change, or service-worker cache-version change. Because the loading component contains no user or task data, it can be shown before authentication safely.

Before release:

1. Run lint, unit tests, and a production build.
2. Use network throttling to verify that the splash appears during a cold authenticated launch and transitions to the dashboard without a white or blank frame.
3. Repeat for signed-out and missing-configuration states; the splash must transition to `SignIn` and `SetupPanel` respectively.
4. Verify a warm launch does not acquire an artificial delay or distracting flash.
5. Install the PWA on supported iOS and Android devices and check native-to-web color continuity, safe areas, portrait layout, and overscroll.
6. Test with reduced motion and a screen reader. The loading message should be announced once, decorative elements should be ignored, and no continuously updating announcement should occur.
7. Simulate a failed startup request and confirm the error boundary replaces the splash with a Retry action.

After release, compare startup error rate and server response time before and after the change. The proposal should not regress those metrics; its primary success signal is the absence of a visually blank startup interval in manual and browser-level tests.

## Acceptance criteria

1. A cold browser or installed-PWA launch shows Relay-branded feedback instead of a blank page while authentication and initial data are pending.
2. The loading state can render before client-side JavaScript hydrates and adds no new runtime dependency.
3. The splash transitions automatically to setup, sign-in, or dashboard content and never enforces a minimum duration.
4. The native launch background, document background, and splash background match, with no white flash across the handoff on supported target devices.
5. The layout fills the dynamic viewport, respects device safe areas, and remains centered at mobile and desktop sizes.
6. Loading status is accessible, decorative animation is not announced, and reduced-motion users receive a non-rotating treatment.
7. A startup failure produces an actionable error state rather than an indefinitely animated loading screen.
8. Offline behavior is unchanged and is not represented as supported by this feature.
9. Lint, tests, and the production build pass.

## Deferred scope

Offline navigation caching, background synchronization, query-performance work, platform-specific launch images, a new logo system, skeleton versions of the authenticated dashboard, and progress reporting are intentionally deferred. They solve related but distinct problems and are not needed to replace the current blank startup interval.
