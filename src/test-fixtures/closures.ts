// Closure variable that is mutated by nested function
export function createCounter() {
  let count = 0;  // closure variable - mutated by nested functions

  function increment() {
    count++;  // mutates closure variable
  }

  function decrement() {
    count--;  // mutates closure variable
  }

  const reset = () => {
    count = 0;  // mutates closure variable
  };

  return { increment, decrement, reset, getCount: () => count };
}

// Closure variable that is only read (should NOT be tracked)
export function createReader() {
  const config = { maxRetries: 3 };  // NOT mutated, just read

  function getMaxRetries() {
    return config.maxRetries;  // only reads, doesn't mutate
  }

  return { getMaxRetries };
}

// Multiple nested levels
export function outer() {
  let outerVar = 0;

  function middle() {
    let middleVar = 0;

    function inner() {
      outerVar++;  // mutates outer's variable
      middleVar++;  // mutates middle's variable
    }

    return inner;
  }

  return middle;
}

// Closure with array mutation
export function createList() {
  const items: string[] = [];

  function add(item: string) {
    items.push(item);  // mutates via method
  }

  function remove() {
    items.pop();  // mutates via method
  }

  return { add, remove, items };
}
