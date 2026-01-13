import { describe, it, expect, beforeEach } from "vitest";
import { TypeScriptAnalyzer } from "./analyzer.js";
import { computeHash, computeSignatureHash, computeImplHash } from "./hash.js";

describe("TypeScriptAnalyzer", () => {
  let analyzer: TypeScriptAnalyzer;

  beforeEach(() => {
    analyzer = new TypeScriptAnalyzer();
  });

  describe("extractFunctions", () => {
    it("extracts named function declarations", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      // Use the analyze method which calls extractFunctions internally
      const result = analyzer.analyze("test-commit");

      const fn = result.entities.find(e => e.name === "namedFunction");
      expect(fn).toBeDefined();
      expect(fn?.kind).toBe("function");
    });

    it("extracts arrow functions assigned to variables", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      const fn = result.entities.find(e => e.name === "arrowFunction");
      expect(fn).toBeDefined();
      expect(fn?.kind).toBe("function");
    });

    it("extracts class methods", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      const fn = result.entities.find(e => e.name === "MyClass.classMethod");
      expect(fn).toBeDefined();
      expect(fn?.kind).toBe("function");
    });
  });

  describe("object literal methods", () => {
    it("extracts shorthand methods from assigned objects", () => {
      analyzer.addSourceFiles(["src/test-fixtures/object-literals.ts"]);
      const result = analyzer.analyze("test-commit");

      const method = result.entities.find(e => e.name === "api::fetchData");
      expect(method).toBeDefined();
      expect(method?.kind).toBe("function");
    });

    it("extracts property assignment methods from assigned objects", () => {
      analyzer.addSourceFiles(["src/test-fixtures/object-literals.ts"]);
      const result = analyzer.analyze("test-commit");

      const method = result.entities.find(e => e.name === "api::postData");
      expect(method).toBeDefined();
      expect(method?.kind).toBe("function");
    });

    it("extracts methods from object literals passed as call arguments", () => {
      analyzer.addSourceFiles(["src/test-fixtures/object-literals.ts"]);
      const result = analyzer.analyze("test-commit");

      // Should find a method with the [line:col]funcName(argIdx)::methodName pattern
      const method = result.entities.find(e =>
        e.name.includes("expose") && e.name.includes("::start")
      );
      expect(method).toBeDefined();
      expect(method?.kind).toBe("function");
      // Verify the naming pattern
      expect(method?.name).toMatch(/\[\d+:\d+\]expose\(0\)::start/);
    });

    it("tracks calls from object literal methods", () => {
      analyzer.addSourceFiles(["src/test-fixtures/object-literals.ts"]);
      const result = analyzer.analyze("test-commit");

      // The start method should call helperFunction
      const callRelation = result.relations.find(r =>
        r.from_id.includes("::start") && r.to_id.includes("::helperFunction")
      );
      expect(callRelation).toBeDefined();
      expect(callRelation?.kind).toBe("calls");
    });

    it("handles nested scopes correctly for call argument methods", () => {
      analyzer.addSourceFiles(["src/test-fixtures/object-literals.ts"]);
      const result = analyzer.analyze("test-commit");

      // Find method inside a function scope
      const nestedMethod = result.entities.find(e =>
        e.name.includes("outerFunction") && e.name.includes("register") && e.name.includes("::init")
      );
      expect(nestedMethod).toBeDefined();
    });

    it("differentiates chained call arguments", () => {
      analyzer.addSourceFiles(["src/test-fixtures/object-literals.ts"]);
      const result = analyzer.analyze("test-commit");

      // curry({ a() {} }).next({ b() {} }) should create two distinct methods
      const methodA = result.entities.find(e => e.name.includes("curry") && e.name.includes("::a"));
      const methodB = result.entities.find(e => e.name.includes("next") && e.name.includes("::b"));

      expect(methodA).toBeDefined();
      expect(methodB).toBeDefined();
      // They should have different IDs (different column positions)
      expect(methodA?.id).not.toBe(methodB?.id);
    });
  });

  describe("nested functions", () => {
    it("extracts nested functions with :: separator", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      const nested = result.entities.find(e => e.name === "outerFunction::innerFunction");
      expect(nested).toBeDefined();
      expect(nested?.kind).toBe("function");
    });

    it("extracts nested functions inside object literal methods", () => {
      analyzer.addSourceFiles(["src/test-fixtures/object-literals.ts"]);
      const result = analyzer.analyze("test-commit");

      // The start method has a nested isCurrentSession function
      const nested = result.entities.find(e =>
        e.name.includes("::start::") && e.name.includes("helper")
      );
      expect(nested).toBeDefined();
    });
  });

  describe("call graph", () => {
    it("tracks function calls", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      const callRelation = result.relations.find(r => r.kind === "calls");
      expect(callRelation).toBeDefined();
    });

    it("tracks cross-file function calls", () => {
      analyzer.addSourceFiles([
        "src/test-fixtures/cross-file-a.ts",
        "src/test-fixtures/cross-file-b.ts",
      ]);
      const result = analyzer.analyze("test-commit");

      // caller() should call utilityFunction
      const crossFileCall = result.relations.find(
        r => r.from_id.includes("::caller") && r.to_id.includes("::utilityFunction")
      );
      expect(crossFileCall).toBeDefined();
      expect(crossFileCall?.kind).toBe("calls");
    });

    it("tracks mixed same-file and cross-file calls", () => {
      analyzer.addSourceFiles([
        "src/test-fixtures/cross-file-a.ts",
        "src/test-fixtures/cross-file-b.ts",
      ]);
      const result = analyzer.analyze("test-commit");

      // mixedCalls should call both localHelper and utilityFunction
      const localCall = result.relations.find(
        r => r.from_id.includes("::mixedCalls") && r.to_id.includes("::localHelper")
      );
      const crossCall = result.relations.find(
        r => r.from_id.includes("::mixedCalls") && r.to_id.includes("::utilityFunction")
      );

      expect(localCall).toBeDefined();
      expect(crossCall).toBeDefined();
    });
  });

  describe("module-level variables", () => {
    it("extracts let variables", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      const variable = result.entities.find(e => e.name === "mutableCounter");
      expect(variable).toBeDefined();
      expect(variable?.kind).toBe("variable");
    });

    it("extracts const variables", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      const variable = result.entities.find(e => e.name === "immutableConfig");
      expect(variable).toBeDefined();
      expect(variable?.kind).toBe("variable");
    });

    it("extracts var variables", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      const variable = result.entities.find(e => e.name === "legacyVar");
      expect(variable).toBeDefined();
      expect(variable?.kind).toBe("variable");
    });

    it("extracts destructured variables", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      const name = result.entities.find(e => e.name === "name");
      const age = result.entities.find(e => e.name === "age");
      const first = result.entities.find(e => e.name === "first");

      expect(name).toBeDefined();
      expect(age).toBeDefined();
      expect(first).toBeDefined();
    });

    it("does not extract function declarations as variables", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      // incrementCounter should be a function, not a variable
      const fn = result.entities.find(e => e.name === "incrementCounter");
      expect(fn?.kind).toBe("function");
    });
  });

  describe("side-effect tracking (reads/writes)", () => {
    it("tracks writes to module variables via assignment", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      // incrementCounter writes to mutableCounter
      const writeRelation = result.relations.find(
        r => r.from_id.includes("::incrementCounter") &&
             r.to_id.includes("::mutableCounter") &&
             r.kind === "writes"
      );
      expect(writeRelation).toBeDefined();
    });

    it("tracks reads from module variables", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      // readConfig reads immutableConfig
      const readRelation = result.relations.find(
        r => r.from_id.includes("::readConfig") &&
             r.to_id.includes("::immutableConfig") &&
             r.kind === "reads"
      );
      expect(readRelation).toBeDefined();
    });

    it("tracks writes via property mutation", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      // updateSharedState writes to sharedState
      const writeRelation = result.relations.find(
        r => r.from_id.includes("::updateSharedState") &&
             r.to_id.includes("::sharedState") &&
             r.kind === "writes"
      );
      expect(writeRelation).toBeDefined();
    });

    it("tracks writes via mutating methods (push, splice)", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      // addItem writes to items via push
      const pushWrite = result.relations.find(
        r => r.from_id.includes("::addItem") &&
             r.to_id.includes("::items") &&
             r.kind === "writes"
      );
      expect(pushWrite).toBeDefined();

      // clearItems writes to items via splice
      const spliceWrite = result.relations.find(
        r => r.from_id.includes("::clearItems") &&
             r.to_id.includes("::items") &&
             r.kind === "writes"
      );
      expect(spliceWrite).toBeDefined();
    });

    it("tracks multiple reads in a single function", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      // summarize reads name, age, and mutableCounter
      const reads = result.relations.filter(
        r => r.from_id.includes("::summarize") && r.kind === "reads"
      );
      expect(reads.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("closure variable detection", () => {
    it("extracts closure variables that are mutated by nested functions", () => {
      analyzer.addSourceFiles(["src/test-fixtures/closures.ts"]);
      const result = analyzer.analyze("test-commit");

      // The 'count' variable in createCounter should be tracked
      const closureVar = result.entities.find(
        e => e.name === "count" && e.id.includes("createCounter")
      );
      expect(closureVar).toBeDefined();
      expect(closureVar?.kind).toBe("variable");
    });

    it("does not extract closure variables that are only read", () => {
      analyzer.addSourceFiles(["src/test-fixtures/closures.ts"]);
      const result = analyzer.analyze("test-commit");

      // The 'config' variable in createReader should NOT be tracked
      // (it's only read, not mutated)
      const configVar = result.entities.find(
        e => e.name === "config" && e.id.includes("createReader")
      );
      expect(configVar).toBeUndefined();
    });

    it("tracks writes to closure variables from nested functions", () => {
      analyzer.addSourceFiles(["src/test-fixtures/closures.ts"]);
      const result = analyzer.analyze("test-commit");

      // increment() writes to count
      const writeRelation = result.relations.find(
        r => r.from_id.includes("::increment") &&
             r.to_id.includes("::count") &&
             r.kind === "writes"
      );
      expect(writeRelation).toBeDefined();
    });

    it("handles multiple levels of nesting", () => {
      analyzer.addSourceFiles(["src/test-fixtures/closures.ts"]);
      const result = analyzer.analyze("test-commit");

      // inner() should write to both outerVar and middleVar
      const outerWrite = result.relations.find(
        r => r.from_id.includes("::inner") &&
             r.to_id.includes("::outerVar") &&
             r.kind === "writes"
      );
      const middleWrite = result.relations.find(
        r => r.from_id.includes("::inner") &&
             r.to_id.includes("::middleVar") &&
             r.kind === "writes"
      );

      expect(outerWrite).toBeDefined();
      expect(middleWrite).toBeDefined();
    });

    it("tracks closure mutations via mutating methods", () => {
      analyzer.addSourceFiles(["src/test-fixtures/closures.ts"]);
      const result = analyzer.analyze("test-commit");

      // add() writes to items via push
      const pushWrite = result.relations.find(
        r => r.from_id.includes("createList") &&
             r.from_id.includes("::add") &&
             r.to_id.includes("::items") &&
             r.kind === "writes"
      );
      expect(pushWrite).toBeDefined();
    });
  });

  describe("hash computation", () => {
    it("computes consistent hash for same input", () => {
      const hash1 = computeHash("function foo() { return 1; }");
      const hash2 = computeHash("function foo() { return 1; }");
      expect(hash1).toBe(hash2);
    });

    it("computes different hash for different input", () => {
      const hash1 = computeHash("function foo() { return 1; }");
      const hash2 = computeHash("function foo() { return 2; }");
      expect(hash1).not.toBe(hash2);
    });

    it("normalizes whitespace in signature hash", () => {
      const hash1 = computeSignatureHash("(a: number, b: string) => void");
      const hash2 = computeSignatureHash("(a: number,   b: string)   =>   void");
      expect(hash1).toBe(hash2);
    });

    it("impl hash is sensitive to any change", () => {
      const hash1 = computeImplHash("{ return x + 1; }");
      const hash2 = computeImplHash("{ return x + 2; }");
      expect(hash1).not.toBe(hash2);
    });

    it("entities have signature_hash populated", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      const fn = result.entities.find(e => e.name === "namedFunction");
      expect(fn?.signature_hash).toBeDefined();
      expect(fn?.signature_hash).toHaveLength(16);
    });

    it("entities have impl_hash populated for functions with bodies", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      const fn = result.entities.find(e => e.name === "namedFunction");
      expect(fn?.impl_hash).toBeDefined();
      expect(fn?.impl_hash).toHaveLength(16);
    });

    it("variables have signature_hash but impl_hash may be null", () => {
      analyzer.addSourceFiles(["src/test-fixtures/variables.ts"]);
      const result = analyzer.analyze("test-commit");

      const variable = result.entities.find(e => e.name === "mutableCounter");
      expect(variable?.signature_hash).toBeDefined();
      // impl_hash is the initial value hash, which exists for initialized variables
      expect(variable?.impl_hash).toBeDefined();
    });
  });

  describe("entity metadata", () => {
    it("includes file path in entity", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      const fn = result.entities.find(e => e.name === "namedFunction");
      expect(fn?.file_path).toBe("src/test-fixtures/functions.ts");
    });

    it("includes line numbers in entity", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      const fn = result.entities.find(e => e.name === "namedFunction");
      expect(fn?.start_line).toBeGreaterThan(0);
      expect(fn?.end_line).toBeGreaterThanOrEqual(fn?.start_line ?? 0);
    });

    it("includes commit_sha in entity", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("my-commit-sha");

      const fn = result.entities.find(e => e.name === "namedFunction");
      expect(fn?.commit_sha).toBe("my-commit-sha");
    });

    it("includes signature in function entity", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      const fn = result.entities.find(e => e.name === "namedFunction");
      expect(fn?.signature).toContain("=>");
    });
  });

  describe("relation metadata", () => {
    it("includes commit_sha in relations", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("my-commit-sha");

      const callRelation = result.relations.find(r => r.kind === "calls");
      expect(callRelation?.commit_sha).toBe("my-commit-sha");
    });

    it("call relations have correct from_id and to_id", () => {
      analyzer.addSourceFiles(["src/test-fixtures/functions.ts"]);
      const result = analyzer.analyze("test-commit");

      // caller() calls namedFunction()
      const callRelation = result.relations.find(
        r => r.from_id.includes("::caller") && r.to_id.includes("::namedFunction")
      );
      expect(callRelation).toBeDefined();
      expect(callRelation?.from_id).toContain("functions.ts");
      expect(callRelation?.to_id).toContain("functions.ts");
    });
  });

  describe("class properties", () => {
    it("extracts class properties as entities", () => {
      analyzer.addSourceFiles(["src/test-fixtures/classes.ts"]);
      const result = analyzer.analyze("test-commit");

      const countProp = result.entities.find(e => e.name === "count" && e.kind === "property");
      expect(countProp).toBeDefined();
      expect(countProp?.id).toContain("Counter.count");
    });

    it("extracts readonly properties", () => {
      analyzer.addSourceFiles(["src/test-fixtures/classes.ts"]);
      const result = analyzer.analyze("test-commit");

      const maxCountProp = result.entities.find(e => e.name === "maxCount" && e.kind === "property");
      expect(maxCountProp).toBeDefined();
      expect(maxCountProp?.signature).toContain("readonly");
    });

    it("extracts array properties", () => {
      analyzer.addSourceFiles(["src/test-fixtures/classes.ts"]);
      const result = analyzer.analyze("test-commit");

      const itemsProp = result.entities.find(
        e => e.name === "items" && e.kind === "property" && e.id.includes("Counter")
      );
      expect(itemsProp).toBeDefined();
    });

    it("tracks writes to this.x via assignment", () => {
      analyzer.addSourceFiles(["src/test-fixtures/classes.ts"]);
      const result = analyzer.analyze("test-commit");

      // reset() writes to this.count
      const writeRelation = result.relations.find(
        r => r.from_id.includes("Counter.reset") &&
             r.to_id.includes("Counter.count") &&
             r.kind === "writes"
      );
      expect(writeRelation).toBeDefined();
    });

    it("tracks writes to this.x via increment/decrement", () => {
      analyzer.addSourceFiles(["src/test-fixtures/classes.ts"]);
      const result = analyzer.analyze("test-commit");

      // increment() writes to this.count via ++
      const writeRelation = result.relations.find(
        r => r.from_id.includes("Counter.increment") &&
             r.to_id.includes("Counter.count") &&
             r.kind === "writes"
      );
      expect(writeRelation).toBeDefined();
    });

    it("tracks reads from this.x", () => {
      analyzer.addSourceFiles(["src/test-fixtures/classes.ts"]);
      const result = analyzer.analyze("test-commit");

      // getCount() reads this.count
      const readRelation = result.relations.find(
        r => r.from_id.includes("Counter.getCount") &&
             r.to_id.includes("Counter.count") &&
             r.kind === "reads"
      );
      expect(readRelation).toBeDefined();
    });

    it("tracks writes to this.x via mutating methods", () => {
      analyzer.addSourceFiles(["src/test-fixtures/classes.ts"]);
      const result = analyzer.analyze("test-commit");

      // addItem() writes to this.items via push
      const writeRelation = result.relations.find(
        r => r.from_id.includes("Counter.addItem") &&
             r.to_id.includes("Counter.items") &&
             r.kind === "writes"
      );
      expect(writeRelation).toBeDefined();
    });

    it("tracks multiple property accesses in a single method", () => {
      analyzer.addSourceFiles(["src/test-fixtures/classes.ts"]);
      const result = analyzer.analyze("test-commit");

      // summary() reads this.count, this.maxCount, and this.items
      const summaryReads = result.relations.filter(
        r => r.from_id.includes("Counter.summary") && r.kind === "reads"
      );
      expect(summaryReads.length).toBeGreaterThanOrEqual(3);
    });

    it("extracts static properties", () => {
      analyzer.addSourceFiles(["src/test-fixtures/classes.ts"]);
      const result = analyzer.analyze("test-commit");

      const versionProp = result.entities.find(
        e => e.name === "version" && e.id.includes("Config")
      );
      expect(versionProp).toBeDefined();
    });
  });
});
