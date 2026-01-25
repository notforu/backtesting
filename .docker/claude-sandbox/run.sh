#!/bin/bash
# Run Claude Code in a sandboxed Docker container with max permissions
#
# Usage:
#   ./run.sh                    # Run in current project
#   ./run.sh /path/to/project   # Run in specific project
#   ./run.sh --build            # Rebuild image first
#
# Authentication: Uses your existing ~/.claude OAuth credentials (mounted read-only)
# Or set ANTHROPIC_API_KEY environment variable

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for rebuild flag
if [[ "$1" == "--build" ]]; then
    echo "Rebuilding Claude sandbox image..."
    docker-compose build --no-cache
    shift
fi

# Determine project directory
if [[ -n "$1" && -d "$1" ]]; then
    PROJECT_DIR="$(cd "$1" && pwd)"
else
    # Default to backtesting project root
    PROJECT_DIR="$(cd ../.. && pwd)"
fi

echo "Starting Claude Code sandbox..."
echo "Project: $PROJECT_DIR"
echo "Mode: --dangerously-skip-permissions (sandboxed)"
echo "Auth: ~/.claude credentials (read-only mount)"
echo ""

# Run the container
PROJECT_DIR="$PROJECT_DIR" docker-compose run --rm claude
