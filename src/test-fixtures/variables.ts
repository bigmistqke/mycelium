// Module-level variables
export let mutableCounter = 0;
export const immutableConfig = { timeout: 1000 };
export var legacyVar = "legacy";

// Destructured variables
export const { name, age } = { name: "test", age: 25 };
export const [first, second] = [1, 2];

// Variable that is read
export const sharedState = { value: 0 };

// Functions that read/write module variables
export function incrementCounter() {
  mutableCounter++;  // writes mutableCounter
  return mutableCounter;  // reads mutableCounter
}

export function readConfig() {
  return immutableConfig.timeout;  // reads immutableConfig
}

export function updateSharedState(newValue: number) {
  sharedState.value = newValue;  // writes sharedState (property mutation)
}

// Function that reads multiple variables
export function summarize() {
  return `${name} is ${age}, counter: ${mutableCounter}`;
}

// Array mutation tracking
export const items: string[] = [];

export function addItem(item: string) {
  items.push(item);  // writes items via mutating method
}

export function clearItems() {
  items.splice(0, items.length);  // writes items via mutating method
}
