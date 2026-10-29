# Feasibility — ChatGPT Recents Colorizer

> **Historical (Phase 1, 2026-10-28).** This is kept as the original analysis. Several assumptions here have since been superseded: the selectors were verified on a logged-in session, the inset-shadow border was replaced by an overlay bar, and the in-row control was removed. For the current design see [ARCHITECTURE.md](ARCHITECTURE.md); for live verification status see [QA.md](QA.md).

Status: **Phase 1 draft, 2026-10-28.** No live ChatGPT DOM has been inspected yet.
Every selector below is marked **UNVERIFIED** until it has been checked against the live site in a real browser session.

## 1. Verdict

Feasible with a Manifest V3 content script plus a popup. It needs only the `storage` permission and needs no background service worker.
The main risk is ChatGPT's DOM changing, not missing platform support. That risk is contained by keeping all DOM knowledge in one adapter module.

## 2. Platform (MV3)

| Need | API | Notes |
|---|---|---|
| Run on ChatGPT | `content_scripts` with `matches: ["https://chatgpt.com/*"]` | `chat.openai.com` redirects to `chatgpt.com`, so it is not matched. This is the only host access the extension requests. |
| Persist settings | `chrome.storage.local` (`storage` permission) | Local only, never `storage.sync`. `storage.onChanged` updates every open ChatGPT tab. |
| Current conversation in popup | `chrome.tabs.sendMessage` to the active tab | The content script replies with the conversation ID. No `tabs` or `activeTab` permission is needed, because sending a message does not require reading the tab URL. |
| Background worker | none | Nothing needs one. |
| Build | Vite | Content scripts can't be ES modules, so the content entry is built as a single IIFE file and the popup is a normal HTML entry. |

Rejected options: `scripting`, `tabs`, `webRequest`, `cookies`, `history`, `host_permissions` beyond the content-script match, and remote code.

## 3. ChatGPT sidebar: expected structure (UNVERIFIED)

The following is based on public extension changelogs and prior knowledge, **not on inspection**:

- The sidebar is a `<nav>` containing a "Chats" or "Recents" history list.
- Each conversation row is an `<a>` whose `href` is a relative path:
  - `/c/<uuid>` for normal chats
  - `/g/<gizmo-id>/c/<uuid>` for custom GPT and Project chats. A third-party extension's release notes describe adding support for Project chat URLs under `/g/.../c/...`.
- The visible title is the anchor's text, sometimes in a nested truncation element.
- Class names are generated or utility (Tailwind) classes, so they are unstable and **not used**. `data-testid` attributes may exist and are treated as hints, never requirements.

### Conversation ID (stable key)

```
^/(?:g/[^/]+/)?c/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?$
```

The ID is read with `new URL(a.href).pathname`, never from text. The UUID survives renames. Titles are never stored as keys.

### Selection strategy

1. Candidate links: `nav a[href]` whose pathname matches the regex above.
2. Context check: the link must sit inside the sidebar `<nav>`, not the main thread or a share dialog.
3. Unrelated links don't match the regex and are ignored. Examples: `/gpts`, `/g/<id>` without `/c/`, settings, and "New chat" (`/`).

## 4. SPA behaviour and dynamic content

| Concern | Plan |
|---|---|
| SPA navigation | URL changes don't remount the sidebar, and the active row changes via attributes. The observer handles rows, so no route hook is needed. The popup asks the tab directly. |
| Lazy loading / infinite scroll | New rows are added DOM nodes, so they are caught by the observer. |
| Virtualization | Believed **not** virtualized (UNVERIFIED). If it is, recycled nodes are handled because decoration is keyed on the current `href` and re-checked when attributes change. |
| Sidebar collapse or replacement | The observer is attached to `document.body` with `childList` and `subtree`, but the work inside it is filtered cheaply. A narrower root (the `<nav>`) is used once found, and the observer falls back to body if the `<nav>` is removed. |
| Title rename | `characterData` and `childList` mutations in a row re-run auto-classification. |
| Batching | Mutations are coalesced into one `requestAnimationFrame` pass. |
| Duplicates | Each row carries a `data-crc` marker, and the control is created only if it is absent. There is a single observer per page (module-level guard). |

