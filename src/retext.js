/**
 * The prose libraries a seeded document may reach for, re-exported so that it
 * can reach them.
 *
 * A seeded corpus lives in somebody else's repository and depends on one
 * package. Its documents run through the module hook, which mints each module
 * beside the real file, so a bare specifier resolves from the consumer's own
 * tree — where nothing but this package is installed. Under a flat
 * node_modules a transitive dependency happens to be reachable anyway, which is
 * the kind of accident that works until somebody switches package manager.
 *
 * So a seeded document may import this package and nothing else, and whatever
 * it needs beyond that arrives here. One rule needs this today. A second one
 * would extend the list rather than change the rule.
 */
export { retext } from "retext"
export { default as retextPassive } from "retext-passive"
