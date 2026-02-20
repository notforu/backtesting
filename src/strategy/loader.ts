/**
 * Dynamic strategy loader
 * Loads strategy plugins from the /strategies folder
 */

import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { Strategy, StrategyParam } from './base.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRATEGIES_DIR = path.resolve(__dirname, '../../strategies');

/**
 * Strategy metadata for listing
 */
export interface StrategyInfo {
  name: string;
  description: string;
  version: string;
  params: StrategyParam[];
  filePath: string;
  isPairs?: boolean;
  isMultiAsset?: boolean;
}

/**
 * Cache for loaded strategies
 */
const strategyCache = new Map<string, Strategy>();

/**
 * Load a strategy by name
 * @param name - Strategy name (without .ts extension)
 * @returns The loaded strategy
 * @throws Error if strategy not found or invalid
 */
export async function loadStrategy(name: string): Promise<Strategy> {
  // Check cache first
  if (strategyCache.has(name)) {
    return strategyCache.get(name)!;
  }

  // Determine the file path
  const filePath = path.join(STRATEGIES_DIR, `${name}.ts`);

  if (!existsSync(filePath)) {
    throw new Error(
      `Strategy "${name}" not found at ${filePath}. Use listStrategies() to see available strategies.`
    );
  }

  try {
    // Dynamic import of the strategy module
    const fileUrl = pathToFileURL(filePath).href;
    const module = await import(fileUrl);

    // Get the default export
    const strategy = module.default as Strategy;

    if (!strategy) {
      throw new Error(
        `Strategy "${name}" does not have a default export`
      );
    }

    // Validate strategy structure
    validateStrategy(strategy, name);

    // Cache the loaded strategy
    strategyCache.set(name, strategy);

    return strategy;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load strategy "${name}": ${error.message}`);
    }
    throw error;
  }
}

/**
 * List all available strategies
 * @returns Array of strategy names (without .ts extension)
 */
export async function listStrategies(): Promise<string[]> {
  if (!existsSync(STRATEGIES_DIR)) {
    return [];
  }

  try {
    const files = await readdir(STRATEGIES_DIR);
    return files
      .filter((f) => f.endsWith('.ts') && !f.startsWith('.'))
      .map((f) => f.replace('.ts', ''));
  } catch {
    return [];
  }
}

/**
 * Get detailed information about a strategy
 * @param name - Strategy name
 * @returns Strategy metadata
 */
export async function getStrategyDetails(name: string): Promise<StrategyInfo> {
  const strategy = await loadStrategy(name);

  return {
    name: strategy.name,
    description: strategy.description,
    version: strategy.version,
    params: strategy.params,
    filePath: path.join(STRATEGIES_DIR, `${name}.ts`),
    isPairs: (strategy as any).isPairs === true,
    isMultiAsset: (strategy as any).isMultiAsset === true,
  };
}

/**
 * Get details for all available strategies
 * @returns Array of strategy metadata
 */
export async function getAllStrategyDetails(): Promise<StrategyInfo[]> {
  const names = await listStrategies();
  const details: StrategyInfo[] = [];

  for (const name of names) {
    try {
      const info = await getStrategyDetails(name);
      details.push(info);
    } catch (error) {
      // Log but continue with other strategies
      console.warn(`Warning: Could not load strategy "${name}":`, error);
    }
  }

  return details;
}

/**
 * Validate that a strategy has the required structure
 */
function validateStrategy(strategy: unknown, name: string): void {
  if (!strategy || typeof strategy !== 'object') {
    throw new Error(`Strategy "${name}" must be an object`);
  }

  const s = strategy as Record<string, unknown>;

  // Check required properties
  if (typeof s.name !== 'string' || !s.name) {
    throw new Error(`Strategy "${name}" must have a "name" property`);
  }

  if (typeof s.description !== 'string') {
    throw new Error(`Strategy "${name}" must have a "description" property`);
  }

  if (typeof s.version !== 'string') {
    throw new Error(`Strategy "${name}" must have a "version" property`);
  }

  if (!Array.isArray(s.params)) {
    throw new Error(`Strategy "${name}" must have a "params" array`);
  }

  if (typeof s.onBar !== 'function') {
    throw new Error(`Strategy "${name}" must have an "onBar" method`);
  }

  // Validate params structure
  for (const param of s.params as unknown[]) {
    validateParam(param, name);
  }
}

/**
 * Validate a strategy parameter definition
 */
function validateParam(param: unknown, strategyName: string): void {
  if (!param || typeof param !== 'object') {
    throw new Error(
      `Strategy "${strategyName}" has an invalid parameter (must be an object)`
    );
  }

  const p = param as Record<string, unknown>;

  if (typeof p.name !== 'string' || !p.name) {
    throw new Error(
      `Strategy "${strategyName}" has a parameter without a "name"`
    );
  }

  const validTypes = ['number', 'string', 'boolean', 'select'];
  if (!validTypes.includes(p.type as string)) {
    throw new Error(
      `Strategy "${strategyName}" parameter "${p.name}" has invalid type "${p.type}". Valid types: ${validTypes.join(', ')}`
    );
  }

  if (p.default === undefined) {
    throw new Error(
      `Strategy "${strategyName}" parameter "${p.name}" must have a default value`
    );
  }

  if (typeof p.description !== 'string') {
    throw new Error(
      `Strategy "${strategyName}" parameter "${p.name}" must have a description`
    );
  }

  // Validate select options
  if (p.type === 'select' && (!Array.isArray(p.options) || p.options.length === 0)) {
    throw new Error(
      `Strategy "${strategyName}" parameter "${p.name}" must have "options" array for select type`
    );
  }
}

/**
 * Clear the strategy cache
 * Useful for development when strategies are being edited
 */
export function clearStrategyCache(): void {
  strategyCache.clear();
}

/**
 * Check if a strategy exists
 */
export function strategyExists(name: string): boolean {
  const filePath = path.join(STRATEGIES_DIR, `${name}.ts`);
  return existsSync(filePath);
}
