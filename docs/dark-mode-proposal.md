# Dark mode proposal

## Summary

Add a dark appearance that follows the operating-system preference automatically. Relay should remain light when the system is light and switch immediately when the system is dark, including when that preference changes while Relay is open.

This should be implemented with CSS `prefers-color-scheme`, not React state or persisted preferences. There is no theme control, cookie, local storage value, database field, or server-side preference. The approach works before React hydrates, avoids a light-theme flash, and leaves the system as the single source of truth.

## Product behavior

- Follow `prefers-color-scheme: dark` on the sign-in, setup, task list, task detail, My Work, sheets, forms, results, and error/empty states.
- Apply preference changes without a reload. The CSS media query provides this behavior without an event listener.
- Keep the current light appearance as the light palette. Dark mode should preserve Relay's warm paper-and-forest character rather than becoming neutral black and gray.
- Do not add a settings surface or manual override. A user who wants a different appearance changes the system preference.
- Keep task status meaning consistent in both modes: gold for ready, blue for working, coral for waiting/error, and green for done/accepted.
- Allow user-provided attachment images and result content to retain their original colors; only Relay-owned surrounding surfaces and controls change.

## Technical design

### Semantic color tokens

Normalize the color layer in `app/globals.css` before adding the dark override. The current stylesheet has useful root variables, but it also contains literal white backgrounds, light translucent overlays, status surfaces, form colors, and shadows. Those literals would remain bright in a partial dark-mode implementation.

Introduce or standardize tokens by role rather than component:

| Role               | Light     | Proposed dark | Used for                             |
| ------------------ | --------- | ------------- | ------------------------------------ |
| `--canvas`         | `#f3f0e8` | `#111714`     | page background                      |
| `--canvas-muted`   | `#e9e4d8` | `#18211d`     | inset and subdued backgrounds        |
| `--surface`        | `#fbfaf6` | `#1d2723`     | cards, panels, sheets                |
| `--surface-raised` | `#ffffff` | `#25312c`     | controls and emphasized result areas |
| `--text`           | `#17352e` | `#edf3ef`     | primary text                         |
| `--text-muted`     | `#52635e` | `#aab8b1`     | secondary text                       |
| `--border`         | `#d8d3c7` | `#3a4842`     | dividers and control borders         |
| `--primary`        | `#173f35` | `#9bc8b3`     | primary action and selected state    |
| `--on-primary`     | `#fffaf0` | `#10251d`     | content on primary actions           |
| `--accent`         | `#e76f51` | `#ff8e72`     | waiting and attention accents        |
| `--link`           | `#3f6e81` | `#83bed4`     | links and interactive text           |

Add semantic tokens for the four status foreground/background pairs, danger foreground/background, focus ring, scrim, translucent sticky bars, and shadows. Exact colors should be adjusted during visual review to meet WCAG AA; the table is the implementation starting point, not a reason to preserve a failing contrast value.

Existing names such as `--paper` and `--ink` can either be migrated directly or temporarily alias the new tokens. The end state should ensure every Relay-owned color in the stylesheet comes from a token, including `rgba(...)` values that currently encode the light ink color.

### System preference and native controls

Declare the light values in `:root`, then override only color tokens:

```css
:root {
  color-scheme: light dark;
  /* light tokens */
}

@media (prefers-color-scheme: dark) {
  :root {
    /* dark token overrides */
  }
}
```

`color-scheme: light dark` tells the browser that both schemes are supported, so built-in form widgets, scrollbars, selection UI, and other native surfaces choose appropriate colors. Relay's explicit input and select styles must still use tokens so browser differences do not create white fields in dark mode.

No client component, inline boot script, `suppressHydrationWarning`, or theme dependency is needed.

### Browser and installed-PWA chrome

Update `app/layout.tsx` so Next.js emits two theme-color declarations:

