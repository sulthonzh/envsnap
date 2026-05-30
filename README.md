# envsnap

Snapshot your dev environment. Diff it. Stop saying "works on my machine."

## The Problem

Your app works locally but fails in CI. Or works for you but breaks for your teammate. You spend hours comparing Node versions, env vars, running processes, platform differences. Docker is overkill for debugging. `nvm`/`asdf`/`mise` manage ONE thing, not the full picture.

Nothing captures your *complete* dev environment state and tells you what's different.

## The Solution

`envsnap` is a CLI that captures a full snapshot of your development environment:

- **Runtimes**: node, python, go, rust, java, ruby, php, docker, and more
- **Environment variables**: names only (values redacted for security)
- **Git state**: branch, commit, dirty status, stash count
- **Listening ports**: what's running and where
- **Lockfile hashes**: detect dependency drift
- **Platform info**: OS, arch, memory, CPUs
- **Global packages**: npm, pip

Then diff two snapshots to see exactly what changed.

## Install

```bash
npm install -g envsnap
```

## Usage

### First time setup

```bash
cd your-project
envsnap init          # creates .envsnap/ and adds to .gitignore
```

### Take a snapshot

```bash
envsnap capture       # saves snapshot to .envsnap/
```

### Compare environments

```bash
# Compare latest snapshot against current environment
envsnap diff

# Compare a specific snapshot against current environment
envsnap diff .envsnap/snapshot-2026-05-30T12-00-00-000Z.json

# Compare two specific snapshots
envsnap diff snapshot-a.json snapshot-b.json
```

### CI integration

```bash
envsnap ci            # minimal snapshot for CI (no ports/processes)
envsnap ci --json     # JSON output for pipeline consumption
```

Diff exit codes:
- `0` — environments match
- `2` — critical differences found (fail the build)

### List & inspect

```bash
envsnap list          # show all saved snapshots
envsnap show          # show latest snapshot details
envsnap show <file>   # show specific snapshot
```

### JSON output

All commands support `--json` for scripting:

```bash
envsnap capture --json
envsnap diff --json
envsnap list --json
```

## Real-world workflows

### "Works on my machine" debugging

```bash
# On your machine (where it works)
envsnap capture

# Share the snapshot with your teammate
# (it's just a JSON file, no secrets — env values are excluded)

# On their machine
envsnap diff .envsnap/latest.json
# → Shows: node 20.11.0 → 18.17.0, missing NODE_ENV, port 5432 not listening
```

### CI baseline

```yaml
# In your CI pipeline
- name: Capture CI environment
  run: envsnap ci --json > ci-env.json

# On failure, diff against local
- name: Diff environments
  run: envsnap diff local-snapshot.json ci-env.json
```

### Before/after upgrades

```bash
envsnap capture        # snapshot before
# ... upgrade node, change packages, etc
envsnap diff           # see everything that changed
```

## What's captured

| Category | Data | Security |
|----------|------|----------|
| Runtimes | node, npm, python, go, rust, java, etc. | ✅ Safe — versions only |
| Env vars | Variable names | ✅ Safe — names only, no values |
| Git | Branch, commit, dirty, stash count | ✅ Safe |
| Ports | Listening TCP ports + process names | ✅ Safe |
| Platform | OS, arch, CPUs, RAM | ✅ Safe |
| Lockfile | Filename + SHA hash | ✅ Safe |
| Global pkgs | npm/pip package names | ✅ Safe |

**No secrets are ever captured.** Environment variable values are excluded by default.

## Diff severity levels

- 🔴 **Critical** — Runtime version changes, platform/arch changes, lockfile drift (will likely break things)
- 🟡 **Warning** — Missing env vars, missing runtimes, git state differences (might break things)
- ℹ️ **Info** — New env vars, new runtimes, hostname changes (usually harmless)

## Requirements

- Node.js 18+
- Git (for git state capture)

## License

MIT
