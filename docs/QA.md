# QA report

## v1.1.0 local release candidate (2026-10-29): Chat Colors rebrand

**Status: local release candidate. Not live-verified in full and not ready for public release.** Nothing was published to the Chrome Web Store or pushed to GitHub.

Changes: renamed to **Chat Colors** (name, short name, description, popup, docs), original icon (`assets/icon.svg`, 16/32/48/128 PNGs, `action.default_icon`), and the reserved `claude` provider removed (ChatGPT-only). No behavior, storage or permission changes otherwise.

**Automated (fixture) results:**

| Check | Result |
|---|---|
| Lint, typecheck, production build | ✅ pass |
| Unit (Vitest) | ✅ 141/141 |
| Browser (Playwright, built extension in Chromium, fixture pages) | ✅ 33/33 |
| Permissions | ✅ unchanged: `["storage"]`, content script on `https://chatgpt.com/*` only, no background worker |
| Storage compatibility | ✅ `crc:settings`, `crc:filter`, `crc:visits` keys and `chatgpt:` chat keys unchanged; schema still v3, no migration added |
| Popup branding and icon | ✅ inspected in light and dark (`docs/screenshots/popup-*.png`); icon checked at 16/32/48/128 on light and dark (`docs/screenshots/icon-preview.png`) |

### Required before public release: live checks still not performed

These six were **not tested** on live chatgpt.com (see the table below). Each must pass live on a logged-in account with this build before a public release:

- [ ] **3. Custom GPT chat coloring:** chats under a custom GPT get colored; a GPT-level color applies to its chats.
- [ ] **4. Keyword rules:** add keywords, confirm matching titles are colored; rule priority and *Test a title* behave as in the popup.
- [ ] **5. Bulk actions:** select several chats in *Chats*, apply a category, preset, HEX and Remove; unselected chats unchanged.
- [ ] **6. Working Set filters:** set statuses; filter the sidebar by status and clear the filter.
- [ ] **7. Recently Revisited:** open a chat twice; it appears in the view; the history switch and *Clear history* work.
- [ ] **8. Presenter Mode:** shortcut and eye button toggle it; blur and dots; reveal on hover; colors and outline stay visible.

Also re-check on this build: the toolbar icon and the popup header render correctly, and colors and settings from v1.0.0 are still present after updating in place (load unpacked over the same folder; don't remove the extension, because that deletes its storage).

---

## Live verification on chatgpt.com (2026-10-29, user's logged-in account)

The user ran these checks by hand on their own logged-in ChatGPT account in Chrome, using the Phase 1 build. **No diagnostics report was provided**, so this section records no detected-chat counts or DOM details.

| # | Check | Live result |
|---|---|---|
| 1 | Regular chat coloring | ✅ Passed |
| 2 | Project chat coloring | ✅ Passed |
| 3 | Custom GPT chat coloring | ⏭️ Not tested |
| 4 | Keyword rules | ⏭️ Not tested |
| 5 | Bulk actions | ⏭️ Not tested |
| 6 | Working Set filters | ⏭️ Not tested |
| 7 | Recently Revisited | ⏭️ Not tested |
| 8 | Presenter Mode | ⏭️ Not tested |
| 9 | Active-chat outline | ✅ Passed |
| 10 | Native three-dot menus (not obstructed) | ✅ Passed |
| 11 | Settings persistence | ✅ Passed |

**Totals:** 5 passed, 0 failed, 6 not tested. A "not tested" check is neither a pass nor a failure. Those features are covered **only** by the automated fixture tests below. They are not live-verified.

**How the evidence breaks down:**
- **Automated fixture tests:** every feature above, against synthetic fixture pages in Chromium (see the Phase 1 section and [TESTING.md](TESTING.md)). Fixtures are not proof of live compatibility.
- **Live tests passed:** checks 1, 2, 9, 10, 11.
- **Live tests not performed:** checks 3–8.

---

## Phase 1 (2026-10-29): bulk assignment, Working Set, Recently Revisited, Presenter Mode

Baseline checked first: HEAD was `915736e`, the tree was clean, and none of the Phase 1 features existed. Before any change, 125 unit and 28 e2e tests passed.

| Check | Result |
|---|---|
| Lint, typecheck (strict), production build | ✅ pass. Permissions are still `["storage"]` only; no background worker. |
| Unit (Vitest) | ✅ **141/141** (+16: schema v3, keys, statuses, shortcut matching, visits, status filter, visit reporting, Presenter CSS) |
| Browser (Playwright, built extension in Chromium) | ✅ **33/33** (+5 in `phase1.spec.ts` on the verified live-structure fixture; the existing suites still pass) |

**Fixture-tested (not yet verified on live chatgpt.com):**
- **Bulk:** multi-select, *Select all visible* with search, *Clear selection*, and bulk category, preset, HEX and Remove; unselected chats aren't touched.
- **Working Set:** bulk and per-chat statuses, all stored with `chatgpt:` keys and `updatedAt` (a bulk change shares one timestamp). Unassigned is a timestamped `null`. Status views in the popup; sidebar status filter and pill.
- **Recently revisited:** recorded on SPA navigation (IDs, timestamps and counts only; no titles in the store; not in exported settings). Lists chats opened 2+ times, most recent first. The history switch stops recording; *Clear history* works.
- **Presenter Mode:**
  - the shortcut toggles it; blur and dots both work; reveal on hover, and reveal off
  - the shortcut can be changed or turned off, and the old one stops working
  - only the exact combination is consumed (other keys reach the page)
  - colors and the open-chat outline stay visible; popup titles are concealed too; the header toggle works
- **Minimal sidebar:** in every new state each row contains only ChatGPT's own link and menu plus our hidden bar and fill. The native menu is the topmost element at its center.
- **Existing behaviour unchanged:** colors, rules, color filter, outline, Projects, import/export and multi-tab.

**Live chatgpt.com:** Phase 1 is **not yet verified live**. The structures it relies on (root, row wrapper, `aria-current`, Navigation API) were verified earlier. Project and custom-GPT chats are still unverified.

---

# Earlier revision 3 (2026-10-29): simplified sidebar

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