```ts
themeColor: [
  { media: "(prefers-color-scheme: light)", color: "#f3f0e8" },
  { media: "(prefers-color-scheme: dark)", color: "#111714" },
],
colorScheme: "light dark",
```

This lets supported browsers update the address bar and standalone window chrome with the system theme. Keep the manifest's `background_color` and `theme_color` as light fallbacks because web app manifests do not provide a broadly reliable media-query mechanism. The document-level media-aware theme colors take precedence while the app is running.

Keep `appleWebApp.statusBarStyle` as `black-translucent` for the first release and verify it on an installed iOS PWA. The existing icon can remain unchanged: its forest tile, cream glyph, and coral dot are intentionally branded and readable in either scheme.

## Component coverage

The implementation review should explicitly cover:

- page canvas, sticky top bar, centered navigation, desktop split pane, and mobile detail bar;
- task cards, selection, filter pills, status pills, accepted state, owner actions, and overdue/danger actions;
- Markdown headings, links, inline code, fenced code, blockquotes, tables, and artifact disclosure panels;
- result, running, error, token, privacy, and empty states;
- inputs, textareas, selects, search, attachment picker/previews, focus rings, disabled states, and autofill;
- modal scrim, sheets, toast, shadows, hover states, and keyboard focus states;
- sign-in and setup pages; and
- safe-area regions and overscroll backgrounds in browser and installed-PWA modes.

Markdown deserves particular care because the result section currently forces white and the body copy uses a literal dark color. Code blocks should remain visibly distinct from their containing surface, and syntax-free code must retain at least AA contrast.

## Delivery plan

### Phase 1: normalize colors

1. Add the semantic light tokens without changing the intended light appearance.
2. Replace literal component colors and light-specific translucent values with tokens.
3. Check the light UI for regressions before introducing dark overrides. This makes later defects attributable to palette choices rather than an incomplete migration.

### Phase 2: add system dark mode

1. Add the dark token values under `prefers-color-scheme: dark` and declare both supported color schemes.
2. Add media-aware viewport theme colors and preserve manifest fallbacks.
3. Tune hover, focus, disabled, border, shadow, and scrim treatment for dark surfaces instead of only swapping foreground/background colors.

### Phase 3: validate

1. Run lint, unit tests, and a production build.
2. Check contrast for normal text, muted text, links, button labels, every status pill, errors, and focus indicators against WCAG AA (4.5:1 for normal text and 3:1 for large text and non-text UI boundaries).
3. Manually exercise light, dark, and a live system-theme change at mobile and desktop widths in Safari and Chrome.
4. Verify installed-PWA launch, browser chrome, safe areas, native form controls, autofill, scrolling/overscroll, and reduced-motion mode on iOS and at least one desktop platform.
5. Capture matching light/dark screenshots of the sign-in page, task list with every status, task detail with Markdown/result content, My Work, and each sheet. If visual regression testing is later introduced, these views are the initial baseline set.

## Acceptance criteria

1. With no Relay preference stored, every supported screen matches the current operating-system light or dark appearance from first paint.
2. Changing the system appearance while Relay is open updates the interface without a reload and without React work.
3. No Relay-owned card, input, result section, sheet, sticky bar, or state panel remains unintentionally white in dark mode.
4. Text, controls, status states, links, focus indicators, and errors meet WCAG AA contrast in both schemes.
5. Browser and installed-PWA chrome use the matching theme color where the platform supports media-aware theme colors; unsupported platforms receive the existing light manifest fallback without breaking launch.
6. Light mode remains visually equivalent to the current design apart from deliberate contrast fixes.
7. Theme support adds no client-side state, user setting, persistence, hydration warning, or third-party dependency.
8. Lint, tests, and production build pass.

## Deferred scope

A manual light/dark/system selector, per-user persistence, scheduled themes, custom palettes, OLED-black mode, and user-selectable accent colors are intentionally excluded. They would require a precedence model and pre-hydration persistence strategy that the system-only requirement does not need.
