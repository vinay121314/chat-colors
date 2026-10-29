# Privacy

ChatGPT Recents Colorizer has **no backend, no telemetry, no analytics and makes no network requests**. Nothing leaves your browser.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your colors and rules in `chrome.storage.local` on this device. |
| Content script on `https://chatgpt.com/*` | Draw colored borders in the ChatGPT sidebar. This is the only site the extension runs on. |

It does **not** request `tabs`, `activeTab`, `scripting`, `cookies`, `history`, `webRequest`, or any other host access. It has **no background service worker** and runs nothing outside the ChatGPT tab and the popup while it's open.

## What is read

Only inside the ChatGPT **sidebar** (`aside[data-app-shell-left-panel-appearance]`, with older layouts as fallbacks):

- The `href` of conversation, Project and custom-GPT links, to extract their IDs (for example `/c/<uuid>`, `/g/g-p-…`).
- The visible text of those links (the conversation title), to match your keyword rules.
- ChatGPT's own `aria-current` marker and the current page path, to know which conversation is open.

When you open the popup:

- **Conversation tab:** the content script tells the popup the open conversation's ID and visible title.
- **Chats tab:** the content script sends the popup the list of conversations currently loaded in the sidebar, with each one's ID, visible title and current color, so you can color chats that aren't open.

**Presenter Mode shortcut:** on chatgpt.com the content script listens for key presses only to compare each one against the shortcut you chose (modifier state plus key code). Keystrokes are never recorded, stored or sent. Only the exact shortcut is consumed; every other key reaches ChatGPT.

**Recently revisited:** when the open conversation changes, its ID and the current time are recorded. Nothing else is recorded. See "Device-local visit history" below.

These titles exist only in memory, inside the ChatGPT tab and the open popup. They're **never stored**, never exported and never sent anywhere. Closing the popup discards them.

## What is stored (locally, `chrome.storage.local`)

- Schema version and the enabled toggle
- Manual colors, keyed by conversation ID. No titles are stored.
- Project/GPT colors, keyed by Project/GPT ID, plus the Project's display name as shown in the sidebar
- Your categories, colors, and keywords
- Appearance settings: style (bar/fill), bar width/opacity/roundness, fill strength, and the open-chat outline (on/off, color, width, opacity)
- Working Set statuses (Active, On hold, Completed, or cleared), keyed by `chatgpt:<conversation ID>`, each with an update timestamp. No titles.
- Presenter Mode settings (on/off, blur or dots, strength, reveal, shortcut) and the Recently Revisited on/off switch
- The active sidebar filter (a single color or status value), stored separately and not exported

### Device-local visit history (Recently revisited)

- **Key:** `crc:visits`. For each conversation you open: its key (`chatgpt:<ID>`), the first and last visit times, and a visit count. **No titles, no messages.**
- **Limits:** at most 500 conversations, and entries older than 90 days are dropped automatically.
- **Scope:** never exported, never part of the settings file, never sent anywhere.
- **Controls:** *Data → Recently revisited* turns recording off and has *Clear history*.

Export writes your settings (not the filter, not the visit history) to a JSON file you choose. Uninstalling the extension deletes everything.

## Never accessed

- Conversation messages or any content outside the sidebar links
- Cookies, authentication tokens, passwords, or account details
- Tab URLs or titles of any tab, browsing history, or any site other than chatgpt.com
- ChatGPT's internal APIs or network traffic. Requests are neither read nor modified.
- ChatGPT's own menus. The extension adds nothing interactive to the sidebar.

No code is loaded remotely, and there is no `eval`. Everything that runs is in the packaged extension.
