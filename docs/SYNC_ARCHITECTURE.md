# Sync architecture: feasibility and security design (DRAFT, for approval)

Status: **design only.** Nothing here is implemented or deployed. The Oracle account hasn't been accessed and no Telegram bot exists. Facts marked **VERIFY** must be confirmed before any deployment.

## 1. Goals and constraints

- Two PCs, the same ChatGPT and Claude accounts, the same colors, rules, statuses and appearance everywhere.
- **Local-only stays the default.** Sync is opt-in, and existing local settings are preserved: the first sync merges and never replaces.
- **Account namespaces:** ChatGPT and Claude data are kept apart, and so are different accounts on the same platform.
- **No conversation titles or message bodies ever leave the browser.** The server must not be able to read conversation mappings: client-side end-to-end encryption.
- **No login page.** Device pairing is used instead. Device credentials are revocable.
- **Robustness:** offline edits, conflicts, deletions, recovery, backups, database migrations.
- **No secrets in the extension.** No Oracle credentials and no Telegram bot token are ever shipped in or sent to the extension.

### What exactly would sync

| Data | Size estimate | Sync? |
|---|---|---|
| Categories, keyword rules, fallback, appearance, outline, presenter | ~2–6 KB | Yes |
| Manual colors (`overrides`), keyed by conversation ID | ~50 B each in plaintext; ~150 B each encrypted | Yes |
| Project/GPT colors (`groups`) | small | Yes |
| Working Set statuses (`chats`, already `{status, updatedAt}`) | ~60 B each in plaintext | Yes |
| Recently revisited (`crc:visits`) | up to 500 entries | **No by default.** Device-local by design; optional later. |
| Sidebar filter, popup UI state | tiny | No (per device) |
| Titles, messages, account emails, cookies | — | **Never** |

## 2. The three options

### Option A: `chrome.storage.sync` (no server)

- **Quotas** (Chromium `storage.json`; check the current docs): `QUOTA_BYTES` 102,400 (~100 KB total), `QUOTA_BYTES_PER_ITEM` 8,192, `MAX_ITEMS` 512.
- **Write-rate limits:** sources disagree (120/min with 1,800/h, or "no per-minute quota"). **VERIFY**, and batch writes regardless.
- **Fit:** the settings fit easily. Manual colors and statuses need sharding across items (for example 64 shards by ID-hash prefix, each under 8 KB). Realistic capacity is roughly **1,000–1,500 colored or status-tagged chats**.
- **Identity:** tied to the **Chrome profile's Google account**, not to the ChatGPT or Claude account. Both PCs must be signed into the **same Chrome profile with sync on**. Chrome Sync encrypts data with Google-managed keys unless the user sets a Chrome sync passphrase. We can add our own encryption layer (same key scheme as Option B), but then the key needs pairing.
- **Conflicts:** Chrome resolves per key with last-write-wins and no history. So everything is stored per record with `updatedAt` (sections 5 and 6) and merged in the client.
- **Permissions:** **none new.** `storage` already covers `storage.sync`.
- **Cost and operations:** $0, no server.

### Option B: Oracle Cloud VM + SQLite + HTTPS API (full sync)

- **When it's needed:** the PCs use different Chrome profiles or Google accounts; you want more than about 1,500 records, change history, or server-side backups; or you don't want to depend on Google.
- **Server sees only ciphertext**, plus opaque record IDs and device metadata (section 4).
- **Permissions:** the extension calls the API from a background service worker. Either the server sends CORS headers allowing **only** `chrome-extension://<extension-id>`, which needs **no host permission**, or we use `optional_host_permissions` for the server origin, granted at runtime when sync is turned on. The background worker needs the `alarms` permission for periodic sync. It's **not** in the current build, so it needs approval. `alarms` shows no install warning.
- **Cost:** the VM is $0 within Always Free (**VERIFY**). A domain for TLS costs either $0 (a free dynamic-DNS subdomain) or about $10–15 a year (your own domain). Operations: moderate, covering OS patches, TLS renewal (automatic with Caddy), backups and monitoring.

### Option C: Telegram Bot API as encrypted backup storage only

