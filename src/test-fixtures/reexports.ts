// Test cases for re-exports

// Named re-export
export { namedHelper } from "./exports.js";

// Renamed re-export
export { namedConfig as config } from "./exports.js";

// Re-export default as named
export { default as mainFn } from "./exports.js";

// Star re-export (all exports from module)
export * from "./aliases.js";