React can wipe injected nodes when it re-renders. That is acceptable, because the observer re-applies them idempotently.

## 5. Styling and themes

- The border is drawn with `box-shadow: inset <w>px 0 0 var(--crc-color)` on the row, not with `border-left`. A real border changes the box size and causes layout shift. An inset shadow doesn't change the box size, keeps typography intact and adds no background.
- Risk: if ChatGPT already uses `box-shadow` on hover or selected rows, the two would conflict. The fallback is an absolutely positioned `::before` on the row. Which one to use is decided after live inspection.
- Opacity is applied with `color-mix(in srgb, var(--crc-color) <n>%, transparent)` (native CSS, supported since Chrome 111).
- Theme: ChatGPT toggles a `dark` or `light` class on `<html>` (UNVERIFIED). The default palette is chosen for at least 3:1 non-text contrast (WCAG 1.4.11) against both a near-white (#fff) and a near-black (#171717 / #212121) sidebar. Mid-saturation hues are used, and the neutral is a mid-grey.
- `prefers-reduced-motion`: the only motion is a fade when the control appears on hover, which is disabled under reduced motion.

## 6. Manual color control

- A small `<button>` is injected into the row and becomes visible on `:hover` and `:focus-within`. It has an `aria-label` ("Set color for <title>").
- Click and keydown events on it call `preventDefault()` and `stopPropagation()`, so the anchor does not navigate. ChatGPT's own "…" menu, hover state and context menu are untouched.
- The palette is a native `popover` element (Chrome 114+). It provides light-dismiss and Esc handling for free and adds no library. Swatches are buttons, the custom color uses native `<input type="color">` plus a HEX text field, and there are Reset-to-auto and Remove actions.
- **Fallback:** if live inspection shows that injecting into the row breaks layout or interaction, the in-row control is disabled through an adapter flag. Manual color is then set only from the popup for the current conversation. This is already in scope.

## 7. Existing work and licenses

| Project | Relevance | License |
|---|---|---|
| glyndavidson/chatgpt-folders | Open-source ChatGPT folder extension; uses `storage.sync` | Not confirmed — check its LICENSE before reuse |
| "ChatGPT: Favorites & Color Highlighter" (Web Store) | Closest feature match | Closed / unknown |
| Various "ChatGPT Folders" / organizers | Folder-based, not border coloring | Mostly closed |
| rushil-b-patel/chatGPT-prompt-indexer | Same extractor + observer pattern | Not confirmed |

No code is copied, so there is no license obligation. No runtime dependencies are needed.

## 8. Limitations and risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ChatGPT changes sidebar markup | High over time | Coloring stops | Adapter isolation. Degrades to a no-op with no page damage. One file to fix. |
| React re-render removes injected nodes | Medium | Flicker | Idempotent re-apply on mutation |
| Inset shadow conflicts with native selected or hover style | Medium | Visual | `::before` fallback |
| Row too cramped for a control | Medium | UX | Popup-only fallback (§6) |
| Collapsed or mobile sidebar | Certain | No rows visible | Nothing to decorate. The popup still works. |
| Titles only visible after load | Certain | Auto rules apply only to loaded rows | Documented limitation |
| Other extensions modifying the same rows | Low | Visual conflicts | Namespaced `crc-` classes and data attributes |
| Chrome-only APIs (`popover`, `color-mix`) | — | — | Chrome 114+ required (stated in the manifest `minimum_chrome_version`) |

## 9. Verification still required (live site)

Run in a logged-in Chrome session, with user approval, because it exposes chat titles:

- [ ] Confirm the history `<nav>` and the row `<a>` pattern
- [ ] Confirm the `/c/` and `/g/.../c/` href formats and the UUID shape
- [ ] Check whether the list is virtualized
- [ ] Check the native hover and selected styles (box-shadow conflict)
- [ ] Find where the title text node lives (check that rename updates it in place)
- [ ] Check the light and dark sidebar background colors
- [ ] Check the collapsed sidebar and narrow viewport

Until this is checked, the README states: **"Live ChatGPT compatibility: UNVERIFIED."**
