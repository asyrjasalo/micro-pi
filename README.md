# msbox

Run [Pi Coding Agent](https://github.com/mariozechner/pi-coding-agent) inside a [microsandbox](https://github.com/superradcompany/microsandbox) VM.

The sandbox is reused across runs — no recreation unless you explicitly reset it. Your project directory is bind-mounted, so changes are live.

## Setup

Requires [Bun](https://bun.sh) and one of the supported API keys:

```sh
export ZAI_API_KEY=...
# or MINIMAX_API_KEY=...
```

## Usage

```sh
# Start pi in current directory (creates sandbox on first run)
bun start

# Force fresh sandbox (removes existing)
bun run reset

# Lint + typecheck + tests
bun run check
```

On first run, msbox:

1. Installs the microsandbox runtime (`~/.microsandbox/`)
2. Creates a VM from `node:24-slim` (2 CPUs, 2 GiB RAM)
3. Upgrades glibc from Debian trixie (required by [rtk](https://github.com/rtk-ai/rtk))
4. Generates `en_US.UTF-8` locale
5. Installs git, ripgrep, fd-find, ca-certificates, curl, locales, rtk, and pi coding agent inside the VM
6. Copies your `~/.pi/agent/` config (settings, extensions, skills, themes, etc.) into the VM — symlinks are dereferenced

Subsequent runs reconnect to the existing sandbox (starts it if stopped). Pi config changes on the host require a `bun run reset` to take effect inside the VM.

## What gets copied

Files from `~/.pi/agent/` and root-level `~/.pi/` files (e.g. `web-search.json`) are copied into the sandbox on creation. Excluded:

- `sessions/` — session history
- `git/` — git state
- `mcp-cache.json` — regenerated automatically

## Environment forwarding

Terminal and git env vars are forwarded into the sandbox:

`TERM`, `COLORTERM`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `NO_COLOR`, `FORCE_COLOR`, `LANG`, `LC_ALL`, `EMAIL`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, `PI_RUN_CODE_UNSANDBOXED`

Non-ASCII values are passed through as-is.

## API keys

API keys are passed into the sandbox as environment variables. At least one is required.

| Key |
|-----|
| `ZAI_API_KEY` |
| `MINIMAX_API_KEY` |
