#!/usr/bin/env node
/**
 * CLI tool for validating strategy files
 * Usage: npx tsx src/cli/quant-validate.ts <file-path>
 *
 * Validates that a strategy file:
 * - Has a default export
 * - Contains required properties (name, description, version, params, onBar)
 *
 * Outputs JSON to stdout (for parsing by agents):
 * - Success: {"valid":true,"name":"...","params":[...]}
 * - Failure: {"valid":false,"errors":[...]}
 *
 * All logging/errors go to stderr
 */

import { pathToFileURL } from 'url';
import path from 'path';
import { existsSync } from 'fs';
import type { Strategy } from '../strategy/base.js';

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Error: Missing file path argument');
    console.error('Usage: npx tsx src/cli/quant-validate.ts <file-path>');
    process.stdout.write(JSON.stringify({ valid: false, errors: ['Missing file path argument'] }));
    process.exit(1);
  }

  const filePath = args[0];

  // Resolve relative to cwd
  const resolvedPath = path.resolve(process.cwd(), filePath);

  if (!existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.stdout.write(JSON.stringify({ valid: false, errors: [`File not found: ${resolvedPath}`] }));
    process.exit(1);
  }

  console.error(`Validating strategy file: ${resolvedPath}`);

  try {
    // Dynamic import of the strategy file
    const fileUrl = pathToFileURL(resolvedPath).href;
    const module = await import(fileUrl);

    // Check for default export
    if (!module.default) {
      process.stdout.write(JSON.stringify({
        valid: false,
        errors: ['Strategy file must have a default export']
      }));
      process.exit(1);
    }

    const strategy = module.default as Strategy;

    // Validate required properties
    const errors: string[] = [];

    if (!strategy.name || typeof strategy.name !== 'string') {
      errors.push('Strategy must have a "name" property (string)');
    }

    if (!strategy.description || typeof strategy.description !== 'string') {
      errors.push('Strategy must have a "description" property (string)');
    }

    if (!strategy.version || typeof strategy.version !== 'string') {
      errors.push('Strategy must have a "version" property (string)');
    }

    if (!Array.isArray(strategy.params)) {
      errors.push('Strategy must have a "params" array');
    }

    if (typeof strategy.onBar !== 'function') {
      errors.push('Strategy must have an "onBar" method (function)');
    }

    if (errors.length > 0) {
      process.stdout.write(JSON.stringify({ valid: false, errors }));
      process.exit(1);
    }

    // Valid strategy
    console.error('Strategy validation passed');
    process.stdout.write(JSON.stringify({
      valid: true,
      name: strategy.name,
      description: strategy.description,
      version: strategy.version,
      params: strategy.params,
    }));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error loading strategy: ${message}`);
    process.stdout.write(JSON.stringify({
      valid: false,
      errors: [`Failed to load strategy: ${message}`]
    }));
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.stdout.write(JSON.stringify({
    valid: false,
    errors: [`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`]
  }));
  process.exit(1);
});
