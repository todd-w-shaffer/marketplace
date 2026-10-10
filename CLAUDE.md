# Marketplace

A Claude Code plugin marketplace by Todd Shaffer. Users add this marketplace and install plugins from it.

## ABSOLUTE RULES

**NEVER delete files or directories without explicit permission.** No exceptions.

## Structure

```
.claude-plugin/marketplace.json   # the plugin list
plugins/<name>/                   # skill plugins that live in this repo
```

Small skill plugins live here under `plugins/<name>/`, listed with a relative source
(`"source": "./plugins/<name>"`). Larger plugins with their own code and tests (coolant) live in
their own repos and are listed by URL. No submodules.

Tests: `node --test plugins/commit-skill/test/*.test.js`. CI (`.github/workflows/ci.yml`)
runs them and `claude plugin validate` on every push to `main`.

Work goes straight to `main`; no PRs. Commit with `/commit`: subjects are `<type>(<scope>): <subject>`
with a Recipe and Changes body. Older commits in other styles predate the convention.

On the maintainer's machine the marketplace is registered as a local directory source, so
`claude plugin update` and `/reload-plugins` pick up this working copy, uncommitted edits included,
and commit-skill's `bin/` is on PATH from here. Anyone who installs by URL gets what's on GitHub.

## Usage

```bash
# Add marketplace
claude plugin marketplace add todd-w-shaffer/marketplace

# Install a plugin
claude plugin install coolant@todd-w-shaffer
```

The marketplace name is `todd-w-shaffer`. Install syntax is `pluginname@todd-w-shaffer`.

## Adding a new plugin

A skill plugin: add `plugins/<name>/.claude-plugin/plugin.json` and `plugins/<name>/skills/...`,
then an entry in `.claude-plugin/marketplace.json`:

```json
{ "name": "<name>", "description": "Short description", "source": "./plugins/<name>", "category": "<category>" }
```

A plugin in its own repo: list it by URL instead:

```json
{
  "name": "<name>",
  "description": "Short description",
  "source": { "source": "url", "url": "https://github.com/todd-w-shaffer/<repo>.git" },
  "category": "<category>"
}
```

Run `claude plugin validate .` and `claude plugin validate plugins/<name>` before committing.
