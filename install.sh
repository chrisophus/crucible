#!/bin/bash
# Install purify globally
DEST="$HOME/.config/opencode/scripts/purify"
mkdir -p "$DEST"
cp purify.ts tsconfig.json package.json "$DEST/"
cd "$DEST" && npm install
chmod +x purify.ts

# Symlink to PATH
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/purify" << 'WRAPPER'
#!/bin/bash
exec node --import tsx/esm "$HOME/.config/opencode/scripts/purify/purify.ts" "$@"
WRAPPER
chmod +x "$HOME/.local/bin/purify"
echo "purify installed. Make sure ~/.local/bin is in your PATH."
