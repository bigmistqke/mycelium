export * from "./types.js";
export { LouvainDetector, type LouvainOptions } from "./louvain.js";
export { InfomapDetector, type InfomapOptions } from "./infomap.js";

import type { CommunityDetector } from "./types.js";
import { LouvainDetector } from "./louvain.js";
import { InfomapDetector } from "./infomap.js";

/**
 * Available community detection algorithms.
 */
export type AlgorithmName = "louvain" | "infomap";

/**
 * Registry of available community detection algorithms.
 */
const algorithms: Record<AlgorithmName, () => CommunityDetector> = {
  louvain: () => new LouvainDetector(),
  infomap: () => new InfomapDetector(),
};

/**
 * Get a community detector by name.
 */
export function getDetector(name: AlgorithmName): CommunityDetector {
  const factory = algorithms[name];
  if (!factory) {
    throw new Error(`Unknown algorithm: ${name}. Available: ${Object.keys(algorithms).join(", ")}`);
  }
  return factory();
}

/**
 * List available algorithm names.
 */
export function listAlgorithms(): AlgorithmName[] {
  return Object.keys(algorithms) as AlgorithmName[];
}
