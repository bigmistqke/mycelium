// Test cases for import tracking

// Default import
import mainFn from "./exports.js";

// Named imports
import { namedHelper, namedConfig } from "./exports.js";

// Renamed import
import { namedHelper as helper } from "./exports.js";

// Namespace import
import * as allExports from "./exports.js";

// Use imports to avoid unused warnings
export function useImports() {
  console.log(mainFn());
  console.log(namedHelper());
  console.log(namedConfig.value);
  console.log(helper());
  console.log(allExports.namedHelper());
}
