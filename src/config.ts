import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { pathToFileURL } from "url";

/**
 * Mycelium configuration options.
 */
export interface MyceliumConfig {
  /** Glob patterns for source files to include */
  include?: string[];
  /** Glob patterns to exclude from analysis */
  exclude?: string[];
  /** Database path */
  db?: string;
  /** Path to tsconfig.json */
  tsconfig?: string;
}

/**
 * Result of loading config, includes the path it was loaded from.
 */
export interface LoadedConfig {
  config: MyceliumConfig;
  /** Directory the config was loaded from (for resolving relative paths) */
  configDir: string;
}

const CONFIG_FILES = [
  "mycelium.config.ts",
  "mycelium.config.ts",
  "mycelium.config.json",
];

/**
 * Load mycelium config.
 * If configPath is provided, loads from that file.
 * Otherwise looks for mycelium.config.ts, mycelium.config.js, or mycelium.config.json in cwd.
 */
export async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  // If explicit path provided, load from there
  if (configPath) {
    const resolvedPath = resolve(configPath);
    if (!existsSync(resolvedPath)) {
      console.error(`Config file not found: ${resolvedPath}`);
      return { config: {}, configDir: process.cwd() };
    }
    return {
      config: await loadConfigFile(resolvedPath),
      configDir: dirname(resolvedPath),
    };
  }

  // Otherwise, search for config files in cwd
  for (const configFile of CONFIG_FILES) {
    const filePath = resolve(process.cwd(), configFile);
    if (!existsSync(filePath)) continue;
    return {
      config: await loadConfigFile(filePath),
      configDir: dirname(filePath),
    };
  }

  // Return defaults if no config found
  return { config: {}, configDir: process.cwd() };
}

async function loadConfigFile(configPath: string): Promise<MyceliumConfig> {
  if (configPath.endsWith(".json")) {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content) as MyceliumConfig;
  }

  // For .ts/.js files, use dynamic import
  try {
    const configUrl = pathToFileURL(configPath).href;
    const module = await import(configUrl);
    return (module.default ?? module) as MyceliumConfig;
  } catch (e) {
    console.error(`Failed to load config from ${configPath}:`, e);
    return {};
  }
}

/**
 * Get the effective config by merging loaded config with CLI options.
 * CLI options take precedence over config file.
 */
export function mergeConfig(
  loaded: LoadedConfig,
  cliOptions: Partial<Omit<MyceliumConfig, "tsconfig">>,
): Required<Pick<MyceliumConfig, "include" | "exclude" | "db">> &
  Pick<MyceliumConfig, "tsconfig"> & { configDir: string } {
  return {
    include: cliOptions.include ?? loaded.config.include ?? ["src/**/*.ts"],
    exclude: cliOptions.exclude ?? loaded.config.exclude ?? [],
    db: cliOptions.db ?? loaded.config.db ?? ".mycelium/graph.db",
    tsconfig: loaded.config.tsconfig,
    configDir: loaded.configDir,
  };
}

/**
 * Filter file paths based on exclude patterns.
 */
export function shouldExclude(
  filePath: string,
  excludePatterns: string[],
): boolean {
  if (excludePatterns.length === 0) return false;

  // Convert glob patterns to regex
  for (const pattern of excludePatterns) {
    const regex = globToRegex(pattern);
    if (regex.test(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a file path matches any of the include patterns.
 */
export function shouldInclude(
  filePath: string,
  includePatterns: string[],
): boolean {
  if (includePatterns.length === 0) return true;

  for (const pattern of includePatterns) {
    const regex = globToRegex(pattern);
    if (regex.test(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a file path is allowed by the config (matches include and doesn't match exclude).
 */
export function isPathAllowed(
  filePath: string,
  includePatterns: string[],
  excludePatterns: string[],
): boolean {
  return (
    shouldInclude(filePath, includePatterns) &&
    !shouldExclude(filePath, excludePatterns)
  );
}

/**
 * Convert a glob pattern to a regex.
 * Supports * (any chars except /) and ** (any chars including /)
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*\*\//g, "{{GLOBSTAR_SLASH}}") // **/ means "any path or none"
    .replace(/\*\*/g, "{{GLOBSTAR}}") // ** at end means "anything"
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/{{GLOBSTAR_SLASH}}/g, "(.*\\/)?") // **/ -> optional path with slash
    .replace(/{{GLOBSTAR}}/g, ".*"); // ** -> anything
  return new RegExp(`(^|/)${escaped}$`);
}
