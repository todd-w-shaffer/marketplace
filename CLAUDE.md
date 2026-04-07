# Marketplace

A Claude Code plugin marketplace by Todd Shaffer. Users add this marketplace and install plugins from it.

## ABSOLUTE RULES

**NEVER delete files or directories without explicit permission.** No exceptions.

## Structure

```
.claude-plugin/marketplace.json   # plugin manifest — the source of truth
plugins/<name>/                   # git submodules, one per plugin
.gitmodules                       # submodule config
```

Each plugin submodule must contain its own `.claude-plugin/plugin.json`.

## Usage

```bash
# Add marketplace
claude plugin marketplace add todd-w-shaffer/marketplace

# Install a plugin
claude plugin install coolant@todd-w-shaffer
```

The marketplace name is `todd-w-shaffer`. Install syntax is `pluginname@todd-w-shaffer`.

## Adding a new plugin

1. Add the submodule:
   ```bash
   git submodule add https://github.com/todd-w-shaffer/<repo>.git plugins/<name>
   ```

2. Add an entry to `.claude-plugin/marketplace.json` under `plugins`:
   ```json
   {
     "name": "<name>",
     "description": "Short description",
     "source": "./plugins/<name>",
     "category": "development"
   }
   ```

3. Commit both `.gitmodules` and the submodule reference.

The plugin repo itself must have a `.claude-plugin/plugin.json` — that's the plugin's own concern, not the marketplace's.
