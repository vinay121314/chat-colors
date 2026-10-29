# Native ChatGPT plugin: feasibility for "Chat Colors"

Date: 2026-10-29. Sources: official OpenAI developer docs (linked at the end). Decision: **not feasible as a replacement. No plugin was built.**

## 1. What the official platform provides (verified)

| Question | Finding (official docs) |
|---|---|
| Packaging | Plugins bundle **skills** (`skills/<name>/SKILL.md`), optional **MCP servers** (tools), and optional **UI**. Manifest: `.codex-plugin/plugin.json` (scaffolded by `@plugin-creator`) or a root `plugin.json` / `mcp.json`. Distributed by ZIP upload with review (public Plugins Directory), workspace publishing, or local or repo marketplaces. |
| Custom UI | Components render in an **isolated, sandboxed iframe** inside a conversation. The host mirrors iframe navigation into its own controls. **No API changes ChatGPT's own interface or sidebar.** |
| Conversation metadata | Tool calls receive `openai/session`, "an anonymized conversation id for correlating tool calls within the same ChatGPT session", and `openai/subject`, an anonymized user ID. **No documented API lists conversations, titles, Projects, or sidebar items.** Community reports show apps get only the current message, not history. |
| Persistence | `window.openai.widgetState` "belongs to one rendered UI instance. Do not use it as the source of truth… or as durable storage." Cross-session data must go in **"storage you control"** (your server), with user authentication. `localStorage` is discouraged (isolated iframe). |
| Authentication | Per-tool `securitySchemes`: `noauth` or **OAuth 2.1** (ChatGPT stores and attaches the token). mTLS authenticates ChatGPT to your MCP server. |
| Server needed? | Skills-only plugins need no server, but they're instructions for the model and have no persistent state or UI. Anything with tools, UI or durable data needs **your own MCP server**, plus storage and usually OAuth. |
| Chrome extension storage | Not accessible to plugins (a different sandbox and origin). |

## 2. Feature compatibility matrix

| Feature | Native plugin | Chrome extension (current) |
|---|---|---|
| Color sidebar conversations (bars, fill) | ❌ No sidebar access | ✅ |
| Open-chat outline | ❌ | ✅ |
| Keyword auto-categorization of the *user's existing chats* | ❌ Can't see titles or the list | ✅ |
| Manual colors by conversation ID | ❌ Only an anonymized session ID, which isn't the URL ID | ✅ |
| Project colors | ❌ | ✅ |
| Sidebar filter | ❌ | ✅ |
| Bulk assignment over the user's chats | ❌ | ✅ |
| Working Set statuses for existing chats | ❌ (only for chats the user names manually, in plugin-owned storage) | ✅ |
| Recently revisited | ❌ No navigation signal | ✅ |
| Presenter Mode (hiding sidebar titles) | ❌ | ✅ |
| Category/rule editor UI | ⚠️ Possible in an iframe, but the rules would have nothing to apply to | ✅ (popup) |
| Import/export | ⚠️ File handling exists, but there's no consumer for the data | ✅ |
| Works without a server or login | ⚠️ Skills only (no state, no UI) | ✅ |
| Cross-device data | Needs your server plus OAuth | Local only today (see SYNC_ARCHITECTURE.md) |

## 3. Options compared

| | A. Plugin only | B. Extension only | C. Plugin + extension |
|---|---|---|---|
| Delivers the core product (sidebar colors) | **No** | **Yes** | Only through the extension |
| Install | Plugin directory or workspace, plus OAuth if stateful | Load unpacked / Web Store | Both |
| Infrastructure | MCP server + storage + OAuth | **None** | Server *and* extension |
| Integration path between the parts | — | — | **None documented.** The plugin iframe can't reach extension storage. Bridging would mean a server-side sync both use, which is the Oracle option this brief rules out. |
| Permissions | OAuth scopes | `storage` + chatgpt.com | Both |
| Maintenance | Server ops | DOM adapter upkeep | Both |

## 4. Recommendation

**B: keep Chat Colors as a Chrome extension.** A native plugin can't see or change the sidebar or the user's conversation list. A stateful plugin would need an external server and login, which the brief explicitly rules out unless a verified capability requires them, and none does. A plugin-side editor would be a duplicate interface with no integration path, so per the brief **no plugin package was created**.

What carries over from the plugin brief:
- **Branding (Phase 4):** apply the **Chat Colors** name and original icons to the extension. Pending your go-ahead.
- **Possible later:** a *skills-only* "Chat Colors helper" plugin, with no server, that only advises on naming conventions so keyword rules match. It's low value; listed for completeness, not recommended.

## 5. Re-evaluate if

OpenAI documents an API that gives plugins (a) the user's conversation list or titles, (b) real conversation IDs, or (c) sidebar or UI customization hooks.

## Sources

- [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Plugins reference (`_meta` fields, auth)](https://developers.openai.com/plugins/reference)
- [Add UI / manage state](https://developers.openai.com/apps-sdk/build/state-management/)
- [Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission)
- [Plugins in ChatGPT (help center)](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)
- Community (non-official): [Retrieving conversation history](https://community.openai.com/t/retrieving-conversation-history/1364494)
