// Test cases for dependency tracking

// Simple variable dependencies
export const baseValue = 42;
export const derivedValue = baseValue + 10;

// Function return dependencies
export function getBase() {
  return baseValue;
}

export function getDerived() {
  return derivedValue;
}

// Call site dependencies
export const resultFromCall = getBase();

// Multiple dependencies
export function combine(a: number, b: number) {
  return a + b;
}

export const sum = combine(baseValue, derivedValue);

// Chained calls
export function double(x: number) {
  return x * 2;
}

export const chainedResult = double(getBase());

// Object literal dependencies
export const config = {
  value: baseValue,
  computed: derivedValue + 5,
};

// Array dependencies
export const items = [baseValue, derivedValue, getBase()];

// Conditional dependencies
export const conditional = baseValue > 0 ? derivedValue : 0;

// Template literal dependencies
export const message = `Value: ${baseValue}, Derived: ${derivedValue}`;

// Arrow function return
export const arrowFn = () => baseValue + derivedValue;

// Function that returns result of another function
export function wrapper() {
  return getBase();
}
