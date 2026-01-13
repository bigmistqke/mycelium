// File B - imports and calls functions from File A
import { utilityFunction, helperArrow, ServiceA } from "./cross-file-a.js";

export function caller() {
  utilityFunction();  // cross-file call
  helperArrow();      // cross-file call
  return "called";
}

export function useService() {
  const service = new ServiceA();
  service.process();  // cross-file method call
  return service;
}

// Local function that is also called
function localHelper() {
  return "local";
}

export function mixedCalls() {
  localHelper();       // same-file call
  utilityFunction();   // cross-file call
  return "mixed";
}
