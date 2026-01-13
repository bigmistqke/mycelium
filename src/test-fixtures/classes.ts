// Class with properties and methods that access them

export class Counter {
  // Instance properties
  count = 0;
  readonly maxCount = 100;
  items: string[] = [];

  // Methods that read/write this.x
  increment() {
    this.count++;  // writes this.count
    return this.count;  // reads this.count
  }

  decrement() {
    this.count--;  // writes this.count
  }

  reset() {
    this.count = 0;  // writes this.count
  }

  getCount() {
    return this.count;  // reads this.count
  }

  getMax() {
    return this.maxCount;  // reads this.maxCount
  }

  addItem(item: string) {
    this.items.push(item);  // writes this.items via mutating method
  }

  getItems() {
    return this.items;  // reads this.items
  }

  // Method that reads multiple properties
  summary() {
    return `Count: ${this.count}/${this.maxCount}, Items: ${this.items.length}`;
  }
}

// Class with static properties
export class Config {
  static version = "1.0.0";
  static readonly appName = "MyApp";

  static getVersion() {
    return this.version;
  }

  static setVersion(v: string) {
    this.version = v;
  }
}

// Class that calls another method
export class Service {
  data: string | null = null;

  fetchData() {
    this.data = "fetched";
    return this.data;
  }

  processData() {
    if (this.data) {  // reads this.data
      return this.data.toUpperCase();
    }
    return null;
  }

  clear() {
    this.data = null;  // writes this.data
  }
}
