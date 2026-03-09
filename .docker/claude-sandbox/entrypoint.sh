#!/bin/bash
# Entrypoint: set up SSH known hosts, then start Claude Code

# Populate known_hosts if missing (first boot or fresh volume)
if [ ! -f "$HOME/.ssh/known_hosts" ]; then
  ssh-keyscan github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
  ssh-keyscan 5.223.56.226 >> "$HOME/.ssh/known_hosts" 2>/dev/null
fi

# Generate SSH key if none exists (first boot)
if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
  ssh-keygen -t ed25519 -C "claude-docker" -f "$HOME/.ssh/id_ed25519" -N "" >/dev/null 2>&1
  echo ""
  echo "================================================"
  echo "  New SSH key generated. Add this public key to:"
  echo "  1. GitHub deploy keys (with write access)"
  echo "  2. Prod server authorized_keys"
  echo "================================================"
  cat "$HOME/.ssh/id_ed25519.pub"
  echo "================================================"
  echo ""
fi

exec claude --dangerously-skip-permissions "$@"
