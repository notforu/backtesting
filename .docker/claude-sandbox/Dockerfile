# Claude Code Sandbox - Safe environment for max permissions
FROM node:20-slim

# Install all Playwright system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    python3-pip \
    bash \
    # Playwright Chromium dependencies
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libdbus-1-3 \
    libcups2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libcairo2 \
    libpango-1.0-0 \
    libasound2 \
    # Additional X11 libs for headed mode (optional)
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libxi6 \
    libxtst6 \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user first (needed for ownership)
RUN useradd -m -s /bin/bash claude

# Install Playwright globally and download Chromium browser
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npm install -g playwright && \
    npx playwright install chromium && \
    # Create symlink at Google Chrome's default path for Playwright MCP compatibility
    mkdir -p /opt/google/chrome && \
    ln -s /opt/playwright-browsers/chromium-*/chrome-linux/chrome /opt/google/chrome/chrome && \
    # Give claude user ownership so MCP can create temp directories
    chown -R claude:claude /opt/playwright-browsers /opt/google

# Create .claude directory for credentials persistence
RUN mkdir -p /home/claude/.claude && chown -R claude:claude /home/claude/.claude

# Set Playwright browser path for the claude user
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers

USER claude
WORKDIR /workspace

# Default command: run Claude with max permissions
# First run will prompt for OAuth login via browser
ENTRYPOINT ["claude", "-c", "--dangerously-skip-permissions"]
