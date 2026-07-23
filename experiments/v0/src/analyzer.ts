import { relative } from "path";
import {
  ArrowFunction,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  ObjectLiteralExpression,
  Project,
  PropertyAssignment,
  SourceFile,
  SyntaxKind,
  VariableDeclaration,
  VariableDeclarationKind,
} from "ts-morph";
import type { CallArgument, Entity, Relation } from "./db.ts";
import { computeImplHash, computeSignatureHash } from "./hash.ts";

export interface AnalysisResult {
  entities: Omit<Entity, "created_at">[];
  relations: Omit<Relation, "id">[];
  callArguments: CallArgument[];
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

interface VariableInfo {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isConst: boolean;
  initialValue: string | null;
  node: Node;
  /** For closure variables, the function ID that owns this variable */
  ownerFunctionId?: string;
}

interface ClassPropertyInfo {
  id: string;
  name: string;
  className: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isReadonly: boolean;
  initialValue: string | null;
  node: Node;
}

interface ScopeContext {
  localVariables: Set<string>;
  parameters: Set<string>;
  parentScopes: ScopeContext[];
}

interface VariableAccess {
  variableName: string;
  variableId: string;
  kind: "reads" | "writes";
}

interface Dependency {
  fromId: string;
  toId: string;
}

interface ParameterInfo {
  id: string; // e.g., "file.ts::foo(0)"
  name: string; // e.g., "x"
  index: number; // 0-based parameter index
  functionId: string; // e.g., "file.ts::foo"
  filePath: string;
  startLine: number;
  endLine: number;
}

export class TypeScriptAnalyzer {
  private project: Project;
  private rootDir: string;

  constructor(tsConfigPath?: string, rootDir?: string) {
    if (tsConfigPath) {
      this.project = new Project({ tsConfigFilePath: tsConfigPath });
    } else {
      this.project = new Project({
        compilerOptions: {
          allowJs: true,
          checkJs: false,
        },
      });
    }
    this.rootDir = rootDir ?? process.cwd();
  }

  /**
   * Adds source files to the ts-morph Project using glob patterns. Called before analyze() to define the analysis scope.
   */
  addSourceFiles(patterns: string[]): void {
    this.project.addSourceFilesAtPaths(patterns);
  }

  /**
   * Main analysis entry point. Performs two passes: first extracts all functions and variables, then builds the call graph and tracks variable accesses.
   */
  analyze(commitSha: string): AnalysisResult {
    const entities: Omit<Entity, "created_at">[] = [];
    const relations: Omit<Relation, "id">[] = [];
    const functionMap = new Map<string, FunctionInfo>();
    // variableMap: keyed by simple name for module-level, by full ID for closure vars
    const variableMap = new Map<string, VariableInfo>();
    // closureVariablesByOwner: maps owner function ID -> Map<varName, VariableInfo>
    const closureVariablesByOwner = new Map<
      string,
      Map<string, VariableInfo>
    >();
    // classPropertiesMap: maps className -> Map<propertyName, ClassPropertyInfo>
    const classPropertiesMap = new Map<
      string,
      Map<string, ClassPropertyInfo>
    >();
    // parametersByFunction: maps function ID -> Map<paramName, ParameterInfo>
    const parametersByFunction = new Map<string, Map<string, ParameterInfo>>();
    // localVariablesByFunction: maps function ID -> Map<varName, VariableInfo>
    const localVariablesByFunction = new Map<
      string,
      Map<string, VariableInfo>
    >();

    // First pass: collect all functions and module-level variables
    for (const sourceFile of this.project.getSourceFiles()) {
      if (sourceFile.isFromExternalLibrary()) continue;

      const filePath = this.getRelativePath(sourceFile.getFilePath());

      // Create <namespace> entity for this module (used by namespace imports)
      entities.push({
        id: `${filePath}::<namespace>`,
        kind: "module",
        name: "<namespace>",
        file_path: filePath,
        start_line: 1,
        end_line: sourceFile.getEndLineNumber(),
        signature: `module ${filePath}`,
        signature_hash: computeSignatureHash("module namespace"),
        impl_hash: null,
        commit_sha: commitSha,
      });

      // Extract module-level variables
      const variables = this.extractModuleVariables(sourceFile, filePath);
      for (const v of variables) {
        variableMap.set(v.name, v);

        entities.push({
          id: v.id,
          kind: "variable",
          name: v.name,
          file_path: filePath,
          start_line: v.startLine,
          end_line: v.endLine,
          signature: v.isConst ? `const ${v.name}` : `let ${v.name}`,
          signature_hash: computeSignatureHash(v.isConst ? "const" : "let"),
          impl_hash: v.initialValue ? computeImplHash(v.initialValue) : null,
          commit_sha: commitSha,
        });
      }

      // Extract functions
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

        // Extract parameters for this function
        const params = this.extractParameters(fn, filePath);
        if (params.length > 0) {
          parametersByFunction.set(fn.id, new Map());
          for (const param of params) {
            parametersByFunction.get(fn.id)!.set(param.name, param);

            entities.push({
              id: param.id,
              kind: "parameter",
              name: param.name,
              file_path: filePath,
              start_line: param.startLine,
              end_line: param.endLine,
              signature: `(${param.index})`,
              signature_hash: computeSignatureHash(`param ${param.index}`),
              impl_hash: null,
              commit_sha: commitSha,
            });
          }
        }

        // Extract local variables for this function
        const localVars = this.extractLocalVariables(fn, filePath);
        if (localVars.length > 0) {
          localVariablesByFunction.set(fn.id, new Map());
          for (const v of localVars) {
            localVariablesByFunction.get(fn.id)!.set(v.name, v);

            entities.push({
              id: v.id,
              kind: "variable",
              name: v.name,
              file_path: filePath,
              start_line: v.startLine,
              end_line: v.endLine,
              signature: v.isConst ? `const ${v.name}` : `let ${v.name}`,
              signature_hash: computeSignatureHash(v.isConst ? "const" : "let"),
              impl_hash: v.initialValue ? computeImplHash(v.initialValue) : null,
              commit_sha: commitSha,
            });
          }
        }
      }

      // Extract closure variables that are mutated by nested functions
      const closureVars = this.findMutatedClosureVariables(
        functionMap,
        filePath,
      );
      for (const v of closureVars) {
        // Add to closure variable lookup by owner
        if (!closureVariablesByOwner.has(v.ownerFunctionId!)) {
          closureVariablesByOwner.set(v.ownerFunctionId!, new Map());
        }
        closureVariablesByOwner.get(v.ownerFunctionId!)!.set(v.name, v);

        entities.push({
          id: v.id,
          kind: "variable",
          name: v.name,
          file_path: filePath,
          start_line: v.startLine,
          end_line: v.endLine,
          signature: v.isConst ? `const ${v.name}` : `let ${v.name}`,
          signature_hash: computeSignatureHash(v.isConst ? "const" : "let"),
          impl_hash: v.initialValue ? computeImplHash(v.initialValue) : null,
          commit_sha: commitSha,
        });
      }

      // Extract class properties
      const classProperties = this.extractClassProperties(sourceFile, filePath);
      for (const prop of classProperties) {
        // Add to class properties lookup
        if (!classPropertiesMap.has(prop.className)) {
          classPropertiesMap.set(prop.className, new Map());
        }
        classPropertiesMap.get(prop.className)!.set(prop.name, prop);

        entities.push({
          id: prop.id,
          kind: "property",
          name: prop.name,
          file_path: filePath,
          start_line: prop.startLine,
          end_line: prop.endLine,
          signature: prop.isReadonly ? `readonly ${prop.name}` : prop.name,
          signature_hash: computeSignatureHash(
            prop.isReadonly ? "readonly" : "property",
          ),
          impl_hash: prop.initialValue
            ? computeImplHash(prop.initialValue)
            : null,
          commit_sha: commitSha,
        });
      }
    }

    // Second pass: build call graph and track variable accesses
    for (const [callerId, caller] of functionMap) {
      // Extract function calls
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

      // Build combined variable map for this function (module-level + accessible closure vars)
      const accessibleVars = new Map(variableMap);

      // Add closure variables from ancestor functions
      const parts = callerId.split("::");
      for (let i = 2; i < parts.length; i++) {
        const ancestorId = parts.slice(0, i).join("::");
        const ancestorClosureVars = closureVariablesByOwner.get(ancestorId);
        if (ancestorClosureVars) {
          for (const [name, v] of ancestorClosureVars) {
            accessibleVars.set(name, v);
          }
        }
      }

      // Extract variable accesses (reads/writes)
      const scope = this.buildScopeContext(caller.node);
      const accesses = this.extractVariableAccesses(
        caller.node,
        scope,
        accessibleVars,
        caller.filePath,
      );
      for (const access of accesses) {
        relations.push({
          from_id: callerId,
          to_id: access.variableId,
          kind: access.kind,
          commit_sha: commitSha,
          metadata: null,
        });
      }

      // Extract dataflow through opaque HOFs (map/filter/etc)
      const callerSourceFile = caller.node.getSourceFile();
      const hofDataflow = this.extractOpaqueHofDataflow(
        caller,
        functionMap,
        accessibleVars,
        parametersByFunction,
        localVariablesByFunction,
        callerSourceFile,
        caller.filePath,
        commitSha,
      );
      relations.push(...hofDataflow);

      // Extract local variable dependencies (what each local var is initialized from)
      const localVarDeps = this.extractLocalVariableDependencies(
        caller,
        accessibleVars,
        parametersByFunction,
        localVariablesByFunction,
        functionMap,
        commitSha,
      );
      relations.push(...localVarDeps);

      // Extract this.x accesses for class methods
      const className = this.getOwningClassName(caller.node);
      if (className) {
        const classProps = classPropertiesMap.get(className);
        if (classProps) {
          const propAccesses = this.extractThisPropertyAccesses(
            caller.node,
            classProps,
            caller.filePath,
          );
          for (const access of propAccesses) {
            relations.push({
              from_id: callerId,
              to_id: access.variableId,
              kind: access.kind,
              commit_sha: commitSha,
              metadata: null,
            });
          }
        }
      }
    }

    // Third pass: extract alias relations for variables
    const allEntityIds = new Set([
      ...Array.from(functionMap.keys()),
      ...Array.from(variableMap.values()).map((v) => v.id),
    ]);

    for (const v of variableMap.values()) {
      const aliasTarget = this.resolveAliasTarget(
        v.node,
        v.filePath,
        allEntityIds,
        variableMap,
        functionMap,
      );
      if (aliasTarget) {
        relations.push({
          from_id: v.id,
          to_id: aliasTarget,
          kind: "aliases",
          commit_sha: commitSha,
          metadata: null,
        });
      }
    }

    // Fourth pass: extract import/export aliases
    for (const sourceFile of this.project.getSourceFiles()) {
      if (sourceFile.isFromExternalLibrary()) continue;

      const filePath = this.getRelativePath(sourceFile.getFilePath());

      // Handle default exports: create <default> entity/alias
      const defaultExport = this.extractDefaultExport(
        sourceFile,
        filePath,
        allEntityIds,
        commitSha,
      );
      if (defaultExport) {
        if (defaultExport.entity) {
          entities.push(defaultExport.entity);
          allEntityIds.add(defaultExport.entity.id);
        }
        if (defaultExport.alias) {
          relations.push(defaultExport.alias);
        }
      }

      // Handle imports: create entities and alias relations
      const imports = this.extractImports(sourceFile, filePath, commitSha);
      entities.push(...imports.entities);
      relations.push(...imports.aliases);

      // Handle re-exports: export { foo } from './mod', export * from './mod'
      const reExports = this.extractReExports(sourceFile, filePath, commitSha);
      entities.push(...reExports.entities);
      relations.push(...reExports.aliases);
    }

