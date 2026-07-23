// Named function declaration
export function namedFunction() {
  return "named";
}

// Arrow function assigned to variable
export const arrowFunction = () => {
  return "arrow";
};

// Function expression assigned to variable
export const functionExpression = function () {
  return "expression";
};

// Class with methods
export class MyClass {
  classMethod() {
    return "class method";
  }

  static staticMethod() {
    return "static";
  }
}

// Nested functions
export function outerFunction() {
  function innerFunction() {
    return "inner";
  }

  const nestedArrow = () => {
    return "nested arrow";
  };

  return innerFunction() + nestedArrow();
}

// Function that calls other functions
export function caller() {
  namedFunction();
  arrowFunction();
  return outerFunction();
}
