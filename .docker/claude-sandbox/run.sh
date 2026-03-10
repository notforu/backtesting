#!/bin/bash
# Run Claude Code in a sandboxed Docker container with max permissions
#
# Usage:
#   ./run.sh                    # Run fresh session
#   ./run.sh -c                 # Continue last session
#   ./run.sh -r                 # Resume specific session (interactive picker)
#   ./run.sh /path/to/project   # Run in specific project
#   ./run.sh --build            # Rebuild image first
#
# Authentication: Uses your existing ~/.claude OAuth credentials (mounted read-only)
# Or set ANTHROPIC_API_KEY environment variable

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Parse flags
CLAUDE_ARGS=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --build)
            echo "Rebuilding Claude sandbox image..."
            docker-compose build --no-cache
            shift
            ;;
        -c|--continue)
            CLAUDE_ARGS="--continue"
            shift
            ;;
        -r|--resume)
            CLAUDE_ARGS="--resume"
            shift
            ;;
        *)
            break
            ;;
    esac
done

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
[[ -n "$CLAUDE_ARGS" ]] && echo "Args: $CLAUDE_ARGS"
echo ""

# Run the container
PROJECT_DIR="$PROJECT_DIR" docker-compose run --rm claude $CLAUDE_ARGS
