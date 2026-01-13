import {
  Project,
  SourceFile,
  FunctionDeclaration,
  ArrowFunction,
  FunctionExpression,
  VariableDeclaration,
  CallExpression,
  SyntaxKind,
  Node,
} from "ts-morph";
import { computeSignatureHash, computeImplHash } from "./hash.js";
import type { Entity, Relation } from "./db.js";
import { relative } from "path";

export interface AnalysisResult {
  entities: Omit<Entity, "created_at">[];
  relations: Omit<Relation, "id">[];
}

interface FunctionInfo {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  body: string | null;
  node: Node;
}

export class TypeScriptAnalyzer {
  private project: Project;
  private rootDir: string;

  constructor(tsConfigPath?: string) {
    if (tsConfigPath) {
      this.project = new Project({ tsConfigFilePath: tsConfigPath });
      this.rootDir = this.project.getDirectory("")?.getPath() ?? process.cwd();
    } else {
      this.project = new Project({
        compilerOptions: {
          allowJs: true,
          checkJs: false,
        },
      });
      this.rootDir = process.cwd();
    }
  }

  /**
   * Adds source files to the ts-morph Project using glob patterns. Called before analyze() to define the analysis scope.
   */
  addSourceFiles(patterns: string[]): void {
    this.project.addSourceFilesAtPaths(patterns);
  }

  /**
   * Main analysis entry point. Performs two passes: first extracts all functions, then builds the call graph by resolving call expressions to known functions.
   */
  analyze(commitSha: string): AnalysisResult {
    const entities: Omit<Entity, "created_at">[] = [];
    const relations: Omit<Relation, "id">[] = [];
    const functionMap = new Map<string, FunctionInfo>();

    // First pass: collect all functions
    for (const sourceFile of this.project.getSourceFiles()) {
      if (sourceFile.isFromExternalLibrary()) continue;

      const filePath = this.getRelativePath(sourceFile.getFilePath());
      const functions = this.extractFunctions(sourceFile, filePath);

      for (const fn of functions) {
        functionMap.set(fn.id, fn);

        entities.push({
          id: fn.id,
          kind: "function",
          name: fn.name,
          file_path: filePath,
          start_line: fn.startLine,
          end_line: fn.endLine,
          signature: fn.signature,
          signature_hash: computeSignatureHash(fn.signature),
          impl_hash: fn.body ? computeImplHash(fn.body) : null,
          commit_sha: commitSha,
        });
      }
    }

    // Second pass: build call graph
    for (const [callerId, caller] of functionMap) {
      const calls = this.extractCalls(caller.node, functionMap);

      for (const calleeId of calls) {
        relations.push({
          from_id: callerId,
          to_id: calleeId,
          kind: "calls",
          commit_sha: commitSha,
          metadata: null,
        });
      }
    }

    return { entities, relations };
  }

  /**
   * Converts absolute file paths to paths relative to the project root. Ensures consistent entity IDs across different machines.
   */
  private getRelativePath(absolutePath: string): string {
    return relative(this.rootDir, absolutePath);
  }

  /**
   * Extracts all function-like entities from a source file: named functions, exported arrow functions, class methods, and nested functions. Returns FunctionInfo for each.
   */
  private extractFunctions(sourceFile: SourceFile, filePath: string): FunctionInfo[] {
    const functions: FunctionInfo[] = [];

    // Named function declarations
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;

      const info = this.createFunctionInfo(fn, name, filePath);
      functions.push(info);
      // Extract nested functions
      functions.push(...this.extractNestedFunctions(fn, name, filePath));
    }

    // Exported arrow functions and function expressions
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const initializer = varDecl.getInitializer();
      if (!initializer) continue;