    // Fifth pass: extract dependencies (data-flow)
    // Build a complete ID set including newly added entities
    const allEntityIdsWithImports = new Set([
      ...allEntityIds,
      ...entities.map((e) => e.id),
    ]);

    // Create <return> entities and track return statement dependencies
    for (const [fnId, fn] of functionMap) {
      const returnEntity = this.createReturnEntity(fn, fnId, commitSha);
      entities.push(returnEntity);
      allEntityIdsWithImports.add(returnEntity.id);

      // Track what the return depends on
      const returnDeps = this.extractReturnDependencies(
        fn.node,
        fnId,
        allEntityIdsWithImports,
        variableMap,
        functionMap,
        parametersByFunction.get(fnId),
      );
      for (const dep of returnDeps) {
        relations.push({
          from_id: dep.fromId,
          to_id: dep.toId,
          kind: "depends_on",
          commit_sha: commitSha,
          metadata: null,
        });
      }
    }

    // Track variable initialization dependencies
    for (const v of variableMap.values()) {
      const deps = this.extractInitializerDependencies(
        v.node,
        v.id,
        v.filePath,
        allEntityIdsWithImports,
        variableMap,
        functionMap,
      );
      for (const dep of deps) {
        relations.push({
          from_id: dep.fromId,
          to_id: dep.toId,
          kind: "depends_on",
          commit_sha: commitSha,
          metadata: null,
        });
      }
    }

    // Sixth pass: extract call arguments for transitive dependency resolution
    const callArguments: CallArgument[] = [];

    // Extract call arguments from variable initializers: const x = foo(a, b)
    for (const v of variableMap.values()) {
      if (!Node.isVariableDeclaration(v.node)) continue;
      const initializer = v.node.getInitializer();
      if (!initializer) continue;

      const args = this.extractCallArguments(
        initializer,
        v.id,
        v.filePath,
        allEntityIdsWithImports,
        variableMap,
        functionMap,
        commitSha,
      );
      callArguments.push(...args);
    }

    // Extract call arguments from function bodies
    for (const [fnId, fn] of functionMap) {
      const body = this.getFunctionBody(fn.node);
      if (!body) continue;

      // Find all call expressions in the function body (excluding nested functions)
      const callExprs = body.getDescendantsOfKind(SyntaxKind.CallExpression);
      for (const callExpr of callExprs) {
        if (this.hasIntermediateFunction(body, callExpr)) continue;

        const args = this.extractCallArgumentsFromCall(
          callExpr,
          fnId,
          fn.filePath,
          allEntityIdsWithImports,
          variableMap,
          functionMap,
          parametersByFunction.get(fnId),
          commitSha,
        );
        callArguments.push(...args);
      }
    }

    return { entities, relations, callArguments };
  }

  /**
   * Resolves what a variable aliases (single hop).
   * Returns the entity ID if the initializer points to a known entity, null otherwise.
   */
  private resolveAliasTarget(
    varDecl: Node,
    filePath: string,
    allEntityIds: Set<string>,
    variableMap: Map<string, VariableInfo>,
    functionMap: Map<string, FunctionInfo>,
  ): string | null {
    if (!Node.isVariableDeclaration(varDecl)) return null;

    const initializer = varDecl.getInitializer();
    if (!initializer) return null;

    // Skip function expressions - they're tracked as functions, not aliases
    if (
      Node.isArrowFunction(initializer) ||
      Node.isFunctionExpression(initializer)
    ) {
      return null;
    }

    // Case 1: Direct identifier reference (const b = a)
    if (Node.isIdentifier(initializer)) {
      const name = initializer.getText();
      // Check if it's a known variable
      const varInfo = variableMap.get(name);
      if (varInfo && allEntityIds.has(varInfo.id)) {
        return varInfo.id;
      }
      // Check if it's a known function
      for (const [id, fn] of functionMap) {
        if (fn.name === name || id.endsWith(`::${name}`)) {
          return id;
        }
      }
    }

    // Case 2: Property access (const action = utils.helper)
    if (Node.isPropertyAccessExpression(initializer)) {
      // Build the full property path (e.g., "utils.helper")
      const propertyPath = this.getPropertyAccessPath(initializer);
      if (propertyPath) {
        // Entity IDs use :: for scope, . for member access
        // So utils.helper becomes file::utils.helper
        const potentialId = `${filePath}::${propertyPath}`;
        if (allEntityIds.has(potentialId)) {
          return potentialId;
        }
        // Check for method references in other scopes
        for (const [id] of functionMap) {
          if (id.endsWith(`::${propertyPath}`)) {
            return id;
          }
        }
      }
    }

    return null;
  }

  /**
   * Gets the full path of a property access expression (e.g., "program.command.action").
   */
  private getPropertyAccessPath(expr: Node): string | null {
    if (Node.isIdentifier(expr)) {
      return expr.getText();
    }
    if (Node.isPropertyAccessExpression(expr)) {
      const base = this.getPropertyAccessPath(expr.getExpression());
      if (base) {
        return `${base}.${expr.getName()}`;
      }
    }
    return null;
  }

  /**
   * Converts absolute file paths to paths relative to the project root. Ensures consistent entity IDs across different machines.
   */
  private getRelativePath(absolutePath: string): string {
    return relative(this.rootDir, absolutePath);
  }

  /**
   * Extracts parameters from a function as entities.
   * Creates parameter entities like foo(0), foo(1), etc.
   */
  private extractParameters(
    fn: FunctionInfo,
    filePath: string,
  ): ParameterInfo[] {
    const params: ParameterInfo[] = [];
    const node = fn.node;

    // Get parameters from the function node
    let parameterNodes: Node[] = [];
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isConstructorDeclaration(node)
    ) {
      parameterNodes = node.getParameters();
    }

    for (let i = 0; i < parameterNodes.length; i++) {
      const param = parameterNodes[i];
      if (!Node.isParameterDeclaration(param)) continue;

      const paramName = param.getName();
      // Skip destructured parameters for now (they have complex names)
      if (paramName.startsWith("{") || paramName.startsWith("[")) continue;

      params.push({
        id: `${fn.id}<param:${i}>`,
        name: paramName,
        index: i,
        functionId: fn.id,
        filePath: filePath,
        startLine: param.getStartLineNumber(),
        endLine: param.getEndLineNumber(),
      });
    }

