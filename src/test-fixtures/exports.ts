// Test cases for export tracking

// Named export
export function namedHelper() {
  return "named";
}

export const namedConfig = { value: 42 };

// Function to be default exported
function mainFunction() {
  return "main";
}

// Default export pointing to named function
export default mainFunction;