      if (
        Node.isArrowFunction(initializer) ||
        Node.isFunctionExpression(initializer)
      ) {
        const name = varDecl.getName();
        const info = this.createFunctionInfoFromVar(varDecl, initializer, name, filePath);
        functions.push(info);
        // Extract nested functions
        functions.push(...this.extractNestedFunctions(initializer, name, filePath));
      }
    }

    // Class methods
    for (const classDecl of sourceFile.getClasses()) {
      const className = classDecl.getName() ?? "AnonymousClass";

      for (const method of classDecl.getMethods()) {
        const methodName = method.getName();
        const fullName = `${className}.${methodName}`;
        const info = this.createFunctionInfo(method, fullName, filePath);
        functions.push(info);
        // Extract nested functions
        functions.push(...this.extractNestedFunctions(method, fullName, filePath));
      }
    }

    return functions;
  }

  /**
   * Recursively extracts nested functions from within a function body. Uses :: separator for nested IDs (e.g., file.ts::outer::inner).
   */
  private extractNestedFunctions(parentNode: Node, parentName: string, filePath: string): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    const body = Node.isFunctionDeclaration(parentNode) || Node.isMethodDeclaration(parentNode) || Node.isArrowFunction(parentNode) || Node.isFunctionExpression(parentNode)
      ? (parentNode as any).getBody?.()
      : null;

    if (!body) return functions;

    // Find nested named function declarations
    const nestedFunctions = body.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
    for (const fn of nestedFunctions) {
      const name = fn.getName();
      if (!name) continue;
      // Skip if this function is nested inside another nested function (will be handled recursively)
      if (this.hasIntermediateFunction(body, fn)) continue;

      const fullName = `${parentName}::${name}`;
      const info = this.createFunctionInfo(fn, fullName, filePath);
      functions.push(info);
      // Recurse into this nested function
      functions.push(...this.extractNestedFunctions(fn, fullName, filePath));
    }

    // Find nested arrow functions and function expressions assigned to variables
    const varStatements = body.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
    for (const varDecl of varStatements) {
      const initializer = varDecl.getInitializer();
      if (!initializer) continue;
      // Skip if this var is nested inside another nested function (will be handled recursively)
      if (this.hasIntermediateFunction(body, varDecl)) continue;

      if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
        const name = varDecl.getName();
        const fullName = `${parentName}::${name}`;
        const info = this.createFunctionInfoFromVar(varDecl, initializer, fullName, filePath);
        functions.push(info);
        // Recurse into this nested function
        functions.push(...this.extractNestedFunctions(initializer, fullName, filePath));
      }
    }

    return functions;
  }

  /**
   * Checks if there's an intermediate function between the body and the target node.
   * Used to avoid double-processing deeply nested functions.
   */
  private hasIntermediateFunction(body: Node, target: Node): boolean {
    let current = target.getParent();
    while (current && current !== body) {
      if (
        Node.isFunctionDeclaration(current) ||
        Node.isFunctionExpression(current) ||
        Node.isArrowFunction(current) ||
        Node.isMethodDeclaration(current)
      ) {
        return true;
      }
      current = current.getParent();
    }
    return false;
  }

  /**
   * Creates a FunctionInfo record from a function declaration or method. Extracts signature, body, and location for storage.
   */
  private createFunctionInfo(
    fn: FunctionDeclaration | FunctionExpression | Node,
    name: string,
    filePath: string
  ): FunctionInfo {
    const startLine = fn.getStartLineNumber();
    const endLine = fn.getEndLineNumber();
    const id = `${filePath}::${name}`;

    let signature: string;
    let body: string | null = null;

    if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
      const params = fn.getParameters().map((p) => p.getText()).join(", ");
      const returnType = fn.getReturnType().getText();
      signature = `(${params}) => ${returnType}`;
      body = fn.getBody()?.getText() ?? null;
    } else {
      signature = fn.getText().split("{")[0]?.trim() ?? fn.getText();
      body = fn.getText();
    }

    return { id, name, filePath, startLine, endLine, signature, body, node: fn };
  }

  /**
   * Creates FunctionInfo for arrow functions and function expressions assigned to variables. Handles the different AST structure compared to declarations.
   */
  private createFunctionInfoFromVar(
    varDecl: VariableDeclaration,
    fn: ArrowFunction | FunctionExpression,
    name: string,
    filePath: string
  ): FunctionInfo {
    const startLine = varDecl.getStartLineNumber();
    const endLine = varDecl.getEndLineNumber();
    const id = `${filePath}::${name}`;

    const params = fn.getParameters().map((p) => p.getText()).join(", ");
    const returnType = fn.getReturnType().getText();
    const signature = `(${params}) => ${returnType}`;
    const body = fn.getBody()?.getText() ?? null;

    return { id, name, filePath, startLine, endLine, signature, body, node: fn };
  }

  /**
   * Finds all call expressions within a function and resolves them to known function IDs. Returns deduplicated list of callee IDs for building the call graph.
   */
  private extractCalls(node: Node, functionMap: Map<string, FunctionInfo>): string[] {
    const calls: string[] = [];
    const callExpressions = node.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExpressions) {
      const calleeName = this.getCalleeName(call);
      if (!calleeName) continue;

      // Try to resolve the callee to a known function
      for (const [id, fn] of functionMap) {
        // Match: exact name, id ending with ::name, or method name (ClassName.methodName ending with .calleeName)
        if (
          fn.name === calleeName ||
          id.endsWith(`::${calleeName}`) ||
          fn.name.endsWith(`.${calleeName}`)
        ) {
          calls.push(id);
          break;
        }
      }
    }

    return [...new Set(calls)]; // deduplicate
  }

  /**
   * Extracts the function name from a CallExpression AST node. Handles both simple identifiers and property access (obj.method).
   */
  private getCalleeName(call: CallExpression): string | null {
    const expression = call.getExpression();

    if (Node.isIdentifier(expression)) {
      return expression.getText();
    }

    if (Node.isPropertyAccessExpression(expression)) {
      // e.g., obj.method() - return "method" or "obj.method"
      return expression.getName();
    }

    return null;
  }
}