- **Never the primary database,** and **never called from the extension:** the bot token lives only on the server.
- The server periodically uploads an **already-encrypted** database snapshot to a private channel. Bot API `sendDocument` accepts uploads up to ~50 MB and downloads via `getFile` up to ~20 MB (**VERIFY**). The database will be well under 5 MB.
- **Risks:** Telegram sees encrypted blobs and their timing and size. Bot-token theft lets an attacker read or delete backups, but they can't decrypt them. Telegram's terms and rate limits apply.
- **Permissions:** none in the extension. **Cost:** $0.

## 3. Recommendation

1. **Stage S1, Option A, if both PCs use the same Chrome profile and Google account.** Ship opt-in `storage.sync` with sharded, per-record LWW merge, a Sync Status indicator, quota handling, and end-to-end encryption with a pairing key. Effort is about 1–2 days, with no server, no cost and no new permission. This covers the stated need.
2. **Stage S2, Option B, only if S1 doesn't fit.** Typical reasons: different Chrome profiles or Google accounts, more than about 1,500 records, wanting history, or not wanting Google in the path. The record format and crypto are designed so S1 data migrates as-is.
3. **Stage S3, Option C, only together with S2,** as an off-site encrypted backup of the server database.

Reasoning: for a personal two-PC setup, a server adds operations work (patches, TLS, backups, reclamation risk on Always Free) and attack surface for little benefit, *if* Chrome Sync is available. The client-side work (record model, merge, encryption, status UI) is common to both, so nothing is wasted by starting with S1.

## 4. Architecture (Option B, superset of A)

```
 PC 1 (Chrome)                                   PC 2 (Chrome)
 ┌───────────────────────────────┐               ┌───────────────────────────────┐
 │ content script (chatgpt/claude)│              │ content script                │
 │   reads ids + visible titles   │              │                               │
 │   (titles never leave the tab) │              │                               │
 │ popup ── settings ─┐           │              │                               │
 │ background worker  ▼           │              │ background worker             │
 │  - record store (storage.local)│              │  - same                       │
 │  - outbox (pending ops)        │              │                               │
 │  - vault key K (non-exportable)│              │  - same K (via pairing)       │
 │  - device key (ECDSA P-256)    │              │  - own device key             │
 └───────────────┬───────────────┘               └───────────────┬───────────────┘
                 │ HTTPS: encrypted records + signed requests     │
                 ▼                                                ▼
        ┌────────────────────────── Oracle VM (Always Free, VERIFY) ─────────────┐
        │ Caddy (TLS, rate limit) → API (small Go/Node service) → SQLite (WAL)   │
        │  sees: vault id, opaque record ids (HMAC), ciphertext, sizes, times,   │
        │        device public keys, IPs. Cannot decrypt anything.               │
        │ nightly: sqlite .backup → age-encrypt (offline key) → Telegram channel │
        └────────────────────────────────────────────────────────────────────────┘
```

### Keys (WebCrypto)

- **Vault key `K`:** 256-bit random, created on the first device and never sent to the server. Derived with HKDF-SHA256:
  - `K_enc` for AES-256-GCM record payloads
  - `K_id` for HMAC-SHA256 record IDs, so the server never sees conversation IDs
- **Device key:** an ECDSA P-256 key pair per device, with the private key non-extractable in IndexedDB. Requests are signed (method, path, body hash, timestamp, nonce), so there are no bearer passwords to steal from storage.
- **At-rest wrapping on each PC:** `K` is stored as a non-extractable `CryptoKey` in IndexedDB where possible. Otherwise it's wrapped. Optionally, a user passphrase (PBKDF2/Argon2) protects export of the recovery kit.

### Record model (shared by A and B)

`recordId = HMAC(K_id, namespace + "|" + type + "|" + key)`, where:
- `namespace` = `chatgpt:<accountLabel>` or `claude:<accountLabel>`
- `accountLabel` = a short label the user picks per account (for example "personal"). It's chosen manually so the extension never reads emails or account IDs from the page. It's stored locally and inside encrypted payloads only.
- `type` is one of `override`, `status`, `group`, `category`, `appearance`, `presenter` or `rules`.

The payload, encrypted with AES-GCM (random 96-bit nonce, AAD = `recordId|schemaVersion`), is `{ value, updatedAt (HLC), deviceId, deleted }`.

### Pairing without a login page

