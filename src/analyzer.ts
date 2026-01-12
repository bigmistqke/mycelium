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

  addSourceFiles(patterns: string[]): void {
    this.project.addSourceFilesAtPaths(patterns);
  }

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

  private getRelativePath(absolutePath: string): string {
    return relative(this.rootDir, absolutePath);
  }

  private extractFunctions(sourceFile: SourceFile, filePath: string): FunctionInfo[] {
    const functions: FunctionInfo[] = [];

    // Named function declarations
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;

      functions.push(this.createFunctionInfo(fn, name, filePath));
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
        functions.push(
          this.createFunctionInfoFromVar(varDecl, initializer, name, filePath)
        );
      }
    }

    // Class methods
    for (const classDecl of sourceFile.getClasses()) {
      const className = classDecl.getName() ?? "AnonymousClass";

      for (const method of classDecl.getMethods()) {
        const methodName = method.getName();
        const fullName = `${className}.${methodName}`;
        functions.push(this.createFunctionInfo(method, fullName, filePath));
      }
    }

    return functions;
  }

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

  private extractCalls(node: Node, functionMap: Map<string, FunctionInfo>): string[] {
    const calls: string[] = [];
    const callExpressions = node.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExpressions) {
      const calleeName = this.getCalleeName(call);
      if (!calleeName) continue;

      // Try to resolve the callee to a known function
      for (const [id, fn] of functionMap) {
        if (fn.name === calleeName || id.endsWith(`::${calleeName}`)) {
          calls.push(id);
          break;
        }
      }
    }

    return [...new Set(calls)]; // deduplicate
  }

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
