# Privacy

ChatGPT Recents Colorizer has **no backend, no telemetry, no analytics and makes no network requests**. Nothing leaves your browser.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your colors and rules in `chrome.storage.local` on this device. |
| Content script on `https://chatgpt.com/*` | Draw colored borders in the ChatGPT sidebar. This is the only site the extension runs on. |

It does **not** request `tabs`, `activeTab`, `scripting`, `cookies`, `history`, `webRequest`, or any other host access.

### Background service worker ("Mark chats open in another tab")

A small event-driven background worker powers this feature. It adds **no permissions**.

- **What it receives:** from the extension's own ChatGPT tabs only, the **conversation ID** each tab is showing (or "none"), plus Chrome's numeric **tab ID** for that tab.
- **What it keeps:** a map from tab ID to conversation ID in `chrome.storage.session`, held in memory and **cleared when the browser closes**. It's never written to disk or exported.
- **What it does:** tells your other ChatGPT tabs which conversations are open elsewhere, and on request switches to that tab (`tabs.update` with `active`) and focuses its window (`windows.update`).
- **What it never does:** read tab URLs, tab titles or favicons. Without the `tabs` permission Chrome doesn't give them to us, and the worker never calls `tabs.query` or listens to `tabs.onUpdated`. It never reads conversation content and never makes network requests.
- **Turning it off:** *Style → Mark chats open in another tab*. When it's off, tabs report nothing.

## What is read

Only inside the ChatGPT **sidebar** (`#ds-sidebar`):

- The `href` of conversation links, to extract the conversation ID (for example `/c/<uuid>`).
- The visible text of those links (the conversation title), to match your keyword rules. Titles are processed in memory and are **never stored**.
- The current page path, when you open the popup, to tell which conversation is open.

## What is stored (locally, `chrome.storage.local`)

- Schema version and the enabled toggle
- Manual colors, keyed by conversation ID (a UUID). No titles are stored.
- Your categories, colors, and keywords
- Appearance settings (thickness, opacity, radius)

Export writes this same data to a JSON file you choose. Uninstalling the extension deletes it.

## Never accessed

- Conversation messages or any content outside the sidebar links
- Cookies, authentication tokens, passwords, or account details
- Browsing history or any site other than chatgpt.com
- ChatGPT's internal APIs or network traffic. Requests are neither read nor modified.

No code is loaded remotely, and there is no `eval`. Everything that runs is in the packaged extension.