1. **Bootstrap (first device, once):** the server prints a one-time **enrollment code** at deploy time. The user enters it in the extension. The device registers its public key and creates a vault. The code expires after first use.
2. **Add a device:** PC 1 asks the server for a one-time pairing ticket (single use, 10 minutes). It shows a **pairing kit** containing server URL, ticket and `K`, as a QR code or copyable text. The user transfers it to PC 2 out of band, for example through a password manager or by retyping. PC 2 redeems the ticket with its own public key. **The server sees the ticket, never `K`.**
3. **Short authentication string:** both devices display the same 6-digit code derived from both public keys, which the user compares to detect substitution.

### Revocation and recovery

- **Revoke:** from any device, the device list lets you mark a device revoked, and the server rejects its signatures immediately. Because a revoked device still knows `K`, **rotate `K`**: generate `K2`, re-encrypt all records, and re-pair the remaining devices.
- **Recovery kit:** `K` plus the server URL, exported once and encrypted with a user passphrase. Losing every device *and* the kit means losing the synced data (by design, since the server can't decrypt it), but each PC keeps its local copy.

### Offline changes, conflicts and deletion

- Every change is applied locally first and appended to an **outbox** with an idempotency key, then pushed with exponential backoff.
- Merge is **per record, last-writer-wins on HLC timestamp**, with ties broken by `deviceId`. The server stores a per-vault `seq`, so a pull asks for "everything since seq N".
- **Conflicts are detected and shown, not hidden:** if a pull overwrites a record with a pending local edit, both versions go to a conflict log. The Sync Status shows "1 conflict" with keep-mine or keep-theirs.
- **Deletion** writes a tombstone (`deleted: true`, matching today's `status: null` design), which is garbage-collected after 180 days.
- **First enable never discards:** the local state is uploaded and merged, not replaced. A JSON export is taken automatically before the first sync. Import/export stays available.

### Server (Option B)

- **SQLite (WAL) tables:**
  - `vaults(id, created_at)`
  - `devices(id, vault_id, pubkey, name_enc, created_at, last_seen, revoked_at)`
  - `records(vault_id, record_id, seq, nonce, ciphertext, updated_at, size)`
  - `tickets(hash, vault_id, expires_at, used_at)`
  - `schema_migrations(version, applied_at)`
- **API:** `POST /v1/vaults` (enrollment), `POST /v1/pair/ticket`, `POST /v1/pair/redeem`, `GET /v1/records?since=`, `PUT /v1/records` (batch, idempotent), `GET/DELETE /v1/devices`.
- **Hardening:**
  - limits: 256 KB request bodies, 64 KB records, 5,000 records per vault
  - per-device and per-IP rate limits
  - no body logging; minimal structured logs
  - OS firewall allowing only 443 (and 22 from your IP)
  - unattended security updates
- **Migrations:** numbered SQL files applied in a transaction at startup, **after** an automatic `.backup`, with a forward-only plan and a tested restore.
- **Backups:**
  - nightly `sqlite3 .backup` → `age` encryption to an **offline** public key (the private key stays with you) → Telegram private channel through the bot (token in a `0600` env file on the server)
  - weekly retention of 8 copies
  - the restore runbook is tested quarterly

## 5. Threat model

| Threat | Impact | Mitigation |
|---|---|---|
| Server or VM compromised | Attacker gets ciphertext and metadata | E2E encryption, HMAC record IDs, no titles. Metadata (record counts, timing, IPs) remains visible. |
| Network attacker | Reads or alters traffic | TLS, signed requests with timestamp and nonce (replay protection), AES-GCM integrity |
| Stolen or compromised PC | Has `K` and local data | Revoke the device and rotate `K`. OS disk encryption is recommended. Local data was exposed anyway. |
| Telegram account or bot-token theft | Backups read or deleted | Backups are age-encrypted with an offline key. Retention is also kept on the VM. |
| Malicious page script on chatgpt.com or claude.ai | Tries to read extension data | Keys live only in the worker and extension storage, never in content scripts. Content scripts don't handle sync. |
| Supply chain or extension update | Code exfiltrates `K` | No runtime dependencies, reviewed builds, local unpacked install, no remote code |
| Oracle reclaims an idle Always Free VM | Sync outage | Clients keep full local copies, Telegram backups, and a documented redeploy. **VERIFY** the reclamation policy. |
| Wrong-device pairing (pairing kit intercepted) | Attacker device joins | Single-use 10-minute tickets, a short authentication code check, device list with revoke |
| Account mix-up (two accounts on one platform) | Colors applied to the wrong account | Explicit `accountLabel` namespaces chosen per browser profile |

Out of scope: hiding from Google that the extension exists, and traffic analysis.

## 6. Account and platform scoping

- **Namespaces:** `chatgpt:<label>`, `claude:<label>`. Conversation IDs differ by platform, so they're never shared across platforms.
- **Why manual labels:** the extension doesn't read account emails or tokens (privacy rule), so it can't detect *which* account is signed in. The user assigns a label per browser profile once. A future option: derive a stable, non-identifying hash from a non-sensitive page signal, *only if* verified safe, and never from cookies or tokens.
- **Chrome Sync (Option A) is tied to the Chrome profile, not the ChatGPT or Claude account.** Two people sharing one Chrome profile share sync. One person using two Chrome profiles has two separate syncs.

## 7. Estimates

| Item | Option A | Option B | Option C |
|---|---|---|---|
| Storage | ≤ 100 KB (hard cap) | ~1 MB for 5,000 records encrypted; the database stays < 10 MB | < 5 MB per backup × 8 |
| Bandwidth | Negligible | < 20 MB per month (incremental pulls) | < 50 MB per month |
| Money | $0 | $0 VM (**VERIFY**), plus $0–15 a year for a domain | $0 |
| Operational complexity | Low | Medium (patches, TLS, backups, monitoring, reclamation risk) | Low (cron, on top of B) |
| Client effort | ~1–2 days | +2–3 days client, ~2 days server, ~1 day ops | ~0.5 day |

## 8. Permission changes (all need approval before implementation)

| Change | Needed by | Install warning |
|---|---|---|
| None | Option A (`storage` already granted) | None |
| `background.service_worker` | A (recommended, for reliable merges) and B | None (it's not a permission) |
| `alarms` | Periodic sync in A and B | None |
| No host permission (CORS allowlist of our extension ID) **or** `optional_host_permissions: ["https://<your-sync-domain>/*"]` | B | No install warning; a runtime prompt if the optional permission is used |
| `https://claude.ai/*` content script | Roadmap Phase 2 (not sync) | "Read and change your data on claude.ai" |

## 9. Oracle verification checklist (you run these; I haven't accessed the account)

Run on the VM with `nproc; free -h; df -h /; uname -m; cat /etc/os-release`, then check in the OCI console:

- **Shape:** `VM.Standard.A1.Flex` (Ampere, aarch64) or `VM.Standard.E2.1.Micro` (AMD).
- **Always Free limits:** the account's current A1 limits. **2026 reports say the allowance was halved to 2 OCPU / 12 GB total**, which matches your 12 GB instance (**VERIFY** on Oracle's Always Free Resources page).
- **Account type:** free or pay-as-you-go. Reports say the new A1 limits also apply to PAYG, with charges above them.
- **Idle reclamation:** sources disagree (CPU 95th percentile below 15% or 20% over 7 days). The sync API is idle almost all the time, so this risk is real on a free account.
- **Allowances:** the outbound data allowance and block-volume usage.

## 10. Implementation phases (after approval)

1. **S0, shared client groundwork (no network):**
   - convert `overrides` and `groups` to namespaced, timestamped records (schema v4 migration with an automatic pre-migration export)
   - HLC timestamps
   - per-record merge and a conflict log
   - account-label UI
   - unit tests
2. **S1, Option A:** opt-in toggle, sharded `storage.sync` (quota checks and partial-failure retry), E2E encryption and pairing kit, Sync Status (Off / Synced / Syncing / Offline / Conflict / Quota), plus tests with two simulated profiles.
3. **S2, Option B (if approved):** server repository (separate from the extension), API and migrations, Caddy, deployment runbook, the client transport, device list and revoke, key rotation.
4. **S3, Option C (if approved):** an encrypted backup cron to Telegram, plus restore drills.
5. **Release:** threat-model review, PRIVACY update (exactly what each option sends), QA on two real PCs.

## 11. Open questions for you

1. Do both PCs use the **same Chrome profile and Google account with Chrome Sync on**? If yes, S1 alone likely suffices.
2. Are you okay with a manual **account label** per platform (for example "personal")?
3. For Option B: do you have a domain for TLS, or should a free dynamic-DNS subdomain be used?
4. Approve adding a **background service worker plus `alarms`**? Both are needed for reliable background sync and add no install warning.
