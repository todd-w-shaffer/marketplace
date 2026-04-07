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
.claude-plugin/marketplace.json   # plugin manifest
plugins/<name>/                   # git submodules, one per plugin
```

Each plugin lives in its own repository and is included here as a git submodule. The plugin's own configuration is managed in its respective repo.
