# Marketplace

A Claude Code plugin marketplace by [Todd Shaffer](https://github.com/todd-w-shaffer). This repository hosts plugins for apps I create, making them easy to discover and install through Claude Code's plugin system.

## Installation

Add this marketplace to Claude Code:

```bash
claude plugin marketplace add todd-w-shaffer/marketplace
```

## Available Plugins

| Plugin | Description |
|--------|-------------|
| [coolant](https://github.com/todd-w-shaffer/coolant) | Thermal management for Claude Code — caps test runner concurrency, suppresses build tools during parallel mode |
| [commit-skill](plugins/commit-skill) | `/commit`: structured narrative commits with build validation, plus a per-commit cost line. `/ship`: push, then update the docs the push made stale. `commit-gate install` (from a terminal) makes git refuse a Claude Code session's commits outside `/commit` and `/ship` in that repository |
| [ship-skill](plugins/ship-skill) | `/ship`: push, then find and update the docs the push made stale. Requires commit-skill, which provides `/commit` and the `token-ledger` cost script |
| [sittings](plugins/sittings) | `/savor` audits a spec before you build it; `/observations` surfaces test gaps, stale docs and architecture notes after |
| [clearmind](plugins/clearmind) | `/clearmind`: audit auto-memory for stale, shipped or redundant entries |

Install any plugin with:

```bash
claude plugin install <plugin-name>@todd-w-shaffer
```

For example:

```bash
claude plugin install coolant@todd-w-shaffer
```

## Structure

```
.claude-plugin/marketplace.json   # the plugin list
plugins/<name>/                   # skill plugins that live in this repo
```

Larger plugins with their own code and tests, like coolant, live in their own repositories and are
listed here by URL.

## License

MIT, except where a plugin's own repository says otherwise.