    return params;
  }

  /**
   * Extracts local variables declared within a function body.
   */
  private extractLocalVariables(
    fn: FunctionInfo,
    filePath: string,
  ): VariableInfo[] {
    const variables: VariableInfo[] = [];
    const node = fn.node;

    // Get the function body
    let body: Node | undefined;
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isConstructorDeclaration(node)
    ) {
      body = node.getBody();
    } else if (Node.isArrowFunction(node)) {
      body = node.getBody();
    }

    if (!body) return variables;

    // Find all variable statements in the body (direct children only, not nested functions)
    const varStatements = body.getDescendantsOfKind(
      SyntaxKind.VariableStatement,
    );

    for (const varStmt of varStatements) {
      // Skip variables inside nested functions
      const parentFn = this.getContainingFunction(varStmt);
      if (parentFn !== node) continue;

      const isConst =
        varStmt.getDeclarationKind() === VariableDeclarationKind.Const;

      for (const decl of varStmt.getDeclarations()) {
        const initializer = decl.getInitializer();
        // Skip function declarations (they're tracked as functions)
        if (
          initializer &&
          (Node.isArrowFunction(initializer) ||
            Node.isFunctionExpression(initializer))
        ) {
          continue;
        }

        const nameNode = decl.getNameNode();
        // Handle simple identifiers
        if (Node.isIdentifier(nameNode)) {
          const name = decl.getName();
          variables.push({
            id: `${fn.id}::${name}`,
            name,
            filePath,
            startLine: decl.getStartLineNumber(),
            endLine: decl.getEndLineNumber(),
            isConst,
            initialValue: initializer?.getText() ?? null,
            node: decl,
            ownerFunctionId: fn.id,
          });
        }
        // Handle destructuring - extract individual names
        else if (Node.isObjectBindingPattern(nameNode)) {
          for (const element of nameNode.getElements()) {
            const bindingName = element.getNameNode();
            if (Node.isIdentifier(bindingName)) {
              const name = bindingName.getText();
              variables.push({
                id: `${fn.id}::${name}`,
                name,
                filePath,
                startLine: element.getStartLineNumber(),
                endLine: element.getEndLineNumber(),
                isConst,
                initialValue: null,
                node: element,
                ownerFunctionId: fn.id,
              });
            }
          }
        } else if (Node.isArrayBindingPattern(nameNode)) {
          for (const element of nameNode.getElements()) {
            if (Node.isBindingElement(element)) {
              const bindingName = element.getNameNode();
              if (Node.isIdentifier(bindingName)) {
                const name = bindingName.getText();
                variables.push({
                  id: `${fn.id}::${name}`,
                  name,
                  filePath,
                  startLine: element.getStartLineNumber(),
                  endLine: element.getEndLineNumber(),
                  isConst,
                  initialValue: null,
                  node: element,
                  ownerFunctionId: fn.id,
                });
              }
            }
          }
        }
      }
    }

    return variables;
  }

  /**
   * Gets the containing function for a node (direct parent function, not ancestors).
   */
  private getContainingFunction(node: Node): Node | null {
    let current = node.getParent();
    while (current) {
      if (
        Node.isFunctionDeclaration(current) ||
        Node.isFunctionExpression(current) ||
        Node.isArrowFunction(current) ||
        Node.isMethodDeclaration(current) ||
        Node.isConstructorDeclaration(current)
      ) {
        return current;
      }
      current = current.getParent();
    }
    return null;
  }

  /**
   * Extracts all function-like entities from a source file: named functions, exported arrow functions, class methods, and nested functions. Returns FunctionInfo for each.
   */
  private extractFunctions(
    sourceFile: SourceFile,
    filePath: string,
  ): FunctionInfo[] {
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
        const info = this.createFunctionInfoFromVar(
          varDecl,
          initializer,
          name,
          filePath,
        );
        functions.push(info);
        // Extract nested functions
        functions.push(
          ...this.extractNestedFunctions(initializer, name, filePath),
        );
      }
      // Object literals with methods: const api = { method() {}, handler: () => {} }
      else if (Node.isObjectLiteralExpression(initializer)) {
        const objName = varDecl.getName();
        functions.push(
          ...this.extractObjectLiteralMethods(
            initializer,
            objName,
            filePath,
            sourceFile,
          ),
        );
      }
    }

    // Class methods and constructors
    for (const classDecl of sourceFile.getClasses()) {
      const className = classDecl.getName() ?? "AnonymousClass";

      // Extract constructors
      for (const ctor of classDecl.getConstructors()) {
        const fullName = `${className}.<constructor>`;
        const info = this.createFunctionInfo(ctor, fullName, filePath);
        functions.push(info);
        // Extract nested functions
        functions.push(
          ...this.extractNestedFunctions(ctor, fullName, filePath),
        );
      }

      for (const method of classDecl.getMethods()) {
        const methodName = method.getName();
        const fullName = `${className}.${methodName}`;
        const info = this.createFunctionInfo(method, fullName, filePath);
        functions.push(info);
        // Extract nested functions
        functions.push(
          ...this.extractNestedFunctions(method, fullName, filePath),
        );
      }
    }

    // Object literals passed as call arguments: expose({ start() {} })
    functions.push(...this.extractCallArgumentMethods(sourceFile, filePath));

    return functions;
  }

  /**
   * Recursively extracts nested functions from within a function body. Uses :: separator for nested IDs (e.g., file.ts::outer::inner).
   */
  private extractNestedFunctions(
    parentNode: Node,
    parentName: string,
    filePath: string,
  ): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    const body =
      Node.isFunctionDeclaration(parentNode) ||
      Node.isMethodDeclaration(parentNode) ||
      Node.isArrowFunction(parentNode) ||
      Node.isFunctionExpression(parentNode)
        ? (parentNode as any).getBody?.()
        : null;

    if (!body) return functions;

    // Find nested named function declarations
    const nestedFunctions = body.getDescendantsOfKind(
      SyntaxKind.FunctionDeclaration,
    );
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
    const varStatements = body.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    );
    for (const varDecl of varStatements) {
      const initializer = varDecl.getInitializer();
      if (!initializer) continue;
      // Skip if this var is nested inside another nested function (will be handled recursively)
      if (this.hasIntermediateFunction(body, varDecl)) continue;

      if (
        Node.isArrowFunction(initializer) ||
        Node.isFunctionExpression(initializer)
      ) {
        const name = varDecl.getName();
        const fullName = `${parentName}::${name}`;
        const info = this.createFunctionInfoFromVar(
          varDecl,
          initializer,
          fullName,
          filePath,
        );
        functions.push(info);
        // Recurse into this nested function
        functions.push(
          ...this.extractNestedFunctions(initializer, fullName, filePath),
        );
      }
    }

    return functions;
  }

  /**
   * Extracts methods from an object literal assigned to a variable.
   * Handles both shorthand methods: { method() {} } and property assignments: { method: () => {} }
   */
  private extractObjectLiteralMethods(
    objLiteral: ObjectLiteralExpression,
    objName: string,
    filePath: string,
    sourceFile: SourceFile,
  ): FunctionInfo[] {
    const functions: FunctionInfo[] = [];

    for (const prop of objLiteral.getProperties()) {
      // Shorthand methods: { method() {} }
      if (Node.isMethodDeclaration(prop)) {
        const methodName = prop.getName();
        const fullName = `${objName}.${methodName}`;
        const info = this.createFunctionInfo(prop, fullName, filePath);
        functions.push(info);
        // Extract nested functions within the method
        functions.push(
          ...this.extractNestedFunctions(prop, fullName, filePath),
        );
      }
      // Property assignments with function values: { method: () => {} } or { method: function() {} }
      else if (Node.isPropertyAssignment(prop)) {
        const init = prop.getInitializer();
        if (
          init &&
          (Node.isArrowFunction(init) || Node.isFunctionExpression(init))
        ) {
          const methodName = prop.getName();
          const fullName = `${objName}.${methodName}`;
          const info = this.createFunctionInfoFromMethod(
            prop,
            init,
            fullName,
            filePath,
          );
          functions.push(info);
          // Extract nested functions within the method
          functions.push(
            ...this.extractNestedFunctions(init, fullName, filePath),
          );
        }
      }
    }

    return functions;
  }

  /**
   * Extracts functions from call arguments: object literals and anonymous functions.
   * Naming scheme:
   * - Object literal methods: {line:col}funcName<arg:N>.methodName
   * - Anonymous functions: {line:col}funcName<arg:N><anonymous>
   * - Nested inside anonymous: {line:col}funcName<arg:N><anonymous>::nestedFn
   */
  private extractCallArgumentMethods(
    sourceFile: SourceFile,
    filePath: string,
  ): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    const processedNodes = new Set<Node>();

    for (const call of sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      const args = call.getArguments();

      for (let argIdx = 0; argIdx < args.length; argIdx++) {
        const arg = args[argIdx];
        if (processedNodes.has(arg)) continue;

        // Get the callee name and position
        const callee = call.getExpression();
        const calleeName = Node.isIdentifier(callee)
          ? callee.getText()
          : Node.isPropertyAccessExpression(callee)
            ? callee.getName()
            : "call";

        // For chained calls, get the position of the method name
        const callPos = Node.isPropertyAccessExpression(callee)
          ? callee.getNameNode().getStart()
          : call.getStart();
        const { line, column } = sourceFile.getLineAndColumnAtPos(callPos);

        // Build the synthetic name base: {line:col}funcName<arg:N>
        const syntheticBase = `{${line}:${column}}${calleeName}<arg:${argIdx}>`;

        // Determine nesting context
        const scopePrefix = this.getScopePrefix(call, filePath);
        const fullBase = scopePrefix
          ? `${scopePrefix}::${syntheticBase}`
          : syntheticBase;

        // Handle object literals: { method() {} }
        if (Node.isObjectLiteralExpression(arg)) {
          processedNodes.add(arg);
          functions.push(
            ...this.extractObjectLiteralMethods(
              arg,
              fullBase,
              filePath,
              sourceFile,
            ),
          );
        }
        // Handle anonymous functions: (args) => {} or function(args) {}
        else if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
          processedNodes.add(arg);
          const anonName = `${fullBase}<anonymous>`;
          const info = this.createFunctionInfo(arg, anonName, filePath);
          functions.push(info);
          // Extract nested functions within the anonymous function
          functions.push(
            ...this.extractNestedFunctions(arg, anonName, filePath),
          );
        }
      }
    }

    return functions;
  }

  /**
   * Gets the scope prefix for a node (e.g., "outerFn::innerFn" if inside nested functions).
   */
  private getScopePrefix(node: Node, filePath: string): string | null {
    const scopes: string[] = [];
    let current = node.getParent();

    while (current) {
      if (Node.isFunctionDeclaration(current)) {
        const name = current.getName();
        if (name) scopes.unshift(name);
      } else if (
        Node.isArrowFunction(current) ||
        Node.isFunctionExpression(current)
      ) {
        // Check if assigned to a variable
        const parent = current.getParent();
        if (parent && Node.isVariableDeclaration(parent)) {
          scopes.unshift(parent.getName());
        }
      } else if (Node.isMethodDeclaration(current)) {
        const name = current.getName();
        // Check if in a class
        const classParent = current.getParent();
        if (classParent && Node.isClassDeclaration(classParent)) {
          const className = classParent.getName() ?? "AnonymousClass";
          scopes.unshift(`${className}.${name}`);
        } else {
          scopes.unshift(name);
        }
      }
      current = current.getParent();
    }

    return scopes.length > 0 ? scopes.join("::") : null;
  }

  /**
   * Creates FunctionInfo for a method defined as a property assignment with a function value.
   */
  private createFunctionInfoFromMethod(
    prop: PropertyAssignment,
    fn: ArrowFunction | FunctionExpression,
    name: string,
    filePath: string,
  ): FunctionInfo {
    const startLine = prop.getStartLineNumber();
    const endLine = prop.getEndLineNumber();
    const id = `${filePath}::${name}`;

    const params = fn
      .getParameters()
      .map((p) => p.getText())
      .join(", ");
    const returnType = fn.getReturnType().getText();
    const signature = `(${params}) => ${returnType}`;
    const body = fn.getBody()?.getText() ?? null;

    return {
      id,
      name,
      filePath,
      startLine,
      endLine,
      signature,
      body,
      node: fn,
    };
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
    filePath: string,
  ): FunctionInfo {
    const startLine = fn.getStartLineNumber();
    const endLine = fn.getEndLineNumber();
    const id = `${filePath}::${name}`;

    let signature: string;
    let body: string | null = null;

    if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
      const params = fn
        .getParameters()
        .map((p) => p.getText())
        .join(", ");
      const returnType = fn.getReturnType().getText();
      signature = `(${params}) => ${returnType}`;
      body = fn.getBody()?.getText() ?? null;
    } else {
      signature = fn.getText().split("{")[0]?.trim() ?? fn.getText();
      body = fn.getText();
    }

    return {
      id,
      name,
      filePath,
      startLine,
      endLine,
      signature,
      body,
      node: fn,
    };
  }

  /**
   * Creates FunctionInfo for arrow functions and function expressions assigned to variables. Handles the different AST structure compared to declarations.
   */
  private createFunctionInfoFromVar(
    varDecl: VariableDeclaration,
    fn: ArrowFunction | FunctionExpression,
    name: string,
    filePath: string,
  ): FunctionInfo {
    const startLine = varDecl.getStartLineNumber();
    const endLine = varDecl.getEndLineNumber();
    const id = `${filePath}::${name}`;

    const params = fn
      .getParameters()
      .map((p) => p.getText())
      .join(", ");
    const returnType = fn.getReturnType().getText();
    const signature = `(${params}) => ${returnType}`;
    const body = fn.getBody()?.getText() ?? null;

    return {
      id,
      name,
      filePath,
      startLine,
      endLine,
      signature,
      body,
      node: fn,
    };
  }

  /**
   * Finds all call expressions within a function and resolves them to known function IDs. Returns deduplicated list of callee IDs for building the call graph.
   */
  private extractCalls(
    node: Node,
    functionMap: Map<string, FunctionInfo>,
  ): string[] {
    const calls: string[] = [];
    const callExpressions = node.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    );

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

  /**
   * Extracts dataflow edges for opaque higher-order function calls.
   * When we can't trace into a method (built-ins like .map/.filter), we create
   * "depends_on" edges from callback parameters to the object being iterated.
   */
  private extractOpaqueHofDataflow(
    callerFn: FunctionInfo,
    functionMap: Map<string, FunctionInfo>,
    accessibleVars: Map<string, VariableInfo>,
    parametersByFunction: Map<string, Map<string, ParameterInfo>>,
    localVariablesByFunction: Map<string, Map<string, VariableInfo>>,
    sourceFile: SourceFile,
    filePath: string,
    commitSha: string | null,
  ): Array<Omit<Relation, "id">> {
    const relations: Array<Omit<Relation, "id">> = [];
    const body = callerFn.node;

    const callExpressions = body.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    );

    for (const call of callExpressions) {
      const expression = call.getExpression();

      // Only handle method calls: obj.method(...)
      if (!Node.isPropertyAccessExpression(expression)) continue;

      const methodName = expression.getName();
      const objectExpr = expression.getExpression();

      // Check if method is traceable (exists in functionMap)
      if (this.isMethodTraceable(methodName, functionMap)) continue;

      // Find callback arguments
      const args = call.getArguments();
      for (let argIdx = 0; argIdx < args.length; argIdx++) {
        const arg = args[argIdx];
        if (!Node.isArrowFunction(arg) && !Node.isFunctionExpression(arg))
          continue;

        // Found opaque HOF with callback - find the object entity
        const objectEntity = this.findObjectEntity(
          objectExpr,
          callerFn,
          accessibleVars,
          parametersByFunction,
          localVariablesByFunction,
        );
        if (!objectEntity) continue;

        // Reconstruct callback function ID to find its parameters
        const callPos = expression.getNameNode().getStart();
        const { line, column } = sourceFile.getLineAndColumnAtPos(callPos);
        const syntheticBase = `{${line}:${column}}${methodName}<arg:${argIdx}>`;
        const scopePrefix = this.getScopePrefix(call, filePath);
        const fullBase = scopePrefix
          ? `${scopePrefix}::${syntheticBase}`
          : syntheticBase;
        const callbackId = `${filePath}::${fullBase}<anonymous>`;

        // Get callback's parameters
        const callbackParams = parametersByFunction.get(callbackId);
        if (!callbackParams || callbackParams.size === 0) continue;

        // First parameter depends on the object (for map/filter/forEach/find/etc)
        const firstParam = Array.from(callbackParams.values())[0];
        relations.push({
          from_id: firstParam.id,
          to_id: objectEntity.id,
          kind: "depends_on",
          commit_sha: commitSha!,
          metadata: JSON.stringify({ source: "hof_branch" }),
        });
      }
    }

    return relations;
  }

  /**
   * Checks if a method name is traceable (we have its implementation in functionMap).
   */
  private isMethodTraceable(
    methodName: string,
    functionMap: Map<string, FunctionInfo>,
  ): boolean {
    for (const [, fn] of functionMap) {
      if (fn.name === methodName || fn.name.endsWith(`.${methodName}`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Finds the entity for an object expression (variable, parameter, etc).
   */
  private findObjectEntity(
    objectExpr: Node,
    callerFn: FunctionInfo,
    accessibleVars: Map<string, VariableInfo>,
    parametersByFunction: Map<string, Map<string, ParameterInfo>>,
    localVariablesByFunction: Map<string, Map<string, VariableInfo>>,
  ): { id: string } | null {
    if (!Node.isIdentifier(objectExpr)) return null;

    const name = objectExpr.getText();

    // Check local variables of the containing function
    const localVars = localVariablesByFunction.get(callerFn.id);
    if (localVars?.has(name)) {
      return localVars.get(name)!;
    }

    // Check accessible variables (module-level + closure vars)
    if (accessibleVars.has(name)) {
      return accessibleVars.get(name)!;
    }

    // Check parameters of containing function
    const callerParams = parametersByFunction.get(callerFn.id);
    if (callerParams?.has(name)) {
      return callerParams.get(name)!;
    }

    return null;
  }

  /**
   * Extracts dependency edges from local variables to their initialization sources.
   * For `const x = y.method()`, creates edge: x depends_on y
   * For `const x = y`, creates edge: x depends_on y
   * For `const x = foo()`, creates edge: x depends_on foo<return>
   */
  private extractLocalVariableDependencies(
    callerFn: FunctionInfo,
    accessibleVars: Map<string, VariableInfo>,
    parametersByFunction: Map<string, Map<string, ParameterInfo>>,
    localVariablesByFunction: Map<string, Map<string, VariableInfo>>,
    functionMap: Map<string, FunctionInfo>,
    commitSha: string | null,
  ): Array<Omit<Relation, "id">> {
    const relations: Array<Omit<Relation, "id">> = [];

    const localVars = localVariablesByFunction.get(callerFn.id);
    if (!localVars) return relations;

    for (const [, localVar] of localVars) {
      // Get the initializer from the variable declaration
      const varNode = localVar.node;
      if (!Node.isVariableDeclaration(varNode) && !Node.isBindingElement(varNode)) continue;

      const initializer = Node.isVariableDeclaration(varNode)
        ? varNode.getInitializer()
        : null;
      if (!initializer) continue;

      // Find all identifiers in the initializer that reference tracked entities
      const deps = this.extractLocalVarInitDependencies(
        initializer,
        callerFn,
        accessibleVars,
        parametersByFunction,
        localVariablesByFunction,
        functionMap,
      );

      for (const depId of deps) {
        // Don't create self-references
        if (depId === localVar.id) continue;

        relations.push({
          from_id: localVar.id,
          to_id: depId,
          kind: "depends_on",
          commit_sha: commitSha!,
          metadata: JSON.stringify({ source: "initializer" }),
        });
      }
    }

    return relations;
  }

  /**
   * Extracts entity IDs that a local variable's initializer depends on.
   */
  private extractLocalVarInitDependencies(
    initializer: Node,
    callerFn: FunctionInfo,
    accessibleVars: Map<string, VariableInfo>,
    parametersByFunction: Map<string, Map<string, ParameterInfo>>,
    localVariablesByFunction: Map<string, Map<string, VariableInfo>>,
    functionMap: Map<string, FunctionInfo>,
  ): string[] {
    const deps: string[] = [];
    const seen = new Set<string>();

    // Find all identifiers in the expression
    const identifiers = initializer.getDescendantsOfKind(SyntaxKind.Identifier);

    // Also check if the initializer itself is an identifier
    if (Node.isIdentifier(initializer)) {
      const entity = this.findEntityByName(
        initializer.getText(),
        callerFn,
        accessibleVars,
        parametersByFunction,
        localVariablesByFunction,
      );
      if (entity && !seen.has(entity.id)) {
        deps.push(entity.id);
        seen.add(entity.id);
      }
    }

    for (const ident of identifiers) {
      // Skip property names in property access (obj.prop - skip prop)
      const parent = ident.getParent();
      if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === ident) {
        continue;
      }

      const name = ident.getText();
      const entity = this.findEntityByName(
        name,
        callerFn,
        accessibleVars,
        parametersByFunction,
        localVariablesByFunction,
      );

      if (entity && !seen.has(entity.id)) {
        deps.push(entity.id);
        seen.add(entity.id);
      }
    }

    // Find CallExpressions and add dependencies on their return values
    const callExprs = initializer.getDescendantsOfKind(SyntaxKind.CallExpression);

    // Also check if initializer itself is a call (or await of a call)
    let rootExpr = initializer;
    if (Node.isAwaitExpression(initializer)) {
      rootExpr = initializer.getExpression();
    }
    if (Node.isCallExpression(rootExpr)) {
      const returnId = this.resolveCallReturnId(rootExpr, functionMap);
      if (returnId && !seen.has(returnId)) {
        deps.push(returnId);
        seen.add(returnId);
      }
    }

    for (const call of callExprs) {
      const returnId = this.resolveCallReturnId(call, functionMap);
      if (returnId && !seen.has(returnId)) {
        deps.push(returnId);
        seen.add(returnId);
      }
    }

    return deps;
  }

  /**
   * Resolves a CallExpression to the return entity ID of the called function.
   */
  private resolveCallReturnId(
    call: CallExpression,
    functionMap: Map<string, FunctionInfo>,
  ): string | null {
    const calleeName = this.getCalleeName(call);
    if (!calleeName) return null;

    // Try to resolve the callee to a known function
    for (const [id, fn] of functionMap) {
      if (
        fn.name === calleeName ||
        id.endsWith(`::${calleeName}`) ||
        fn.name.endsWith(`.${calleeName}`)
      ) {
        return `${id}<return>`;
      }
    }

    return null;
  }

  /**
   * Finds an entity by name in the available scopes.
   */
  private findEntityByName(
    name: string,
    callerFn: FunctionInfo,
    accessibleVars: Map<string, VariableInfo>,
    parametersByFunction: Map<string, Map<string, ParameterInfo>>,
    localVariablesByFunction: Map<string, Map<string, VariableInfo>>,
  ): { id: string } | null {
    // Check local variables
    const localVars = localVariablesByFunction.get(callerFn.id);
    if (localVars?.has(name)) {
      return localVars.get(name)!;
    }

    // Check accessible variables (module-level + closure)
    if (accessibleVars.has(name)) {
      return accessibleVars.get(name)!;
    }

    // Check parameters
    const params = parametersByFunction.get(callerFn.id);
    if (params?.has(name)) {
      return params.get(name)!;
    }

    return null;
  }

  // Methods that mutate their receiver
  private readonly MUTATING_METHODS = new Set([
    // Array
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
    // Set/Map
    "add",
    "delete",
    "clear",
    "set",
  ]);

  /**
   * Extracts module-level variables (let/const/var at file scope).
   */
  extractModuleVariables(
    sourceFile: SourceFile,
    filePath: string,
  ): VariableInfo[] {
    const variables: VariableInfo[] = [];

    for (const varStmt of sourceFile.getVariableStatements()) {
      // Skip if inside a function (not module-level)
      if (this.hasParentFunction(varStmt)) continue;

      const isConst =
        varStmt.getDeclarationKind() === VariableDeclarationKind.Const;

      for (const decl of varStmt.getDeclarations()) {
        const initializer = decl.getInitializer();
        // Skip function declarations (they're tracked as functions)
        if (
          initializer &&
          (Node.isArrowFunction(initializer) ||
            Node.isFunctionExpression(initializer))
        ) {
          continue;
        }

        const nameNode = decl.getNameNode();
        // Handle simple identifiers
        if (Node.isIdentifier(nameNode)) {
          const name = decl.getName();
          variables.push({
            id: `${filePath}::${name}`,
            name,
            filePath,
            startLine: decl.getStartLineNumber(),
            endLine: decl.getEndLineNumber(),
            isConst,
            initialValue: initializer?.getText() ?? null,
            node: decl,
          });
        }
        // Handle destructuring
        else {
          const bindings = this.extractBindingNames(nameNode);
          for (const binding of bindings) {
            variables.push({
              id: `${filePath}::${binding.name}`,
              name: binding.name,
              filePath,
              startLine: binding.node.getStartLineNumber(),
              endLine: binding.node.getEndLineNumber(),
              isConst,
              initialValue: null,
              node: binding.node,
            });
          }
        }
      }
    }

    return variables;
  }

  /**
   * Extracts class properties (instance and static) from all classes in a source file.
   */
  extractClassProperties(
    sourceFile: SourceFile,
    filePath: string,
  ): ClassPropertyInfo[] {
    const properties: ClassPropertyInfo[] = [];

    for (const classDecl of sourceFile.getClasses()) {
      const className = classDecl.getName() ?? "AnonymousClass";

      for (const prop of classDecl.getProperties()) {
        const name = prop.getName();
        const isReadonly = prop.isReadonly();
        const initializer = prop.getInitializer();

        properties.push({
          id: `${filePath}::${className}.${name}`,
          name,
          className,
          filePath,
          startLine: prop.getStartLineNumber(),
          endLine: prop.getEndLineNumber(),
          isReadonly,
          initialValue: initializer?.getText() ?? null,
          node: prop,
        });
      }
    }

    return properties;
  }

  /**
   * Gets the class name that owns a method node, or null if not a class method.
   */
  private getOwningClassName(node: Node): string | null {
    let current = node.getParent();
    while (current) {
      if (Node.isClassDeclaration(current)) {
        return current.getName() ?? "AnonymousClass";
      }
      current = current.getParent();
    }
    return null;
  }

  /**
   * Extracts this.x property accesses (reads/writes) from a class method body.
   */
  private extractThisPropertyAccesses(
    methodNode: Node,
    classProps: Map<string, ClassPropertyInfo>,
    filePath: string,
  ): VariableAccess[] {
    const accesses: VariableAccess[] = [];
    const body = this.getFunctionBody(methodNode);
    if (!body) return accesses;

    const writtenProps = new Set<string>();

    // Track assignments to this.x
    for (const propAccess of body.getDescendantsOfKind(
      SyntaxKind.PropertyAccessExpression,
    )) {
      if (this.hasIntermediateFunction(body, propAccess)) continue;

      const expr = propAccess.getExpression();
      if (expr.getKind() !== SyntaxKind.ThisKeyword) continue;

      const propName = propAccess.getName();
      const propInfo = classProps.get(propName);
      if (!propInfo) continue;

      // Check if this is a write position
      const parent = propAccess.getParent();
      if (parent && Node.isBinaryExpression(parent)) {
        const left = parent.getLeft();
        if (
          left === propAccess &&
          this.isAssignmentOperator(parent.getOperatorToken().getKind())
        ) {
          writtenProps.add(propName);
          accesses.push({
            variableName: propName,
            variableId: propInfo.id,
            kind: "writes",
          });
          continue;
        }
      }

      // Check for prefix/postfix operators
      if (
        parent &&
        (Node.isPrefixUnaryExpression(parent) ||
          Node.isPostfixUnaryExpression(parent))
      ) {
        const op = parent.getOperatorToken();
        if (
          op === SyntaxKind.PlusPlusToken ||
          op === SyntaxKind.MinusMinusToken
        ) {
          writtenProps.add(propName);
          accesses.push({
            variableName: propName,
            variableId: propInfo.id,
            kind: "writes",
          });
          continue;
        }
      }

      // Check for mutating method calls (this.arr.push)
      const grandParent = parent?.getParent();
      if (grandParent && Node.isCallExpression(grandParent)) {
        const callExpr = grandParent.getExpression();
        if (Node.isPropertyAccessExpression(callExpr)) {
          const methodName = callExpr.getName();
          if (this.MUTATING_METHODS.has(methodName)) {
            writtenProps.add(propName);
            accesses.push({
              variableName: propName,
              variableId: propInfo.id,
              kind: "writes",
            });
            continue;
          }
        }
      }

      // Otherwise it's a read (if not already tracked as write)
      if (!writtenProps.has(propName)) {
        accesses.push({
          variableName: propName,
          variableId: propInfo.id,
          kind: "reads",
        });
      }
    }

    // Deduplicate accesses
    const seen = new Set<string>();
    return accesses.filter((a) => {
      const key = `${a.variableId}:${a.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Checks if a node is inside a function (not at module level).
   */
  private hasParentFunction(node: Node): boolean {
    let current = node.getParent();
    while (current) {
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
   * Extracts variable names from destructuring patterns.
   */
  private extractBindingNames(node: Node): Array<{ name: string; node: Node }> {
    const bindings: Array<{ name: string; node: Node }> = [];

    if (Node.isObjectBindingPattern(node)) {
      for (const element of node.getElements()) {
        const nameNode = element.getNameNode();
        if (Node.isIdentifier(nameNode)) {
          bindings.push({ name: nameNode.getText(), node: nameNode });
        } else {
          // Nested destructuring
          bindings.push(...this.extractBindingNames(nameNode));
        }
      }
    } else if (Node.isArrayBindingPattern(node)) {
      for (const element of node.getElements()) {
        if (Node.isBindingElement(element)) {
          const nameNode = element.getNameNode();
          if (Node.isIdentifier(nameNode)) {
            bindings.push({ name: nameNode.getText(), node: nameNode });
          } else {
            bindings.push(...this.extractBindingNames(nameNode));
          }
        }
      }
    }

    return bindings;
  }

  /**
   * Builds scope context for a function, tracking local variables and parameters.
   */
  buildScopeContext(
    functionNode: Node,
    parentScope?: ScopeContext,
  ): ScopeContext {
    const context: ScopeContext = {
      localVariables: new Set(),
      parameters: new Set(),
      parentScopes: parentScope
        ? [parentScope, ...parentScope.parentScopes]
        : [],
    };

    // Extract parameters
    if (
      Node.isFunctionDeclaration(functionNode) ||
      Node.isArrowFunction(functionNode) ||
      Node.isFunctionExpression(functionNode) ||
      Node.isMethodDeclaration(functionNode)
    ) {
      for (const param of (
        functionNode as FunctionDeclaration
      ).getParameters()) {
        const nameNode = param.getNameNode();
        if (Node.isIdentifier(nameNode)) {
          context.parameters.add(nameNode.getText());
        } else {
          // Handle destructured parameters
          for (const binding of this.extractBindingNames(nameNode)) {
            context.parameters.add(binding.name);
          }
        }
      }
    }

    // Extract local variable declarations
    const body = this.getFunctionBody(functionNode);
    if (body) {
      const varDecls = body.getDescendantsOfKind(
        SyntaxKind.VariableDeclaration,
      );
      for (const decl of varDecls) {
        // Only count if direct child (not in nested function)
        if (!this.hasIntermediateFunction(body, decl)) {
          const nameNode = decl.getNameNode();
          if (Node.isIdentifier(nameNode)) {
            context.localVariables.add(nameNode.getText());
          } else {
            for (const binding of this.extractBindingNames(nameNode)) {
              context.localVariables.add(binding.name);
            }
          }
        }
      }
    }

    return context;
  }

  /**
   * Gets the body node of a function.
   */
  private getFunctionBody(functionNode: Node): Node | null {
    if (
      Node.isFunctionDeclaration(functionNode) ||
      Node.isMethodDeclaration(functionNode) ||
      Node.isArrowFunction(functionNode) ||
      Node.isFunctionExpression(functionNode)
    ) {
      return (functionNode as FunctionDeclaration).getBody() ?? null;
    }
    return null;
  }

  /**
   * Checks if a variable is external to the current scope (not local or parameter).
   */
  private isExternalVariable(
    name: string,
    scope: ScopeContext,
    moduleVariables: Map<string, VariableInfo>,
  ): boolean {
    // Check if it's a local variable or parameter
    if (scope.localVariables.has(name) || scope.parameters.has(name)) {
      return false;
    }

    // Check parent scopes for closures
    for (const parentScope of scope.parentScopes) {
      if (
        parentScope.localVariables.has(name) ||
        parentScope.parameters.has(name)
      ) {
        return false; // Closure captured, but not a module-level side effect
      }
    }

    // Check if it's a known module-level variable
    return moduleVariables.has(name);
  }

  /**
   * Extracts all variable accesses (reads/writes) from a function.
   */
  extractVariableAccesses(
    functionNode: Node,
    scope: ScopeContext,
    moduleVariables: Map<string, VariableInfo>,
    filePath: string,
  ): VariableAccess[] {
    const accesses: VariableAccess[] = [];
    const body = this.getFunctionBody(functionNode);
    if (!body) return accesses;

    const writtenIdentifiers = new Set<Node>();

    // Track assignments (binary expressions with assignment operator)
    for (const binExpr of body.getDescendantsOfKind(
      SyntaxKind.BinaryExpression,
    )) {
      if (this.hasIntermediateFunction(body, binExpr)) continue;

      const operatorKind = binExpr.getOperatorToken().getKind();
      if (this.isAssignmentOperator(operatorKind)) {
        const left = binExpr.getLeft();
        this.processWriteTarget(
          left,
          accesses,
          scope,
          moduleVariables,
          filePath,
          writtenIdentifiers,
        );
      }
    }

    // Track prefix/postfix operations (++x, x++, --x, x--)
    for (const prefixExpr of body.getDescendantsOfKind(
      SyntaxKind.PrefixUnaryExpression,
    )) {
      if (this.hasIntermediateFunction(body, prefixExpr)) continue;

      const op = prefixExpr.getOperatorToken();
      if (
        op === SyntaxKind.PlusPlusToken ||
        op === SyntaxKind.MinusMinusToken
      ) {
        this.processWriteTarget(
          prefixExpr.getOperand(),
          accesses,
          scope,
          moduleVariables,
          filePath,
          writtenIdentifiers,
        );
      }
    }

    for (const postfixExpr of body.getDescendantsOfKind(
      SyntaxKind.PostfixUnaryExpression,
    )) {
      if (this.hasIntermediateFunction(body, postfixExpr)) continue;

      const op = postfixExpr.getOperatorToken();
      if (
        op === SyntaxKind.PlusPlusToken ||
        op === SyntaxKind.MinusMinusToken
      ) {
        this.processWriteTarget(
          postfixExpr.getOperand(),
          accesses,
          scope,
          moduleVariables,
          filePath,
          writtenIdentifiers,
        );
      }
    }

    // Track mutating method calls (arr.push, arr.splice, etc.)
    for (const callExpr of body.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      if (this.hasIntermediateFunction(body, callExpr)) continue;
      this.processMutatingCall(
        callExpr,
        accesses,
        scope,
        moduleVariables,
        filePath,
        writtenIdentifiers,
      );
    }

    // Track reads (all other identifier usages not in write position)
    for (const identifier of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (this.hasIntermediateFunction(body, identifier)) continue;
      if (writtenIdentifiers.has(identifier)) continue;

      const name = identifier.getText();
      if (!this.isExternalVariable(name, scope, moduleVariables)) continue;
      if (this.isInWritePosition(identifier)) continue;

      const varInfo = moduleVariables.get(name);
      if (varInfo) {
        accesses.push({
          variableName: name,
          variableId: varInfo.id,
          kind: "reads",
        });
      }
    }

    // Deduplicate accesses
    const seen = new Set<string>();
    return accesses.filter((a) => {
      const key = `${a.variableId}:${a.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Checks if an operator is an assignment operator.
   */
  private isAssignmentOperator(kind: SyntaxKind): boolean {
    return [
      SyntaxKind.EqualsToken,
      SyntaxKind.PlusEqualsToken,
      SyntaxKind.MinusEqualsToken,
      SyntaxKind.AsteriskEqualsToken,
      SyntaxKind.SlashEqualsToken,
      SyntaxKind.PercentEqualsToken,
      SyntaxKind.AmpersandEqualsToken,
      SyntaxKind.BarEqualsToken,
      SyntaxKind.CaretEqualsToken,
      SyntaxKind.AsteriskAsteriskEqualsToken,
      SyntaxKind.LessThanLessThanEqualsToken,
      SyntaxKind.GreaterThanGreaterThanEqualsToken,
      SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
      SyntaxKind.BarBarEqualsToken,
      SyntaxKind.AmpersandAmpersandEqualsToken,
      SyntaxKind.QuestionQuestionEqualsToken,
    ].includes(kind);
  }

  /**
   * Processes a write target (LHS of assignment) and adds to accesses.
   */
  private processWriteTarget(
    node: Node,
    accesses: VariableAccess[],
    scope: ScopeContext,
    moduleVariables: Map<string, VariableInfo>,
    filePath: string,
    writtenIdentifiers: Set<Node>,
  ): void {
    // Direct identifier: x = value
    if (Node.isIdentifier(node)) {
      writtenIdentifiers.add(node);
      const name = node.getText();
      if (this.isExternalVariable(name, scope, moduleVariables)) {
        const varInfo = moduleVariables.get(name);
        if (varInfo) {
          accesses.push({
            variableName: name,
            variableId: varInfo.id,
            kind: "writes",
          });
        }
      }
    }
    // Property access: obj.prop = value -> mutates obj
    else if (Node.isPropertyAccessExpression(node)) {
      const rootObj = this.getRootObject(node);
      if (Node.isIdentifier(rootObj)) {
        writtenIdentifiers.add(rootObj);
        const name = rootObj.getText();
        if (this.isExternalVariable(name, scope, moduleVariables)) {
          const varInfo = moduleVariables.get(name);
          if (varInfo) {
            accesses.push({
              variableName: name,
              variableId: varInfo.id,
              kind: "writes",
            });
          }
        }
      }
    }
    // Element access: arr[0] = value -> mutates arr
    else if (Node.isElementAccessExpression(node)) {
      const rootObj = this.getRootObject(node);
      if (Node.isIdentifier(rootObj)) {
        writtenIdentifiers.add(rootObj);
        const name = rootObj.getText();
        if (this.isExternalVariable(name, scope, moduleVariables)) {
          const varInfo = moduleVariables.get(name);
          if (varInfo) {
            accesses.push({
              variableName: name,
              variableId: varInfo.id,
              kind: "writes",
            });
          }
        }
      }
    }
  }

  /**
   * Gets the root object from a property or element access chain.
   */
  private getRootObject(node: Node): Node {
    if (Node.isPropertyAccessExpression(node)) {
      return this.getRootObject(node.getExpression());
    }
    if (Node.isElementAccessExpression(node)) {
      return this.getRootObject(node.getExpression());
    }
    return node;
  }

  /**
   * Processes a call expression to detect mutating method calls.
   */
  private processMutatingCall(
    callExpr: CallExpression,
    accesses: VariableAccess[],
    scope: ScopeContext,
    moduleVariables: Map<string, VariableInfo>,
    filePath: string,
    writtenIdentifiers: Set<Node>,
  ): void {
    const expression = callExpr.getExpression();

    if (Node.isPropertyAccessExpression(expression)) {
      const methodName = expression.getName();

      if (this.MUTATING_METHODS.has(methodName)) {
        const rootObj = this.getRootObject(expression.getExpression());

        if (Node.isIdentifier(rootObj)) {
          writtenIdentifiers.add(rootObj);
          const name = rootObj.getText();
          if (this.isExternalVariable(name, scope, moduleVariables)) {
            const varInfo = moduleVariables.get(name);
            if (varInfo) {
              accesses.push({
                variableName: name,
                variableId: varInfo.id,
                kind: "writes",
              });
            }
          }
        }
      }
    }
  }

  /**
   * Checks if an identifier is in a write position (LHS of assignment).
   */
  private isInWritePosition(identifier: Node): boolean {
    const parent = identifier.getParent();
    if (!parent) return false;

    // Check if it's the left side of an assignment
    if (Node.isBinaryExpression(parent)) {
      const left = parent.getLeft();
      if (
        left === identifier &&
        this.isAssignmentOperator(parent.getOperatorToken().getKind())
      ) {
        return true;
      }
    }

    // Check if it's in a prefix/postfix expression
    if (
      Node.isPrefixUnaryExpression(parent) ||
      Node.isPostfixUnaryExpression(parent)
    ) {
      const op = parent.getOperatorToken();
      if (
        op === SyntaxKind.PlusPlusToken ||
        op === SyntaxKind.MinusMinusToken
      ) {
        return true;
      }
    }

    // Check if it's part of a property/element access that's being assigned
    if (
      Node.isPropertyAccessExpression(parent) ||
      Node.isElementAccessExpression(parent)
    ) {
      return this.isInWritePosition(parent);
    }

    return false;
  }

  /**
   * Finds closure variables that are mutated by nested functions.
   * Returns variable info for each mutated closure variable.
   */
  findMutatedClosureVariables(
    functionMap: Map<string, FunctionInfo>,
    filePath: string,
  ): VariableInfo[] {
    const closureVariables: VariableInfo[] = [];
    const seen = new Set<string>();

    for (const [fnId, fnInfo] of functionMap) {
      // Only process functions that have nested functions (contain :: after the file path)
      const parts = fnId.split("::");
      if (parts.length < 3) continue; // No parent function

      // Get the parent function ID
      const parentId = parts.slice(0, -1).join("::");
      const parentFn = functionMap.get(parentId);
      if (!parentFn) continue;

      // Get parent's local variables
      const parentLocals = this.getLocalVariableDeclarations(parentFn.node);
      if (parentLocals.size === 0) continue;

      // Check if this nested function writes to any parent local
      const mutations = this.findWritesToVariables(fnInfo.node, parentLocals);

      for (const [varName, varDecl] of mutations) {
        const varId = `${parentId}::${varName}`;
        if (seen.has(varId)) continue;
        seen.add(varId);

        const isConst = this.isConstDeclaration(varDecl);
        closureVariables.push({
          id: varId,
          name: varName,
          filePath,
          startLine: varDecl.getStartLineNumber(),
          endLine: varDecl.getEndLineNumber(),
          isConst,
          initialValue: varDecl.getInitializer()?.getText() ?? null,
          node: varDecl,
          ownerFunctionId: parentId,
        });
      }
    }

    return closureVariables;
  }

  /**
   * Gets all local variable declarations in a function (not in nested functions).
   */
  private getLocalVariableDeclarations(
    functionNode: Node,
  ): Map<string, VariableDeclaration> {
    const locals = new Map<string, VariableDeclaration>();
    const body = this.getFunctionBody(functionNode);
    if (!body) return locals;

    const varDecls = body.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
    for (const decl of varDecls) {
      // Skip if inside a nested function
      if (this.hasIntermediateFunction(body, decl)) continue;

      // Skip function declarations (arrow functions, function expressions)
      const initializer = decl.getInitializer();
      if (
        initializer &&
        (Node.isArrowFunction(initializer) ||
          Node.isFunctionExpression(initializer))
      ) {
        continue;
      }

      const nameNode = decl.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        locals.set(nameNode.getText(), decl);
      }
      // Handle destructuring
      else {
        for (const binding of this.extractBindingNames(nameNode)) {
          // For destructuring, we use the first decl as representative
          locals.set(binding.name, decl);
        }
      }
    }

    return locals;
  }

  /**
   * Checks if a variable declaration is const.
   */
  private isConstDeclaration(decl: VariableDeclaration): boolean {
    const varStmt = decl.getFirstAncestorByKind(SyntaxKind.VariableStatement);
    if (!varStmt) return false;
    return varStmt.getDeclarationKind() === VariableDeclarationKind.Const;
  }

  /**
   * Finds all writes to specific variables within a function body.
   * Returns the variable names that are written to along with their declarations.
   */
  private findWritesToVariables(
    functionNode: Node,
    targetVariables: Map<string, VariableDeclaration>,
  ): Map<string, VariableDeclaration> {
    const written = new Map<string, VariableDeclaration>();
    const body = this.getFunctionBody(functionNode);
    if (!body) return written;

    // Check direct assignments
    for (const binExpr of body.getDescendantsOfKind(
      SyntaxKind.BinaryExpression,
    )) {
      const operatorKind = binExpr.getOperatorToken().getKind();
      if (this.isAssignmentOperator(operatorKind)) {
        const left = binExpr.getLeft();
        const varName = this.getWrittenVariableName(left);
        if (varName && targetVariables.has(varName)) {
          written.set(varName, targetVariables.get(varName)!);
        }
      }
    }

    // Check prefix/postfix operations
    for (const prefixExpr of body.getDescendantsOfKind(
      SyntaxKind.PrefixUnaryExpression,
    )) {
      const op = prefixExpr.getOperatorToken();
      if (
        op === SyntaxKind.PlusPlusToken ||
        op === SyntaxKind.MinusMinusToken
      ) {
        const varName = this.getWrittenVariableName(prefixExpr.getOperand());
        if (varName && targetVariables.has(varName)) {
          written.set(varName, targetVariables.get(varName)!);
        }
      }
    }

    for (const postfixExpr of body.getDescendantsOfKind(
      SyntaxKind.PostfixUnaryExpression,
    )) {
      const op = postfixExpr.getOperatorToken();
      if (
        op === SyntaxKind.PlusPlusToken ||
        op === SyntaxKind.MinusMinusToken
      ) {
        const varName = this.getWrittenVariableName(postfixExpr.getOperand());
        if (varName && targetVariables.has(varName)) {
          written.set(varName, targetVariables.get(varName)!);
        }
      }
    }

    // Check mutating method calls
    for (const callExpr of body.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      const expression = callExpr.getExpression();
      if (Node.isPropertyAccessExpression(expression)) {
        const methodName = expression.getName();
        if (this.MUTATING_METHODS.has(methodName)) {
          const rootObj = this.getRootObject(expression.getExpression());
          if (Node.isIdentifier(rootObj)) {
            const varName = rootObj.getText();
            if (targetVariables.has(varName)) {
              written.set(varName, targetVariables.get(varName)!);
            }
          }
        }
      }
    }

    return written;
  }

  /**
   * Gets the variable name being written to from an expression.
   */
  private getWrittenVariableName(node: Node): string | null {
    if (Node.isIdentifier(node)) {
      return node.getText();
    }
    if (
      Node.isPropertyAccessExpression(node) ||
      Node.isElementAccessExpression(node)
    ) {
      const root = this.getRootObject(node);
      if (Node.isIdentifier(root)) {
        return root.getText();
      }
    }
    return null;
  }

  // ==================== Import/Export Handling ====================

  /**
   * Extracts the default export from a source file.
   * Returns an entity for <default> and optionally an alias if it points to a named entity.
   */
  private extractDefaultExport(
    sourceFile: SourceFile,
    filePath: string,
    allEntityIds: Set<string>,
    commitSha: string,
  ): {
    entity?: Omit<Entity, "created_at">;
    alias?: Omit<Relation, "id">;
  } | null {
    const defaultExportSymbol = sourceFile.getDefaultExportSymbol();
    if (!defaultExportSymbol) return null;

    const declarations = defaultExportSymbol.getDeclarations();
    if (declarations.length === 0) return null;

    const decl = declarations[0];
    const defaultId = `${filePath}::<default>`;

    // Check if it's an export assignment: export default foo
    if (Node.isExportAssignment(decl)) {
      const expr = decl.getExpression();

      // If it references an identifier, create alias to that entity
      if (Node.isIdentifier(expr)) {
        const name = expr.getText();
        // Find the entity it references
        const targetId = `${filePath}::${name}`;
        if (allEntityIds.has(targetId)) {
          // Create <default> as alias to the named entity
          return {
            entity: {
              id: defaultId,
              kind: "function", // Will be refined based on target
              name: "<default>",
              file_path: filePath,
              start_line: decl.getStartLineNumber(),
              end_line: decl.getEndLineNumber(),
              signature: `export default ${name}`,
              signature_hash: computeSignatureHash(`export default`),
              impl_hash: null,
              commit_sha: commitSha,
            },
            alias: {
              from_id: defaultId,
              to_id: targetId,
              kind: "aliases",
              commit_sha: commitSha,
              metadata: null,
            },
          };
        }
      }

      // Anonymous default export: export default () => {} or export default { ... }
      if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) {
        const params = (expr as ArrowFunction)
          .getParameters()
          .map((p) => p.getText())
          .join(", ");
        return {
          entity: {
            id: defaultId,
            kind: "function",
            name: "<default>",
            file_path: filePath,
            start_line: decl.getStartLineNumber(),
            end_line: decl.getEndLineNumber(),
            signature: `(${params}) => ...`,
            signature_hash: computeSignatureHash(`export default function`),
            impl_hash: computeImplHash(expr.getText()),
            commit_sha: commitSha,
          },
        };
      }
    }

    // Check for: export default function foo() {} or export default class Foo {}
    if (Node.isFunctionDeclaration(decl)) {
      const name = decl.getName();
      if (name) {
        const targetId = `${filePath}::${name}`;
        if (allEntityIds.has(targetId)) {
          return {
            entity: {
              id: defaultId,
              kind: "function",
              name: "<default>",
              file_path: filePath,
              start_line: decl.getStartLineNumber(),
              end_line: decl.getEndLineNumber(),
              signature: `export default ${name}`,
              signature_hash: computeSignatureHash(`export default`),
              impl_hash: null,
              commit_sha: commitSha,
            },
            alias: {
              from_id: defaultId,
              to_id: targetId,
              kind: "aliases",
              commit_sha: commitSha,
              metadata: null,
            },
          };
        }
      }
    }

    return null;
  }

  /**
   * Extracts import bindings as entities and alias relations.
   * Each import creates a local entity that aliases the source module entity.
   */
  private extractImports(
    sourceFile: SourceFile,
    filePath: string,
    commitSha: string,
  ): {
    entities: Omit<Entity, "created_at">[];
    aliases: Omit<Relation, "id">[];
  } {
    const entities: Omit<Entity, "created_at">[] = [];
    const aliases: Omit<Relation, "id">[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();

      // Resolve the module path
      const resolvedPath = this.resolveModulePath(sourceFile, moduleSpecifier);
      if (!resolvedPath) continue;

      // Handle default import: import foo from './mod'
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        const localName = defaultImport.getText();
        const localId = `${filePath}::${localName}`;
        const targetId = `${resolvedPath}::<default>`;

        entities.push({
          id: localId,
          kind: "variable", // imports are bindings
          name: localName,
          file_path: filePath,
          start_line: importDecl.getStartLineNumber(),
          end_line: importDecl.getEndLineNumber(),
          signature: `import ${localName} from "${moduleSpecifier}"`,
          signature_hash: computeSignatureHash(`import default`),
          impl_hash: null,
          commit_sha: commitSha,
        });

        aliases.push({
          from_id: localId,
          to_id: targetId,
          kind: "aliases",
          commit_sha: commitSha,
          metadata: null,
        });
      }

      // Handle named imports: import { foo, bar as baz } from './mod'
      const namedImports = importDecl.getNamedImports();
      for (const namedImport of namedImports) {
        const sourceName = namedImport.getName(); // foo (the imported name)
        const localName = namedImport.getAliasNode()?.getText() ?? sourceName; // baz or foo

        const localId = `${filePath}::${localName}`;
        const targetId = `${resolvedPath}::${sourceName}`;

        entities.push({
          id: localId,
          kind: "variable",
          name: localName,
          file_path: filePath,
          start_line: namedImport.getStartLineNumber(),
          end_line: namedImport.getEndLineNumber(),
          signature:
            localName === sourceName
              ? `import { ${sourceName} }`
              : `import { ${sourceName} as ${localName} }`,
          signature_hash: computeSignatureHash(`import named`),
          impl_hash: null,
          commit_sha: commitSha,
        });

        aliases.push({
          from_id: localId,
          to_id: targetId,
          kind: "aliases",
          commit_sha: commitSha,
          metadata: null,
        });
      }

      // Handle namespace import: import * as utils from './mod'
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        const localName = namespaceImport.getText();
        const localId = `${filePath}::${localName}`;
        const targetId = `${resolvedPath}::<namespace>`;

        entities.push({
          id: localId,
          kind: "module",
          name: localName,
          file_path: filePath,
          start_line: importDecl.getStartLineNumber(),
          end_line: importDecl.getEndLineNumber(),
          signature: `import * as ${localName} from "${moduleSpecifier}"`,
          signature_hash: computeSignatureHash(`import namespace`),
          impl_hash: null,
          commit_sha: commitSha,
        });

        aliases.push({
          from_id: localId,
          to_id: targetId,
          kind: "aliases",
          commit_sha: commitSha,
          metadata: null,
        });
      }
    }

    return { entities, aliases };
  }

  /**
   * Extracts re-export declarations as entities and alias relations.
   * Handles: export { foo } from './mod', export { foo as bar } from './mod', export * from './mod'
   */
  private extractReExports(
    sourceFile: SourceFile,
    filePath: string,
    commitSha: string,
  ): {
    entities: Omit<Entity, "created_at">[];
    aliases: Omit<Relation, "id">[];
  } {
    const entities: Omit<Entity, "created_at">[] = [];
    const aliases: Omit<Relation, "id">[] = [];

    for (const exportDecl of sourceFile.getExportDeclarations()) {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (!moduleSpecifier) continue; // Not a re-export, just `export { foo }`

      // Resolve the source module path directly from export declaration
      const moduleFile = exportDecl.getModuleSpecifierSourceFile();
      if (!moduleFile) continue;
      const resolvedPath = this.getRelativePath(moduleFile.getFilePath());

      // Handle named re-exports: export { foo, bar as baz } from './mod'
      const namedExports = exportDecl.getNamedExports();
      for (const namedExport of namedExports) {
        const sourceName = namedExport.getName(); // foo (from source module)
        const localName = namedExport.getAliasNode()?.getText() ?? sourceName; // baz or foo

        const localId = `${filePath}::${localName}`;
        // Handle re-exporting default: export { default as foo } from './mod'
        const targetName = sourceName === "default" ? "<default>" : sourceName;
        const targetId = `${resolvedPath}::${targetName}`;

        entities.push({
          id: localId,
          kind: "variable",
          name: localName,
          file_path: filePath,
          start_line: namedExport.getStartLineNumber(),
          end_line: namedExport.getEndLineNumber(),
          signature:
            localName === sourceName
              ? `export { ${sourceName} } from "${moduleSpecifier}"`
              : `export { ${sourceName} as ${localName} } from "${moduleSpecifier}"`,
          signature_hash: computeSignatureHash(`export named from`),
          impl_hash: null,
          commit_sha: commitSha,
        });

        aliases.push({
          from_id: localId,
          to_id: targetId,
          kind: "aliases",
          commit_sha: commitSha,
          metadata: null,
        });
      }

      // Handle star re-export: export * from './mod'
      if (exportDecl.isNamespaceExport()) {
        // Create a <re-export:modulePath> entity that aliases <namespace>
        const reExportId = `${filePath}::<re-export:${moduleSpecifier}>`;
        const targetId = `${resolvedPath}::<namespace>`;

        entities.push({
          id: reExportId,
          kind: "module",
          name: `<re-export:${moduleSpecifier}>`,
          file_path: filePath,
          start_line: exportDecl.getStartLineNumber(),
          end_line: exportDecl.getEndLineNumber(),
          signature: `export * from "${moduleSpecifier}"`,
          signature_hash: computeSignatureHash(`export star from`),
          impl_hash: null,
          commit_sha: commitSha,
        });

        aliases.push({
          from_id: reExportId,
          to_id: targetId,
          kind: "aliases",
          commit_sha: commitSha,
          metadata: null,
        });
      }
    }

    return { entities, aliases };
  }

  /**
   * Resolves a module specifier to a file path relative to project root.
   */
  private resolveModulePath(
    sourceFile: SourceFile,
    moduleSpecifier: string,
  ): string | null {
    // Only handle relative imports for now
    if (!moduleSpecifier.startsWith(".")) {
      return null;
    }

    try {
      // Use ts-morph's module resolution
      const importDecl = sourceFile.getImportDeclaration(moduleSpecifier);
      if (!importDecl) return null;

      const moduleFile = importDecl.getModuleSpecifierSourceFile();
      if (!moduleFile) return null;

      return this.getRelativePath(moduleFile.getFilePath());
    } catch {
      return null;
    }
  }

  // ==================== Dependency Tracking ====================

  /**
   * Creates a <return> entity for a function.
   * This entity represents the function's return value for dependency tracking.
   */
  private createReturnEntity(
    fn: FunctionInfo,
    fnId: string,
    commitSha: string,
  ): Omit<Entity, "created_at"> {
    const returnId = `${fnId}<return>`;
    return {
      id: returnId,
      kind: "variable", // Return values are treated as synthetic variables
      name: "<return>",
      file_path: fn.filePath,
      start_line: fn.startLine,
      end_line: fn.endLine,
      signature: `${fn.name}<return>`,
      signature_hash: computeSignatureHash("<return>"),
      impl_hash: null,
      commit_sha: commitSha,
    };
  }

  /**
   * Extracts dependencies for a function's return value.
   * Finds all return statements and tracks what they depend on.
   */
  private extractReturnDependencies(
    functionNode: Node,
    fnId: string,
    allEntityIds: Set<string>,
    variableMap: Map<string, VariableInfo>,
    functionMap: Map<string, FunctionInfo>,
    parametersMap?: Map<string, ParameterInfo>,
  ): Dependency[] {
    const dependencies: Dependency[] = [];
    const returnId = `${fnId}<return>`;
    const body = this.getFunctionBody(functionNode);
    if (!body) return dependencies;

    const seen = new Set<string>();

    // Find all return statements
    const returnStatements = body.getDescendantsOfKind(
      SyntaxKind.ReturnStatement,
    );
    for (const returnStmt of returnStatements) {
      // Skip if inside a nested function
      if (this.hasIntermediateFunction(body, returnStmt)) continue;

      const expr = returnStmt.getExpression();
      if (!expr) continue;

      // Extract all entity references from the return expression
      const refs = this.extractExpressionDependencies(
        expr,
        fnId,
        allEntityIds,
        variableMap,
        functionMap,
        parametersMap,
      );

      for (const refId of refs) {
        if (!seen.has(refId)) {
          seen.add(refId);
          dependencies.push({ fromId: returnId, toId: refId });
        }
      }
    }

    // Handle implicit return for arrow functions with expression body
    if (Node.isArrowFunction(functionNode)) {
      const arrowBody = functionNode.getBody();
      if (arrowBody && !Node.isBlock(arrowBody)) {
        // Expression body: () => expr
        const refs = this.extractExpressionDependencies(
          arrowBody,
          fnId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        );

        for (const refId of refs) {
          if (!seen.has(refId)) {
            seen.add(refId);
            dependencies.push({ fromId: returnId, toId: refId });
          }
        }
      }
    }

    return dependencies;
  }

  /**
   * Extracts dependencies for a variable's initializer.
   * const x = a + b → x depends on a, b
   * const x = foo() → x depends on foo<return>
   */
  private extractInitializerDependencies(
    varNode: Node,
    varId: string,
    filePath: string,
    allEntityIds: Set<string>,
    variableMap: Map<string, VariableInfo>,
    functionMap: Map<string, FunctionInfo>,
  ): Dependency[] {
    if (!Node.isVariableDeclaration(varNode)) return [];

    const initializer = varNode.getInitializer();
    if (!initializer) return [];

    // Skip function expressions - they're not dependencies
    if (
      Node.isArrowFunction(initializer) ||
      Node.isFunctionExpression(initializer)
    ) {
      return [];
    }

    const dependencies: Dependency[] = [];
    const seen = new Set<string>();

    const refs = this.extractExpressionDependencies(
      initializer,
      filePath, // Use filePath as context for resolving identifiers
      allEntityIds,
      variableMap,
      functionMap,
    );

    for (const refId of refs) {
      if (!seen.has(refId)) {
        seen.add(refId);
        dependencies.push({ fromId: varId, toId: refId });
      }
    }

    return dependencies;
  }

  /**
   * Extracts all entity references from an expression.
   * Handles identifiers, call expressions, property access, etc.
   */
  private extractExpressionDependencies(
    expr: Node,
    contextId: string,
    allEntityIds: Set<string>,
    variableMap: Map<string, VariableInfo>,
    functionMap: Map<string, FunctionInfo>,
    parametersMap?: Map<string, ParameterInfo>,
  ): string[] {
    const refs: string[] = [];

    // Get the file path from context
    const filePath = contextId.split("::")[0];

    // Handle call expressions: foo() → depends on foo<return>
    if (Node.isCallExpression(expr)) {
      const callee = expr.getExpression();
      const calleeFnId = this.resolveCalleeId(
        callee,
        filePath,
        allEntityIds,
        variableMap,
        functionMap,
      );
      if (calleeFnId) {
        // Depend on the function's <return> entity
        refs.push(`${calleeFnId}<return>`);
      }
      // Don't recurse into arguments - the dependency is on <return>, not the args
      return refs;
    }

    // Handle identifiers: x → depends on x
    if (Node.isIdentifier(expr)) {
      const name = expr.getText();
      // Check if it's a parameter (highest priority within function scope)
      if (parametersMap) {
        const paramInfo = parametersMap.get(name);
        if (paramInfo) {
          refs.push(paramInfo.id);
          return refs;
        }
      }
      // Check if it's a known variable
      const varInfo = variableMap.get(name);
      if (varInfo && allEntityIds.has(varInfo.id)) {
        refs.push(varInfo.id);
        return refs;
      }
      // Check if it's a known function (depends on its <return>)
      for (const [id, fn] of functionMap) {
        if (fn.name === name || id.endsWith(`::${name}`)) {
          // For function references without call, we reference the function itself
          refs.push(id);
          return refs;
        }
      }
      // Check by full ID
      const fullId = `${filePath}::${name}`;
      if (allEntityIds.has(fullId)) {
        refs.push(fullId);
      }
      return refs;
    }

    // Handle property access: obj.prop
    if (Node.isPropertyAccessExpression(expr)) {
      const path = this.getPropertyAccessPath(expr);
      if (path) {
        const fullId = `${filePath}::${path}`;
        if (allEntityIds.has(fullId)) {
          refs.push(fullId);
          return refs;
        }
      }
      // Recurse into the object
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getExpression(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      return refs;
    }

    // Handle binary expressions: a + b
    if (Node.isBinaryExpression(expr)) {
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getLeft(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getRight(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      return refs;
    }

    // Handle array literals: [a, b, c]
    if (Node.isArrayLiteralExpression(expr)) {
      for (const element of expr.getElements()) {
        refs.push(
          ...this.extractExpressionDependencies(
            element,
            contextId,
            allEntityIds,
            variableMap,
            functionMap,
            parametersMap,
          ),
        );
      }
      return refs;
    }

    // Handle object literals: { x: a, y: b }
    if (Node.isObjectLiteralExpression(expr)) {
      for (const prop of expr.getProperties()) {
        if (Node.isPropertyAssignment(prop)) {
          const init = prop.getInitializer();
          if (init) {
            refs.push(
              ...this.extractExpressionDependencies(
                init,
                contextId,
                allEntityIds,
                variableMap,
                functionMap,
                parametersMap,
              ),
            );
          }
        } else if (Node.isShorthandPropertyAssignment(prop)) {
          const name = prop.getName();
          // Check if it's a parameter first
          if (parametersMap) {
            const paramInfo = parametersMap.get(name);
            if (paramInfo) {
              refs.push(paramInfo.id);
              continue;
            }
          }
          const varInfo = variableMap.get(name);
          if (varInfo && allEntityIds.has(varInfo.id)) {
            refs.push(varInfo.id);
          }
        }
      }
      return refs;
    }

    // Handle template literals: `${a} and ${b}`
    if (Node.isTemplateExpression(expr)) {
      for (const span of expr.getTemplateSpans()) {
        refs.push(
          ...this.extractExpressionDependencies(
            span.getExpression(),
            contextId,
            allEntityIds,
            variableMap,
            functionMap,
            parametersMap,
          ),
        );
      }
      return refs;
    }

    // Handle conditional: a ? b : c
    if (Node.isConditionalExpression(expr)) {
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getCondition(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getWhenTrue(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getWhenFalse(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      return refs;
    }

    // Handle parenthesized: (a + b)
    if (Node.isParenthesizedExpression(expr)) {
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getExpression(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      return refs;
    }

    // Handle prefix/postfix: !a, a++
    if (Node.isPrefixUnaryExpression(expr)) {
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getOperand(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      return refs;
    }
    if (Node.isPostfixUnaryExpression(expr)) {
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getOperand(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      return refs;
    }

    // Handle spread: ...arr
    if (Node.isSpreadElement(expr)) {
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getExpression(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      return refs;
    }

    // Handle await: await promise
    if (Node.isAwaitExpression(expr)) {
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getExpression(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      return refs;
    }

    // Handle element access: arr[0]
    if (Node.isElementAccessExpression(expr)) {
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getExpression(),
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      refs.push(
        ...this.extractExpressionDependencies(
          expr.getArgumentExpression()!,
          contextId,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
        ),
      );
      return refs;
    }

    return refs;
  }

  /**
   * Resolves a callee expression to a function ID.
   */
  private resolveCalleeId(
    callee: Node,
    filePath: string,
    allEntityIds: Set<string>,
    variableMap: Map<string, VariableInfo>,
    functionMap: Map<string, FunctionInfo>,
  ): string | null {
    // Simple identifier: foo()
    if (Node.isIdentifier(callee)) {
      const name = callee.getText();
      // Check functions
      for (const [id, fn] of functionMap) {
        if (fn.name === name || id.endsWith(`::${name}`)) {
          return id;
        }
      }
      // Check variables (might be aliased function)
      const varInfo = variableMap.get(name);
      if (varInfo) {
        return varInfo.id;
      }
    }

    // Property access: obj.method()
    if (Node.isPropertyAccessExpression(callee)) {
      const path = this.getPropertyAccessPath(callee);
      if (path) {
        const fullId = `${filePath}::${path}`;
        if (allEntityIds.has(fullId)) {
          return fullId;
        }
        // Check for methods in function map
        for (const [id] of functionMap) {
          if (id.endsWith(`::${path}`)) {
            return id;
          }
        }
      }
    }

    return null;
  }

  // ==================== Call Argument Extraction ====================

  /**
   * Extracts call arguments from an expression tree.
   * Recursively finds call expressions and extracts their arguments.
   */
  private extractCallArguments(
    expr: Node,
    callerId: string,
    filePath: string,
    allEntityIds: Set<string>,
    variableMap: Map<string, VariableInfo>,
    functionMap: Map<string, FunctionInfo>,
    commitSha: string,
    parametersMap?: Map<string, ParameterInfo>,
  ): CallArgument[] {
    const callArguments: CallArgument[] = [];

    // Handle call expressions directly
    if (Node.isCallExpression(expr)) {
      const args = this.extractCallArgumentsFromCall(
        expr,
        callerId,
        filePath,
        allEntityIds,
        variableMap,
        functionMap,
        parametersMap,
        commitSha,
      );
      callArguments.push(...args);
      return callArguments;
    }

    // Recurse into child expressions
    for (const child of expr.getChildren()) {
      if (Node.isCallExpression(child)) {
        const args = this.extractCallArgumentsFromCall(
          child,
          callerId,
          filePath,
          allEntityIds,
          variableMap,
          functionMap,
          parametersMap,
          commitSha,
        );
        callArguments.push(...args);
      } else if (
        !Node.isArrowFunction(child) &&
        !Node.isFunctionExpression(child)
      ) {
        // Recurse but skip nested function definitions
        callArguments.push(
          ...this.extractCallArguments(
            child,
            callerId,
            filePath,
            allEntityIds,
            variableMap,
            functionMap,
            commitSha,
            parametersMap,
          ),
        );
      }
    }

    return callArguments;
  }

  /**
   * Extracts call arguments from a single call expression.
   * Returns CallArgument records for each argument that resolves to an entity.
   */
  private extractCallArgumentsFromCall(
    callExpr: CallExpression,
    callerId: string,
    filePath: string,
    allEntityIds: Set<string>,
    variableMap: Map<string, VariableInfo>,
    functionMap: Map<string, FunctionInfo>,
    parametersMap: Map<string, ParameterInfo> | undefined,
    commitSha: string,
  ): CallArgument[] {
    const callArguments: CallArgument[] = [];

    // Resolve the callee
    const callee = callExpr.getExpression();
    const calleeId = this.resolveCalleeId(
      callee,
      filePath,
      allEntityIds,
      variableMap,
      functionMap,
    );
    if (!calleeId) return callArguments;

    // Process each argument
    const args = callExpr.getArguments();
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      // Resolve the argument to an entity ID
      const argEntityId = this.resolveArgumentToEntity(
        arg,
        filePath,
        allEntityIds,
        variableMap,
        functionMap,
        parametersMap,
      );

      if (argEntityId) {
        callArguments.push({
          caller_id: callerId,
          callee_id: calleeId,
          param_index: i,
          arg_entity_id: argEntityId,
          commit_sha: commitSha,
        });
      }
    }

    return callArguments;
  }

  /**
   * Resolves an argument expression to an entity ID.
   * Returns null if the argument doesn't resolve to a single entity.
   */
  private resolveArgumentToEntity(
    arg: Node,
    filePath: string,
    allEntityIds: Set<string>,
    variableMap: Map<string, VariableInfo>,
    functionMap: Map<string, FunctionInfo>,
    parametersMap?: Map<string, ParameterInfo>,
  ): string | null {
    // Simple identifier: foo(x) → x
    if (Node.isIdentifier(arg)) {
      const name = arg.getText();

      // Check parameters first (highest priority in function scope)
      if (parametersMap) {
        const paramInfo = parametersMap.get(name);
        if (paramInfo) {
          return paramInfo.id;
        }
      }

      // Check variables
      const varInfo = variableMap.get(name);
      if (varInfo && allEntityIds.has(varInfo.id)) {
        return varInfo.id;
      }

      // Check functions
      for (const [id, fn] of functionMap) {
        if (fn.name === name || id.endsWith(`::${name}`)) {
          return id;
        }
      }

      // Check by full ID
      const fullId = `${filePath}::${name}`;
      if (allEntityIds.has(fullId)) {
        return fullId;
      }
    }

    // Property access: foo(obj.prop)
    if (Node.isPropertyAccessExpression(arg)) {
      const path = this.getPropertyAccessPath(arg);
      if (path) {
        const fullId = `${filePath}::${path}`;
        if (allEntityIds.has(fullId)) {
          return fullId;
        }
      }
    }

    // Call expression: foo(bar()) → bar<return>
    if (Node.isCallExpression(arg)) {
      const callee = arg.getExpression();
      const calleeId = this.resolveCalleeId(
        callee,
        filePath,
        allEntityIds,
        variableMap,
        functionMap,
      );
      if (calleeId) {
        return `${calleeId}<return>`;
      }
    }

    // For complex expressions (binary, ternary, etc.), return null
    // These would require creating synthetic entities which we're avoiding
    return null;
  }
}
