export * from "./types.js";
export { LouvainDetector, type LouvainOptions } from "./louvain.js";

import type { CommunityDetector } from "./types.js";
import { LouvainDetector } from "./louvain.js";

/**
 * Available community detection algorithms.
 */
export type AlgorithmName = "louvain";

/**
 * Registry of available community detection algorithms.
 */
const algorithms: Record<AlgorithmName, () => CommunityDetector> = {
  louvain: () => new LouvainDetector(),
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
