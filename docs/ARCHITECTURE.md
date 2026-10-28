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

- `data-crc="<id>"` marks a row. `data-crc-color` plus a `--crc-c` custom property sets the color.
- The border is an `inset box-shadow`, so the box size is unchanged and there is no layout shift. Thickness, opacity and radius are `:root` variables in one `<style id="crc-vars">`.
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

Edit `ROOT_SELECTORS` and `CONV_PATH` in `src/content/adapter.ts`, then update `tests/fixtures/*`. If no root matches, the extension does nothing. It never falls back to guessing among arbitrary links on the page.
