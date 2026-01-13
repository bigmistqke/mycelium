import { describe, it, expect, beforeEach } from "vitest";
import { TypeScriptAnalyzer } from "./analyzer.js";

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
  });
});
