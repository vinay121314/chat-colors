# Architecture

```
public/manifest.json      MV3: "storage" permission + content script on https://chatgpt.com/*
public/content.css        Border + control styles, scoped to data-crc-* / crc-* names
src/core/schema.ts        Settings types, defaults, validation, migration, import parsing   (pure)
src/core/rules.ts         resolveColor(): manual > first matching enabled rule > fallback    (pure)
src/core/storage.ts       chrome.storage.local load/save/update/onChange + message name
src/content/adapter.ts    THE ONLY ChatGPT-DOM-aware module: root, row discovery, ID, title, decorate/undecorate
src/content/colorizer.ts  Observers, rAF batching, sync rows to settings, current-conversation lookup  (no chrome.*)
src/content/picker.ts     In-page color picker (shadow DOM + native popover)
src/content/main.ts       Content entry: wires colorizer to storage and popup messages
src/popup/*               Popup UI (plain DOM)
```

Layering: `core` knows nothing about the DOM or ChatGPT. `adapter` knows nothing about settings or storage. Only `main.ts` and `popup.ts` touch `chrome.*` (via `storage.ts`).

## Data flow

1. `main.ts` loads settings, then `colorizer.update(settings)`.
2. The colorizer finds the sidebar root (`adapter.findRoot`), scans rows and, for each row, calls `resolveColor(id, title)` and then `adapter.decorate`.
3. Any settings write (popup, in-row picker, or another tab) fires `storage.onChanged` in every ChatGPT tab, which calls `update()` and rescans.
4. Popup → `chrome.tabs.sendMessage(activeTabId, {type: 'crc:current'})` → the content script replies `{id, title}`. The popup never reads the tab URL, so the `tabs` permission isn't needed.

## Observation strategy

- **Sidebar observer:** `childList` + `subtree` + `characterData` + `attributes` filtered to `href`, on the sidebar root only. It catches new rows, title edits and recycled rows.
- **Root observer:** `childList` + `subtree` on `body`, whose callback only checks `root.isConnected`. It is needed to detect the sidebar being replaced or first rendered. The callback is O(1) while the sidebar is present.
- Both observers schedule one `requestAnimationFrame` scan. Many mutations collapse into one pass.
- Our own writes are attributes the observer ignores (`data-crc*`, `style`) plus one button per row, created once. That causes at most one extra no-op scan, with no feedback loop.

## Decoration

- **Row container (`rowBox`):** on some layouts the `<a>` wraps only the title and the full-width row is an ancestor. Decorating the `<a>` put the bar and dot on top of the title, which was reported on the live site. Decoration goes on the outermost ancestor that still contains exactly this one conversation and is still one row tall. It never climbs into `nav`, `aside`, `section`, `ul` or `ol`. The result is cached per link in a WeakMap.
- **Open chat (`activeRow` + `data-crc-active`):** across the whole list, ChatGPT's `aria-current="page"` wins (verified live), and the URL is used only when no row is marked, so there are never two active rows. The CSS outline (`outline-offset: -2px`, the text color at 65%, `Highlight` in forced-colors mode) takes no layout space and doesn't hide the bar or fill. Updates come from the sidebar observer (`attributeFilter` includes `aria-current`), the Navigation API `currententrychange` event (verified available live) and `popstate`. Toggled by `appearance.highlight`.
- **Fill:** `<span class="crc-fill">` is `inset: 0`, `border-radius: inherit`, and a translucent `color-mix()` of the color at `--crc-f`. It sits at `z-index: 1`, under the bar (2) and the control (3). The mode (`bar`, `fill` or `both`) is applied by hiding one element through the `crc-vars` style.
- `data-crc="<id>"` marks a row. `data-crc-color` plus a `--crc-c` custom property sets the color.
- The color is drawn by our own `<span class="crc-bar">`, absolutely positioned at the row's left edge with `z-index: 2` and `pointer-events: none`. An earlier inset `box-shadow` on the row was invisible whenever a child of the row painted an opaque background, which is common in hover and selected states. The bar paints above those backgrounds, never takes clicks, causes no layout shift, and doesn't change ChatGPT's own row styles. A row that was `position: static` gets `position: relative`, which has no visual effect by itself. Thickness, opacity and radius are `:root` variables in one `<style id="crc-vars">`.
- The control is a `<button>` absolutely positioned inside the row, visible on hover and focus. Its click events call `preventDefault` and `stopPropagation`, so the anchor doesn't navigate and ChatGPT's root-delegated handlers never see the click.
- Disable or cleanup removes every attribute, class, button and style that was added.

## Storage schema (v1)

```ts
{ version: 1, enabled: boolean,
  overrides: { [conversationUuid]: '#rrggbb' | 'none' },   // 'none' = manually uncolored
  categories: [{ id, name, color: '#rrggbb', enabled, rules: [{ keyword, enabled }] }], // order = priority
  fallback: '#rrggbb' | 'none',
  appearance: { thickness: 2..6, opacity: 10..100, radius: 0..12 } }
```

`migrate()` turns anything into valid settings: bad fields fall back to defaults and bad entries are dropped. Data from a newer version is refused and never overwritten. To add v2, bump `SCHEMA_VERSION` and transform `version < 2` input inside `migrate()`.

## When ChatGPT changes its DOM

Root discovery (`findRoot`):
1. Use a known container (`#ds-sidebar`, the history nav and similar) if it holds conversation links.
2. Otherwise use the `<aside>` or outermost navigation landmark around the first conversation link. Links in message bodies are never inside navigation, so they're never picked.
3. While zero rows are found, the root observer keeps re-checking. This covers a list that renders late or somewhere unexpected.

Conversation ids accept any URL-safe token (UUIDs are lowercased), so an id-format change doesn't break detection.

If it still breaks: get the report from *Data → Copy diagnostics* (`adapter.diagnose()`, structure only), then edit `ROOT_SELECTORS` and `CONV_PATH` in `src/content/adapter.ts` and update `tests/fixtures/*`.
