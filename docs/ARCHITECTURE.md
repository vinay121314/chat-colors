# Architecture

```
public/manifest.json      MV3: "storage" permission + content script on https://chatgpt.com/*. No background worker.
public/content.css        Bar, fill, open-chat outline and filter-pill styles, scoped to data-crc-* / crc-* names
src/core/schema.ts        Settings types, defaults, validation, migration, import parsing   (pure)
src/core/rules.ts         resolveColor(): manual > Project/GPT > first matching enabled rule > fallback   (pure)
src/core/storage.ts       chrome.storage.local load/save/update/onChange, filter key, message names
src/content/adapter.ts    THE ONLY ChatGPT-DOM-aware module: root, rows, ids, titles, active row, decorate/undecorate, diagnostics
src/content/colorizer.ts  Observers, rAF batching, sync rows to settings, current() and list() for the popup  (no chrome.*)
src/content/main.ts       Content entry: wires the colorizer to storage and popup messages
src/popup/*               Popup UI (plain DOM): Conversation, Chats, Rules, Style, Data
```

Layering: `core` knows nothing about the DOM or ChatGPT. `adapter` knows nothing about settings or storage. Only `main.ts` and `popup.ts` touch `chrome.*` (via `storage.ts`).

**Nothing interactive is injected into ChatGPT's sidebar.** Rows get only `aria-hidden`, `pointer-events: none` visual elements (bar and fill), a few `data-crc-*` attributes, and the outline. Colors are assigned from the popup. The only element of ours you can click in the page is the filter pill's *Clear* button, which exists only while a filter is active.

## Data flow

