# QA report — v1.0.0 (2026-10-28, revision 2)

## Automated results

| Check | Result |
|---|---|
| `npm run lint` (ESLint + bans on `innerHTML`/`eval`) | ✅ pass |
| `npm run typecheck` (TS strict, `noUncheckedIndexedAccess`) | ✅ pass |
| `npm test`: Vitest, 5 files | ✅ 97/97 |
| `npm run build`: no runtime deps | ✅ pass |
| `npm run test:e2e`: Playwright, built extension in Chromium on the fixture page | ✅ 14/14 |

## Revision 2: reported "colors not applied" and "UI looks cheap"

The root causes were likely but couldn't be confirmed without a logged-in session:

1. **Painting.** The colored edge was an inset `box-shadow` on the row link. Any child with an opaque background (typical for hover and selected states) covers it completely. It's now a dedicated overlay bar element (`z-index: 2`, `pointer-events: none`). A new e2e test covers the whole row with an opaque child and asserts the bar is still the top-most painted element.
2. **Detection.** The root was taken from a fixed container verified only while logged out. Now:
   - the root is derived from the conversation links themselves (inside an `<aside>` or navigation landmark) when the known containers hold none;
   - detection keeps retrying while zero rows are found;
   - conversation ids accept any URL-safe token, not only UUIDs.
3. **Visibility.** The popup header now reports "N chats detected" or "Sidebar not recognized". *Data → Copy diagnostics* produces a structure-only report: no titles, ids and slugs masked. Unit and e2e tests check that nothing private leaks.

UI redesign:
- **Popup:** tabbed (Conversation / Rules / Style / Data), with a token-based neutral design, custom switches, collapsible category rows, keyword chips, a live style preview, and empty states.
- **In-page picker:** redesigned, and its theme now follows ChatGPT's actual background color instead of the OS setting.

Bugs found during this revision:
- **Picker layout overflow.** `1fr` grid columns blew out to the content's width. Fixed with `minmax(0, 1fr)` and fixed-size swatches.
- **All popup tab panels visible at once.** An author `display: grid` overrode the UA `[hidden]` rule. Fixed, and an e2e test now asserts that inactive panels are hidden.

## Verified (fixture page in a real Chromium, extension loaded from `dist/`)

- Injects only on `https://chatgpt.com/*` and decorates only sidebar conversation links (`/c/`, `/g/g-p-…/c/`, `/g/g-…/c/`).
- The bar stays visible above opaque row content. No layout shift: row boxes are identical with decoration on and off.
- The in-row control never navigates. Manual colors persist through reload and rename, and auto colors re-classify on rename.
- Custom HEX, Remove, Reset, and invalid HEX rejected.
- Keyboard: Tab reaches the control, Enter opens it, Escape closes it and returns focus. Popup tabs follow the ARIA arrow-key pattern.
- Multi-tab live updates. Popup ↔ content messaging works without the `tabs` permission.
- Popup Conversation tab with an active ChatGPT tab: status "7 chats detected", automatic category badge, and manual color applied live.
- Light and dark themes for the popup and the picker. Palette contrast is ≥ 3:1 on light and dark sidebars.

## Live chatgpt.com verification

| Item | Status |
|---|---|
Source: a logged-in diagnostics report from the user's own Chrome (2026-10-29). That report summarized results; it did not include raw DOM.

| Item | Status |
|---|---|
| Sidebar root is `aside[data-app-shell-left-panel-appearance]`. The older `#ds-sidebar` / history-nav containers are absent when logged in. | ✅ Verified live. Now the first selector; the others remain as fallbacks. |
| Row = non-link wrapper `role="listitem"` + `data-sidebar-cycle-item` + `data-thread-title-trigger` (~266×37) around the `<a>` (~247 px) | ✅ Verified live. `rowBox()` prefers this wrapper. |
| Regular `/c/<uuid>` links detected and decorated (25 rows, 2 colored) | ✅ Verified live |
| Open chat's link has `aria-current="page"` | ✅ Verified live. Used by `activeRow()`, with the URL as fallback. |
| Navigation API available | ✅ Verified live |
| No unrecognized `/g/` links | ✅ Verified live (report) |
| **Project** chats and Project entries | ⏳ **UNVERIFIED**. The report didn't include Project or GPT chat counts. |
| **Custom GPT** chats and GPT entries | ⏳ **UNVERIFIED** |
| Dot position vs. native three-dot menu | ⏳ **Visually unverified live.** Covered by the live-structure fixture with an approximate menu offset. |
| Class names are generated atomic CSS and are not used | ✅ Verified live |

The fixture `tests/fixtures/chatgpt-live.html` and the suite `tests/e2e/live-structure.spec.ts` reproduce the verified structure: decoration target, no layout shift, the native menu still works, and the dot sits clear of it. That is a fixture, not proof of compatibility with chatgpt.com itself.
