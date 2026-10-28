# Testing

```sh
npm test            # Vitest unit + DOM-fixture tests (jsdom)
npm run build       # required before e2e: tests load dist/
npm run test:e2e    # Playwright: real Chromium with the built extension loaded
npm run check       # lint + typecheck + unit + build
```

The first Playwright run needs a browser: `npx playwright install chromium`. Locally it installs into `.pw-browsers/` (gitignored, set in `playwright.config.ts`).

## What each layer proves

| Layer | Runs against | Proves | Does **not** prove |
|---|---|---|---|
| Unit (`tests/unit`) | jsdom + in-memory `chrome.storage` mock | Rule engine, schema/migration, adapter parsing, observer logic, cleanup | Real browser behaviour |
| E2E (`tests/e2e`) | Chromium + built `dist/` + **static fixture** served at `https://chatgpt.com` via request interception | Manifest, permissions, content script injection, picker, popup, messaging, storage, multi-tab, themes | Compatibility with the live ChatGPT site |
| Live check (manual, see QA report) | Real chatgpt.com, logged in | Selectors and URL formats match the real sidebar | — |

**Fixture tests are not evidence of live-site compatibility.** The fixtures (`tests/fixtures/`) copy the containers verified on the live page (`aside#ds-sidebar`, `nav[data-slot="sidebar-history"]`). Row markup is an approximation.

## Coverage map

| Requirement | Test |
|---|---|
| Conversation ID extraction (`/c/`, Project `/g/g-p-…/c/`, custom GPT `/g/g-…/c/`, rejects others) | `adapter.test.ts` |
| Manual override precedence, NONE, fallback | `rules.test.ts`, e2e "in-row control" |
| Keyword matching (case-insensitive, multi-keyword) and rule priority | `rules.test.ts`, e2e "popup" |
| Title changes (`textContent` and `characterData`) | `colorizer.test.ts`, e2e "in-row control" |
| Title extraction ignores row buttons | `adapter.test.ts` |
| Dynamic sidebar updates / lazy load | `colorizer.test.ts` |
| Duplicate decoration prevention | `adapter.test.ts`, `colorizer.test.ts` |
| Sidebar removal and reinsertion; late appearance | `colorizer.test.ts` |
| Recycled rows (href change) | `colorizer.test.ts` |
| Storage persistence / reload | `storage.test.ts`, e2e reload |
| Import/export, invalid import | `schema.test.ts`, e2e "popup" |
| Schema migration, newer-version refusal, malformed data | `schema.test.ts`, `storage.test.ts` |
| Invalid color values | `schema.test.ts`, e2e "rejects invalid custom HEX" |
| Enable/disable cleanup, no layout shift | `colorizer.test.ts`, e2e "colors rows" |
| Keyboard accessibility | `adapter.test.ts`, e2e "keyboard" |
| Light/dark themes, palette contrast ≥ 3:1 | `rules.test.ts`, e2e theme tests |
| Multiple ChatGPT tabs | `storage.test.ts`, e2e "multiple tabs" |
| Popup messaging without the `tabs` permission | e2e "popup <-> content messaging" |
| Unsupported DOM layouts | `adapter.test.ts`, `colorizer.test.ts` |
