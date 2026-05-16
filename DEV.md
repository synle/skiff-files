# skiff-files

Fast cross-platform file explorer with FTP / SFTP / SMB and a smart-sync engine. Built with Tauri v2 (Rust backend) and React 19 + TypeScript + MUI on Vite.

## Quick Start

Install dependencies:

```bash
npm ci || npm install --no-fund --prefer-offline
```

Run the full desktop app in dev mode (Rust + Vite together):

```bash
npm run tauri:dev
```

Frontend-only dev (browser preview at http://localhost:1420, faster UI iteration):

```bash
npm run dev
```

## Remote-backend test harness (SFTP / FTP / SMB)

Need real remote servers to develop against? There's a docker-based harness in [`docker/`](./docker/) that spins up SFTP, FTP, and SMB on `127.0.0.1`. Both a `docker-compose.yml` (one-shot, named volumes) and `docker run` recipes (mount a host folder like `~/` on macOS or `D:/` on Windows) are documented in [`docker/docker.md`](./docker/docker.md) — see there for full commands, endpoints, and credentials.

## Credential storage — OS keychain

Saved connection passwords (and any future SFTP key passphrases) live in the **OS keychain**, never on disk. Implementation: [`src-tauri/src/creds.rs`](./src-tauri/src/creds.rs), backed by the `keyring` crate which speaks the native API of each platform:

| Platform | Backend | Audit / management UI |
|----------|---------|------------------------|
| macOS    | Keychain (`Security.framework`) | **Keychain Access.app** (`/System/Applications/Utilities/`) |
| Windows  | Credential Manager (`wincred` + per-user DPAPI) | **Control Panel → User Accounts → Credential Manager → Windows Credentials** |
| Linux    | libsecret over D-Bus (GNOME Keyring / KWallet / KeePassXC) | **Seahorse** (`seahorse`) or the equivalent for your keyring daemon |

The OS encrypts the secret at rest with the user session and refuses to release it to another user or process on the same machine. Only the Skiff Files binary running as the current user can read its own entries.

### Storage shape

Every entry is identified by `(service, account)`:

- **`service`** — always the literal string **`com.synle.skiff-files`** (the app identifier from `tauri.conf.json`). One service per app so the OS audit tools show a single grouping.
- **`account`** — `{kind}:{connection_id}` where:
  - `kind` is `auth` (password — what the Remember-password toggle writes) or `key` (SFTP private-key passphrase — reserved).
  - `connection_id` is the saved connection's UUID, visible in `ConnectionsPage` and persisted alongside the connection metadata.

If you renamed the app identifier, `creds.rs::SERVICE` would need to follow — the unit test `service_constant_matches_app_identifier` guards this so existing users' secrets don't orphan.

### "I forgot my saved password" — recover it

The keychain only returns secrets to the user who wrote them, so this works on the same Mac / PC / Linux user account that saved the password.

**macOS — GUI (Keychain Access.app)**

1. Open **Keychain Access** (Spotlight: `keychain access`).
2. In the search box top-right, search for **`com.synle.skiff-files`**.
3. Each saved connection appears as an *application password* with name `com.synle.skiff-files` and account `auth:<connection-id>`.
4. Double-click → tick **Show password** → enter your macOS login password to reveal.

**macOS — CLI**

```bash
# List every Skiff Files entry on this user's login keychain
security find-generic-password -s "com.synle.skiff-files"

# Print the password for a specific connection (will prompt for login password)
security find-generic-password -s "com.synle.skiff-files" -a "auth:<connection-id>" -w

# Delete one entry
security delete-generic-password -s "com.synle.skiff-files" -a "auth:<connection-id>"
```

**Windows — GUI (Credential Manager)**

1. Start menu → **Credential Manager** (or `control /name Microsoft.CredentialManager`).
2. Pick **Windows Credentials** → expand **Generic Credentials**.
3. Look for entries with target `com.synle.skiff-files/auth:<connection-id>` (the `keyring` crate flattens `service` + `account` into the single Windows target field with `/`).
4. Click an entry → **Show** → re-enter your Windows password to reveal.

**Windows — PowerShell**

```powershell
# Requires the CredentialManager module (Install-Module CredentialManager -Scope CurrentUser)
Get-StoredCredential -Target "com.synle.skiff-files/auth:<connection-id>"
```

**Linux — GUI (Seahorse / KWallet Manager)**

1. Open **Seahorse** ("Passwords and Keys") or **KWallet Manager**.
2. Browse the default login keyring; entries appear under the `com.synle.skiff-files` schema.
3. Right-click → **Show** to reveal (will prompt for your keyring unlock password).

**Linux — CLI**

```bash
# List every Skiff Files secret
secret-tool search service com.synle.skiff-files

# Lookup one (account follows the auth:<connection-id> shape)
secret-tool lookup service com.synle.skiff-files account "auth:<connection-id>"

# Delete one
secret-tool clear   service com.synle.skiff-files account "auth:<connection-id>"
```

### Forgot the connection-id too?

Connection metadata (host, port, kind, label, **id**) lives in the app's settings file. From a running app, **Settings → Connections** lists every saved connection with its id; deleting the connection from there also deletes its keychain entry (the frontend calls `creds_delete` on toggle-off and on connection delete). Outside the app, inspect `settings.json` under the OS app-data dir (`~/Library/Application Support/com.synle.skiff-files/` on macOS, `%APPDATA%\com.synle.skiff-files\` on Windows, `~/.local/share/com.synle.skiff-files/` on Linux).

### Wiping everything

A clean reset is a per-platform loop: on macOS, search Keychain Access for `com.synle.skiff-files` and delete the group; on Windows, remove every Generic Credential under that target; on Linux, `secret-tool clear service com.synle.skiff-files <account>` per entry. The app itself never bulk-deletes secrets — explicit user action only.
