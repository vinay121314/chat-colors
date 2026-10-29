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
| E2E (`tests/e2e`) | Chromium + built `dist/` + **static fixture** served at `https://chatgpt.com` via request interception | Manifest, permissions, content script injection, popup (all tabs), messaging, storage, multi-tab, themes, no overlap with native controls | Compatibility with the live ChatGPT site |
| Live check (manual, see QA report) | Real chatgpt.com, logged in | Selectors and URL formats match the real sidebar | — |

Two fixture pages, both shared through `tests/e2e/harness.ts`:

- **`chatgpt-live.html`** (`live-structure.spec.ts`): copies the structure **verified on the logged-in site** (`aside[data-app-shell-left-panel-appearance]` › `role="listitem"` wrapper › `<a aria-current>` plus a native "…" menu button). The menu's position is an approximation.
- **`chatgpt.html`** (`extension.spec.ts`): the original layout, including a title-only link row. It stays as fallback coverage.

**Fixture tests are not evidence of live-site compatibility.**

## Coverage map

| Requirement | Test |
|---|---|
| Conversation ID extraction (`/c/`, Project `/g/g-p-…/c/`, custom GPT `/g/g-…/c/`, rejects others) | `adapter.test.ts` |
| Manual override precedence, NONE, fallback | `rules.test.ts`, e2e "Chats tab: color a chat that is NOT open" |
| Coloring any sidebar chat from the popup (`list()`, Chats tab, search, keyboard) | `colorizer.test.ts`, e2e "Chats tab" ×2 |
| No interactive element injected; native three-dot menu on top in all modes; link navigates | `adapter.test.ts`, `colorizer.test.ts`, live-structure e2e |
| Open-chat outline: follows navigation and Back/Forward; color/HEX/width/opacity/Auto/off; invalid HEX | `adapter.test.ts`, `colorizer.test.ts`, `schema.test.ts`, live-structure e2e |
| Keyword matching (case-insensitive, multi-keyword) and rule priority | `rules.test.ts`, e2e "popup" |
| Title changes (`textContent` and `characterData`) | `colorizer.test.ts`, e2e "Chats tab" |
| Title extraction ignores row buttons | `adapter.test.ts` |
| Dynamic sidebar updates / lazy load | `colorizer.test.ts` |
| Duplicate decoration prevention | `adapter.test.ts`, `colorizer.test.ts` |
| Sidebar removal and reinsertion; late appearance | `colorizer.test.ts` |
| Recycled rows (href change) | `colorizer.test.ts` |
| Storage persistence / reload | `storage.test.ts`, e2e reload |
| Import/export, invalid import | `schema.test.ts`, e2e "popup" |
| Schema migration, newer-version refusal, malformed data | `schema.test.ts`, `storage.test.ts` |
| Invalid color values | `schema.test.ts`, e2e "invalid HEX" (Chats tab and outline) |
| Enable/disable cleanup, no layout shift | `colorizer.test.ts`, e2e "colors rows", live-structure "no layout shift" |
| Keyboard accessibility | e2e "Chats tab … keyboard operable", "popup tabs are keyboard navigable" |
| Light/dark themes, palette contrast ≥ 3:1 | `rules.test.ts`, e2e theme tests |
| Multiple ChatGPT tabs | `storage.test.ts`, e2e "multiple tabs" |
| Popup messaging without the `tabs` permission | e2e "popup <-> content messaging" |
| Unsupported DOM layouts | `adapter.test.ts`, `colorizer.test.ts` |
