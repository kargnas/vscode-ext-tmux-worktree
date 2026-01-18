#!/bin/bash
# Discovery verification script

set -e

echo "🔍 Testing project discovery..."

CONFIG_DIR="$HOME/.config/tmux-worktree-tui"
CONFIG_FILE="$CONFIG_DIR/config.json"

mkdir -p "$CONFIG_DIR"

cat > "$CONFIG_FILE" << EOF
{
  "search_paths": ["~/projects"],
  "depth": 3
}
EOF

echo "✅ Config created: $CONFIG_FILE"
cat "$CONFIG_FILE"

echo ""
echo "🚀 Running discovery (dry-run with list command simulation)..."

cd "$(dirname "$0")"
go run . --dry-run 2>&1 || echo "(Expected: Will launch TUI)"

echo ""
echo "✨ Manual test instructions:"
echo "1. Run: cd cli && go run ."
echo "2. Expected: Projects from ~/projects should be listed"
echo "3. Press 'c' to add more paths"
echo "4. Press '?' to see help (now with better styling)"
echo "5. If no projects: Check if ~/projects has git repos (.git folders)"
