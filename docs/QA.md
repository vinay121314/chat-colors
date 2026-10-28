# QA report — v1.0.0 (2026-10-28)

## Automated results

| Check | Result |
|---|---|
| `npm run lint` (ESLint + bans on `innerHTML`/`eval`) | ✅ pass |
| `npm run typecheck` (TS strict, `noUncheckedIndexedAccess`) | ✅ pass |
| `npm test`: 91 Vitest tests, 5 files | ✅ 91/91 |
| `npm run build`: `dist/` ≈ 43 KB, no runtime deps | ✅ pass |
| `npm run test:e2e`: 9 Playwright tests, built extension in Chromium on the fixture page | ✅ 9/9 |

## Verified (fixture page in a real Chromium, extension loaded from `dist/`)

- Content script injects only on `https://chatgpt.com/*`, and colors only sidebar conversation links (`/c/`, `/g/g-p-…/c/`, `/g/g-…/c/`).
- No layout shift: every row's bounding box is identical with decoration on and off.
- Clicking the in-row control doesn't navigate and doesn't reach page-level click handlers.
- Manual color persists through a page reload and a title rename. Auto colors re-classify on rename.
- Custom HEX, Remove color, Reset to automatic, and invalid HEX rejection.
- Keyboard: Tab reaches the control after ChatGPT-style row buttons, Enter opens the picker, Escape closes it and returns focus.
- Two tabs update live from a single storage write.
- Popup ↔ content messaging works and the extension cannot see the ChatGPT tab's URL or title (no `tabs` permission).
- Popup: keyword add and toggle, priority reorder, preview, appearance sliders, export, invalid and valid import.
- Light and dark themes (popup tokens, borders visible). Palette contrast is ≥ 3:1 on #fff, #212121 and #171717 (unit test).

## Bugs found and fixed during QA

1. Row titles included the text of buttons inside the row (for example ChatGPT's "…" menu), which could cause wrong keyword matches. `getTitle` now skips text inside `button` and `[role=button]` elements. A regression test was added.
2. Escape didn't return focus to the in-row control, because the popover `toggle` event fires after focus has already moved to `<body>`. This is now handled on `beforetoggle`.

## Live chatgpt.com verification

| Item | Status |
|---|---|
| Sidebar container `aside#ds-sidebar` › `nav[data-slot="sidebar-history"][aria-label="Chat history"]` | ✅ Verified live (logged-out page, 2026-10-28) |
| Class names are generated atomic CSS and are not used | ✅ Verified live |
| Conversation row `<a href="/c/<uuid>">` with title text | ⏳ **UNVERIFIED** (no logged-in session yet) |
| Project / custom GPT URL formats | ⏳ **UNVERIFIED** |
| Native hover, selected and menu behaviour preserved | ⏳ **UNVERIFIED** on live site (verified on fixture) |
| Control position vs. native row menu | ⏳ **UNVERIFIED** |
| List virtualization | ⏳ **UNVERIFIED** |

Until these rows are checked against a logged-in session, **live ChatGPT compatibility is unverified.**
