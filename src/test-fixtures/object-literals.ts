// Helper function to be called
function helperFunction() {
  return "helper";
}

// Assigned object with shorthand methods
export const api = {
  fetchData() {
    return helperFunction();
  },
  // Property assignment with arrow function
  postData: () => {
    return "post";
  },
  // Property assignment with function expression
  deleteData: function () {
    return "delete";
  },
};

// Stub for expose function (simulating worker pattern)
declare function expose<T>(methods: T): void;
declare function register<T>(handlers: T): void;
declare function curry<T>(obj: T): { next: <U>(obj: U) => void };

// Object literal passed as call argument
expose({
  start() {
    // Calls helper
    helperFunction();

    // Nested function inside method
    const helper = () => {
      return "nested helper";
    };

    return helper();
  },
  stop: () => {
    return "stopped";
  },
});

// Nested scope: call argument inside a function
export function outerFunction() {
  const localVar = 1;

  register({
    init() {
      return localVar;
    },
    cleanup: () => {
      return "cleanup";
    },
  });
}

// Chained calls with object arguments
curry({ a() { return "a"; } }).next({ b() { return "b"; } });

// Multiple calls to same function (should have different positions)
expose({ first() { return 1; } });
expose({ second() { return 2; } });
