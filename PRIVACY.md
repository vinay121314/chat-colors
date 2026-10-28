# Privacy

ChatGPT Recents Colorizer has **no backend, no telemetry, no analytics and makes no network requests**. Nothing leaves your browser.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your colors and rules in `chrome.storage.local` on this device. |
| Content script on `https://chatgpt.com/*` | Draw colored borders in the ChatGPT sidebar. This is the only site the extension runs on. |

It does **not** request `tabs`, `activeTab`, `scripting`, `cookies`, `history`, `webRequest`, or any other host access. It has no background service worker.

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
