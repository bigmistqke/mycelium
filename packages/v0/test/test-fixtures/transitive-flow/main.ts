// Test transitive dependency resolution through function calls
import { value } from "./value.js";
import { identity } from "./identity.js";

// result depends on identity<return>
// identity<return> depends on identity<param:0>
// At this call site, identity<param:0> was passed `value`
// Therefore: result → identity<return> → identity<param:0> → value
export const result = identity(value);