1. `main.ts` loads settings and the filter, then calls `colorizer.update(settings)`.
2. The colorizer finds the sidebar root (`adapter.findRoot`), scans rows and, for each row, calls `resolveColor(id, title, settings, projectKey)` and then `adapter.decorate`.
3. Any settings write (popup, or another tab) fires `storage.onChanged` in every ChatGPT tab, which calls `update()` and rescans.
4. Popup ↔ content messages (`chrome.tabs.sendMessage` to the active tab's ID; the popup never reads tab URLs, so no `tabs` permission is needed):
   - `crc:current` returns the open conversation (ID, visible title, Project/GPT) plus the color legend and current filter.
   - `crc:list` returns `ListEntry[]`: every conversation loaded in the sidebar (ID, visible title, resolved color, source, Project, whether it's open). This feeds the **Chats** tab, so any chat can be colored, open or not. The popup recalculates each row's color from current settings, so the list updates instantly after a change. Titles are never stored.
   - `crc:diag` returns the structure-only diagnostics report.

## Observation strategy

- **Sidebar observer:** `childList` + `subtree` + `characterData` + `attributes` filtered to `href` and `aria-current`, on the sidebar root only. It catches new rows, title edits, recycled rows and ChatGPT moving its "open chat" marker.
- **Root observer:** `childList` + `subtree` on `body`, whose callback only checks `root.isConnected` (and whether rows exist yet). The callback is O(1) while the sidebar is present.
- **Navigation:** the Navigation API `currententrychange` event (verified available live) and `popstate`.
- All of these schedule one `requestAnimationFrame` scan, so many mutations collapse into one pass. Our own writes are attributes the observer ignores and at most two `aria-hidden` spans per colored row, so there's no feedback loop.

## Decoration

- **Row container (`rowBox`):** the verified live wrapper `[data-sidebar-cycle-item]` / `[role="listitem"]` is preferred, as long as it holds exactly this one chat. Otherwise it climbs to the outermost ancestor that contains exactly this one conversation and is still one row tall, never climbing into `nav`, `aside`, `section`, `ul` or `ol`. The result is cached per link in a WeakMap.
- **Bar:** `<span class="crc-bar" aria-hidden>`, absolutely positioned at the row's left edge, `z-index: 2`, `pointer-events: none`. It paints above the row's own hover and selected backgrounds, causes no layout shift, and doesn't change ChatGPT's row styles. A row that was `position: static` gets `position: relative`, which has no visual effect by itself.
- **Fill (opt-in):** `<span class="crc-fill" aria-hidden>`, `inset: 0`, `border-radius: inherit`, a translucent `color-mix()` at `--crc-f`, `z-index: 1`. The style (`bar` by default, `fill` or `both`) is applied by hiding one element through the `crc-vars` style.
- **Open chat (`activeRow` + `data-crc-active`):** across the whole list, ChatGPT's `aria-current="page"` wins (verified live); the URL is used only when no row is marked, so there are never two active rows. The outline is `outline: var(--crc-ow) solid color-mix(var(--crc-oc, currentColor) var(--crc-oo), transparent)`, inset by its own width. *Auto* leaves `--crc-oc` unset, so it follows the sidebar's text color in light and dark themes. In Windows high-contrast mode (`forced-colors`) it uses `Highlight`. It takes no layout space and doesn't hide the bar or fill. Toggled by `appearance.highlight`.
- **Filter:** `data-crc-hidden` on non-matching rows (`display: none`) plus a sticky pill above the first chat row, with a *Clear* button.
- All CSS variables live in one `<style id="crc-vars">`. Disabling or cleaning up removes every attribute, class, element and style that was added.

## Storage schema (v2)

```ts
{ version: 2, enabled: boolean,
  overrides: { [conversationId]: '#rrggbb' | 'none' },       // 'none' = manually uncolored
  groups:    { [projectOrGptId]: { color: '#rrggbb', name } }, // name = display only
  categories: [{ id, name, color, enabled, rules: [{ keyword, enabled }] }], // order = priority
  fallback: '#rrggbb' | 'none',
  appearance: { mode: 'bar'|'fill'|'both', thickness: 2..6, opacity: 10..100, radius: 0..12, fill: 5..40,
                highlight: boolean, outlineColor: '#rrggbb'|'auto', outlineWidth: 1..4, outlineOpacity: 20..100 } }
// separate key 'crc:filter': '#rrggbb' (not exported)
```

`migrate()` turns anything into valid settings: bad fields fall back to defaults, bad entries are dropped, and fields from removed features (such as `openTabs`) are discarded. Data from a newer version is refused and never overwritten. The v1 → v2 migration removed only the old default keywords and default grey fallback.

## Phase 1 additions (schema v3)

- **Provider-namespaced keys:** `chatKey(id, provider)` → `chatgpt:<id>`. All new per-conversation data uses these keys. The extension is ChatGPT-only, so `chatgpt` is the only accepted prefix; it stays because it's part of the stored format. *Legacy:* `overrides` and `groups` still use bare ChatGPT IDs.
- **Working Set (`settings.chats`):** `{ [chatKey]: { status: 'active'|'hold'|'done'|null, updatedAt } }`. Unassigned is a timestamped `null` (a tombstone) rather than a deletion, so last-writer-wins sync can tell "cleared later" from "never set". Bulk changes share one timestamp. Status appears only in the popup and in the sidebar filter (`status:<s|none>`); rows get no new elements.
- **Recently revisited (`crc:visits`, `core/visits.ts`):** device-local `{ [chatKey]: { first, last, count } }`, at most 500 entries and 90 days, never exported. The colorizer calls `host.opened(id)` only when the open conversation changes, not on rescans, and `main.ts` records it only while `settings.history.enabled` is on.
- **Presenter Mode (`settings.presenter`):** CSS only, generated into `#crc-vars`: `[data-crc] a { filter: blur(n) }` or `-webkit-text-security: disc`, with an optional `:hover`/`:focus-within` reveal and reduced-motion support. The shortcut is a capture-phase `keydown` listener in the content script. `matchesShortcut()` requires the exact modifiers, and only that combination is consumed. There's no background worker, so the shortcut works only while a ChatGPT tab has focus.
- **Popup:** the Chats tab adds views, selection (`Set` of IDs, pruned to the loaded list), a bulk bar, and statuses in the inline editor. The Conversation tab adds a status control and status filter chips. Style adds a Presenter card; Data adds a history card. The header eye button toggles Presenter Mode.

## When ChatGPT changes its DOM

Root discovery (`findRoot`):
1. Use a known container (`aside[data-app-shell-left-panel-appearance]`, verified live, then older fallbacks) if it holds conversation links.
2. Otherwise use the `<aside>` or outermost navigation landmark around the first conversation link. Links in message bodies are never inside navigation, so they're never picked.
3. While zero rows are found, the root observer keeps re-checking.

Conversation IDs accept any URL-safe token (UUIDs are lowercased).

If it still breaks: get the report from *Data → Copy diagnostics* (`adapter.diagnose()`, structure only), then edit `ROOT_SELECTORS`, `ROW_SELECTOR` and `CONV_PATH` in `src/content/adapter.ts` and update `tests/fixtures/*`.

## Removed by design

- **In-row color dot and in-page picker:** they competed with ChatGPT's native three-dot menu on the live site. Replaced by the popup's *Chats* tab.
- **"Already open in another tab" badge and its background service worker:** removed at the user's request. The extension has no background process.
- **Native three-dot menu integration:** not implemented. The menu's markup couldn't be verified on a logged-in session, so it's left untouched.
