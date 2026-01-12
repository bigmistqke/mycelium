import { createHash } from "crypto";

/**
 * Compute a hash of the given string using SHA-256.
 * Returns first 16 characters of the hex digest.
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Compute signature hash from a function/type signature.
 * Normalizes whitespace before hashing.
 */
export function computeSignatureHash(signature: string): string {
  const normalized = signature.replace(/\s+/g, " ").trim();
  return computeHash(normalized);
}

/**
 * Compute implementation hash from function body.
 * Uses raw source text (decided: start simple, upgrade to AST later if needed).
 */
export function computeImplHash(body: string): string {
  return computeHash(body);
}
