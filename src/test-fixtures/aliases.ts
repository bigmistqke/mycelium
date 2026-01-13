// Test cases for alias tracking

// Simple function to alias
export function originalFunction() {
  return "original";
}

// Variable aliasing a function
export const aliasedFunction = originalFunction;

// Chain of aliases
export const secondAlias = aliasedFunction;
export const thirdAlias = secondAlias;

// Object with methods
export const utils = {
  helper() {
    return "help";
  },
  process() {
    return "processed";
  },
};

// Property access alias
export const helperAlias = utils.helper;

// Variable aliasing another variable
export const baseValue = 42;
export const valueAlias = baseValue;
