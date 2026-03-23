#!/bin/bash
# Install purify globally
DEST="$HOME/.config/opencode/scripts/purify"
mkdir -p "$DEST"
cp -r src tsconfig.json package.json "$DEST/"
cd "$DEST" && npm install
chmod +x src/cli.ts src/mcp.ts

# Symlink CLI to PATH
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/purify" << 'WRAPPER'
#!/bin/bash
exec "$HOME/.config/opencode/scripts/purify/node_modules/.bin/tsx" "$HOME/.config/opencode/scripts/purify/src/cli.ts" "$@"
WRAPPER
chmod +x "$HOME/.local/bin/purify"

# Symlink MCP server to PATH
cat > "$HOME/.local/bin/purify-mcp" << 'WRAPPER'
#!/bin/bash
exec "$HOME/.config/opencode/scripts/purify/node_modules/.bin/tsx" "$HOME/.config/opencode/scripts/purify/src/mcp.ts" "$@"
WRAPPER
chmod +x "$HOME/.local/bin/purify-mcp"

echo "purify installed. Make sure ~/.local/bin is in your PATH."
