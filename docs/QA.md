# QA report — v1.0.0 (2026-10-29, revision 3: simplified sidebar)

## Automated results

| Check | Result |
|---|---|
| `npm run lint` (ESLint + bans on `innerHTML`/`eval`) | ✅ pass |
| `npm run typecheck` (TS strict, `noUncheckedIndexedAccess`) | ✅ pass |
| `npm test`: Vitest, 5 files | ✅ 125/125 |
| `npm run build`: `dist/` = manifest, content script and CSS, popup. **No background worker.** | ✅ pass |
| `npm run test:e2e`: Playwright, built extension in Chromium, two fixture pages (original + verified live structure) | ✅ 28/28 |

## Revision 3: changes after live testing

**Reported live:** the injected color dot overlapped or competed with ChatGPT's native three-dot menu.

- **Removed the in-row color dot and the in-page picker.** Nothing interactive is injected into ChatGPT's rows any more. Rows get only `aria-hidden`, `pointer-events: none` visual elements.
- **Removed the "already open in another tab" badge** with its Style setting, messaging, session storage, tests and docs, and **removed the background service worker** (`dist/` has no `background.js`). The extension runs no background process. An `openTabs` value saved by the previous build is dropped on load.
- **Colors are assigned in the popup:**
  - **Chats** (new tab): every chat loaded in the sidebar, open or not, with search. Each chat has an inline editor: category colors, 8 presets, custom HEX, Reset to automatic, Remove color.
  - **Conversation:** the open chat, including the Project scope switch.
- **Native three-dot menu integration: not implemented.** The menu's markup couldn't be inspected on a logged-in session, so adding an item would be unverified and fragile. Per the brief, the native menu is left untouched.
- **Borders:** Bar is now the default style (no background tint). Fill and Bar + fill remain opt-in. Bar width, opacity and roundness are configurable. Any HEX plus presets are available per chat.
- **Open-chat outline:**
  - on/off switch
  - color: **Auto** (the sidebar's text color, adapting to light and dark), 7 presets or any HEX
  - width 1–4 px and opacity 20–100%
  - follows SPA navigation and Back/Forward
  - uses the system `Highlight` color in Windows high-contrast mode
  - keeps the chat's own bar color

## Verified (fixtures in a real Chromium, extension loaded from `dist/`)

- **Native controls:** at the center of ChatGPT's three-dot menu, the topmost element is the menu itself in **every** style mode (Bar, Fill, Bar + fill). Our elements have `pointer-events: none`. The menu click works and doesn't navigate. The row link navigates normally.
- **Nothing injected:** each row contains no interactive element of ours (`button`, `[tabindex]`, `[role=button]`); only ChatGPT's own link and menu remain.
- **No layout shift:** listitem and link boxes are identical with decoration on and off.
- **Chats tab:** colors a chat that isn't open. The color persists through reload and survives a rename (auto colors re-classify). HEX, Remove and Reset work; invalid HEX is rejected; search works; rows are keyboard operable (Tab, Enter) and keep focus across re-render.
- **Filtering:** popup chips and the sticky pill with Clear. **Multi-tab** live updates.
- **Outline:** a preset color, a HEX color, width 4, opacity 100, Auto, and off are each applied to the open row. An invalid outline HEX is rejected; an empty value means Auto.
- **Projects:** coloring a whole Project through the popup's scope switch; a chat override still wins; removable in the Rules tab.
- **Fresh install:** colors nothing and categorizes nothing; a manual color from the Chats tab works.
- **Themes:** light and dark for the popup and sidebar. Palette contrast is ≥ 3:1.

## Live chatgpt.com verification

Source: a logged-in diagnostics report and a screenshot from the user's own Chrome (2026-10-29). The report summarized results; it didn't include raw DOM.

| Item | Status |
|---|---|
| Sidebar root `aside[data-app-shell-left-panel-appearance]` | ✅ Verified live |
| Row = non-link `role="listitem"` + `data-sidebar-cycle-item` + `data-thread-title-trigger` around the `<a>` | ✅ Verified live |
| Regular `/c/<uuid>` chats detected and decorated | ✅ Verified live |
| Open chat marked with `aria-current="page"`; Navigation API available | ✅ Verified live |
| Previous in-row dot overlapped the native three-dot menu | ✅ Observed live → **fixed by removing the dot** |
| Revision 3 (no in-row controls, Chats tab, outline options) on the live site | ⏳ **Not yet re-checked live** |
| **Project** chats and Project entries | ⏳ **UNVERIFIED** |
| **Custom GPT** chats and GPT entries | ⏳ **UNVERIFIED** |
| Native three-dot menu markup (for possible integration) | ⏳ **Not inspected.** Integration not built. |

Fixtures (`tests/fixtures/chatgpt-live.html`, `tests/e2e/live-structure.spec.ts`) reproduce the verified structure. They are not proof of compatibility with chatgpt.com itself.
