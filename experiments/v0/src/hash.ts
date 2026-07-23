import { createHash } from "crypto";

/**
 * Computes a SHA-256 hash of the input string, returning the first 16 hex characters. Used as the base hashing function for both signature and implementation hashes.
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Computes a deterministic hash for function/type signatures by normalizing whitespace before hashing. Used to detect when a function's interface changes between commits.
 */
export function computeSignatureHash(signature: string): string {
  const normalized = signature.replace(/\s+/g, " ").trim();
  return computeHash(normalized);
}

/**
 * Computes a hash of function body source text to detect implementation changes. Simpler than AST-based hashing, catches any code modification including formatting.
 */
export function computeImplHash(body: string): string {
  return computeHash(body);
}
