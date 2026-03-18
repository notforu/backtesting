-- Migration: 017_add_platform_settings
-- Creates a general-purpose key-value store for platform-wide settings.
-- Used initially to persist kill switch configuration for paper and live trading.

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
