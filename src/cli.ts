#!/usr/bin/env node
import { Command } from "commander";
import { execSync, spawn } from "child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync, cpSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { GraphStore } from "./db.js";
import { TypeScriptAnalyzer } from "./analyzer.js";

const DEFAULT_DB_PATH = ".mycelium/graph.db";
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Gets the current git HEAD commit SHA. Falls back to a timestamp-based ID if not in a git repository.
 */
function getGitCommitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return `manual-${Date.now()}`;
  }
}

/**
 * Searches for tsconfig.json or tsconfig.build.json in the current directory. Returns undefined if none found.
 */
function findTsConfig(): string | undefined {
  const candidates = ["tsconfig.json", "tsconfig.build.json"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const program = new Command();

program
  .name("mycelium")
  .description("Semantic code graph for TypeScript codebases")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize mycelium in a TypeScript project")
  .option("--ai <provider>", "Set up AI integration (claude)")
  .action((options) => {
    // Create .mycelium directory
    if (!existsSync(".mycelium")) {
      mkdirSync(".mycelium", { recursive: true });
      console.log("Created .mycelium/");
    }

    // Add to .gitignore if not already there
    const gitignorePath = ".gitignore";
    const gitignoreEntries = [".mycelium/"];

    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      const toAdd = gitignoreEntries.filter((e) => !content.includes(e));
      if (toAdd.length) {
        writeFileSync(gitignorePath, content + "\n" + toAdd.join("\n") + "\n");
        console.log("Updated .gitignore");
      }
    } else {
      writeFileSync(gitignorePath, gitignoreEntries.join("\n") + "\n");
      console.log("Created .gitignore");
    }

    // Set up AI integration
    if (options.ai) {
      const provider = options.ai.toLowerCase();

      if (provider === "claude") {
        const commandsDir = ".claude/commands";
        if (!existsSync(commandsDir)) {
          mkdirSync(commandsDir, { recursive: true });
        }

        // Copy command templates
        const templatesDir = join(__dirname, "..", "templates", "claude");
        const templates = [
          "mycelium-sync.md",
          "mycelium-describe.md",
          "mycelium-explore.md",
          "mycelium-community.md",
        ];

        for (const template of templates) {
          const src = join(templatesDir, template);
          const dest = join(commandsDir, template);

          if (existsSync(src)) {
            cpSync(src, dest);
            console.log(`Created ${dest}`);
          } else {
            // Fallback: create inline if templates not found
            console.log(`Template not found: ${src}, creating inline...`);
            createInlineTemplate(dest, template);
          }
        }

        console.log("\nClaude integration set up!");
        console.log("Commands available:");
        console.log("  /mycelium-sync      - Analyze codebase");
        console.log("  /mycelium-describe  - Generate descriptions");
        console.log("  /mycelium-explore   - Query the graph");
        console.log("  /mycelium-community - Name code communities");
      } else {
        console.error(`Unknown AI provider: ${provider}`);
        console.error("Supported: claude");
        process.exit(1);
      }
    }

    console.log("\nRun 'mycelium sync' to analyze your codebase.");
  });

/**
 * Fallback template creator when packaged template files are not found. Writes minimal Claude command templates inline.
 */
function createInlineTemplate(dest: string, name: string): void {
  const templates: Record<string, string> = {
    "mycelium-sync.md": `---
description: Analyze TypeScript codebase and update the mycelium graph
allowed-tools: Bash(mycelium:*, git:*)
---

# Mycelium Sync

\`\`\`bash
mycelium sync
mycelium query entities
mycelium query entry-points
mycelium descriptions --missing
\`\`\`
`,
    "mycelium-describe.md": `---
description: Generate descriptions for TypeScript entities
allowed-tools: Bash(mycelium:*), Read
argument-hint: [entity-id or "missing"]
---

# Mycelium Describe

\`\`\`bash
# Get entities needing descriptions
mycelium descriptions --missing

# View entity
mycelium describe "src/module.ts::functionName"

# Set description
mycelium describe "src/module.ts::functionName" "Description here"
\`\`\`
`,
    "mycelium-explore.md": `---
description: Explore the mycelium graph
allowed-tools: Bash(mycelium:*)
argument-hint: <query> [target]
---

# Mycelium Explore

\`\`\`bash
mycelium query entities
mycelium query entry-points
mycelium query calls "<id>"
mycelium query callers "<id>"
mycelium history
mycelium diff <from> <to>
\`\`\`
`,
    "mycelium-community.md": `---
description: Name and manage code communities detected by mycelium
allowed-tools: Bash(mycelium:*)
argument-hint: [name | list | detect]
---

# Mycelium Community

\`\`\`bash
# List unnamed communities with members
mycelium community list --unnamed --members

# Rename a community
mycelium community rename <old-name> <new-name>

# Re-run detection (preserves user names)
mycelium community detect
\`\`\`
`,
  };

  writeFileSync(dest, templates[name] || "");
}

program
  .command("sync")
  .description("Analyze codebase and update the graph")
  .option("-p, --pattern <patterns...>", "Glob patterns for source files", ["src/**/*.ts"])
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("--tsconfig <path>", "Path to tsconfig.json")
  .action(async (options) => {
    const commitSha = getGitCommitSha();
    console.log(`Syncing at commit: ${commitSha.slice(0, 8)}`);

    const tsConfigPath = options.tsconfig ?? findTsConfig();
    const analyzer = new TypeScriptAnalyzer(tsConfigPath);

    console.log(`Adding source files: ${options.pattern.join(", ")}`);
    analyzer.addSourceFiles(options.pattern);

    console.log("Analyzing...");
    const result = analyzer.analyze(commitSha);

    console.log(`Found ${result.entities.length} functions`);
    console.log(`Found ${result.relations.length} call relations`);

    const store = new GraphStore(resolve(options.db));

    let inserted = 0;
    let skipped = 0;
    for (const entity of result.entities) {
      if (store.isEntityUnchanged(entity.id, entity.signature_hash, entity.impl_hash)) {
        skipped++;
      } else {
        store.insertEntity(entity);
        inserted++;
      }
    }
    console.log(`Entities: ${inserted} updated, ${skipped} unchanged`);

    for (const relation of result.relations) {
      store.insertRelation(relation);
    }

    // Detect entry points
    const entryPointIds = store.findEntryPoints(commitSha);
    console.log(`Found ${entryPointIds.length} entry points (call graph roots)`);

    for (const entityId of entryPointIds) {
      store.insertEntryPoint({
        entity_id: entityId,
        description: null,
        commit_sha: commitSha,
      });
    }

    store.close();
    console.log("Done!");
  });

program
  .command("find")
  .description("Search for entities by name or description")
  .argument("<pattern>", "Search pattern (partial match)")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("--desc", "Search in descriptions instead of names")
  .action((pattern, options) => {
    const store = new GraphStore(resolve(options.db));
    const entities = store.getEntities();
    const descriptions = store.getAllDescriptions();
    const descMap = new Map(descriptions.map((d) => [d.entity_id, d.content]));

    const lower = pattern.toLowerCase();
    const matches = options.desc
      ? entities.filter((e) => descMap.get(e.id)?.toLowerCase().includes(lower))
      : entities.filter(
          (e) =>
            e.name.toLowerCase().includes(lower) ||
            e.id.toLowerCase().includes(lower)
        );

    if (matches.length === 0) {
      console.log(`No entities found matching "${pattern}"`);
    } else {
      console.log(`\nFound ${matches.length} entities:\n`);
      for (const e of matches) {
        console.log(`  ${e.id}`);
        console.log(`    ${e.file_path}:${e.start_line}-${e.end_line}`);
        const desc = descMap.get(e.id);
        if (desc) {
          console.log(`    ${desc.slice(0, 60)}${desc.length > 60 ? "..." : ""}`);
        }
        console.log();
      }
    }

    store.close();
  });

program
  .command("query")
  .description("Query an entity by exact ID")
  .argument("<id>", "Entity ID (use 'find' to search)")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("--calls", "Show what the entity calls")
  .option("--callers", "Show what calls the entity")
  .option("--reads", "Show what variables the function reads")
  .option("--writes", "Show what variables the function writes")
  .option("--readers", "Show what functions read this variable")
  .option("--writers", "Show what functions write to this variable")
  .option("--side-effects", "Show all side-effects (reads + writes)")
  .option("--trace <to>", "Find call path to another entity")
  .option("--source", "Show source code of the entity")
  .action((id, options) => {
    const store = new GraphStore(resolve(options.db));
    const entities = store.getEntities();
    const descriptions = store.getAllDescriptions();
    const descMap = new Map(descriptions.map((d) => [d.entity_id, d.content]));

    const entity = entities.find((e) => e.id === id);
    if (!entity) {
      console.error(`Entity not found: ${id}`);
      console.error(`Use 'mycelium find <pattern>' to search for entities`);
      store.close();
      process.exit(1);
    }

    // --calls: show what entity calls
    if (options.calls) {
      const callees = store.getCallees(entity.id);
      console.log(`\n${entity.id} calls:\n`);
      for (const e of callees) {
        console.log(`  → ${e.id}`);
        console.log(`    ${e.file_path}:${e.start_line}`);
      }
      if (callees.length === 0) console.log("  (nothing)");
      store.close();
      return;
    }

    // --callers: show what calls entity
    if (options.callers) {
      const callers = store.getCallers(entity.id);
      console.log(`\n${entity.id} is called by:\n`);
      for (const e of callers) {
        console.log(`  ← ${e.id}`);
        console.log(`    ${e.file_path}:${e.start_line}`);
      }
      if (callers.length === 0) console.log("  (nothing)");
      store.close();
      return;
    }

    // --reads: show what variables the function reads
    if (options.reads) {
      const reads = store.getReads(entity.id);
      console.log(`\n${entity.id} reads:\n`);
      for (const e of reads) {
        console.log(`  ⟵ ${e.id}`);
        console.log(`    ${e.file_path}:${e.start_line}`);
      }
      if (reads.length === 0) console.log("  (no external variables read)");
      store.close();
      return;
    }

    // --writes: show what variables the function writes
    if (options.writes) {
      const writes = store.getWrites(entity.id);
      console.log(`\n${entity.id} writes:\n`);
      for (const e of writes) {
        console.log(`  ⟶ ${e.id}`);
        console.log(`    ${e.file_path}:${e.start_line}`);
      }
      if (writes.length === 0) console.log("  (no external variables written)");
      store.close();
      return;
    }

    // --readers: show what functions read this variable
    if (options.readers) {
      const readers = store.getReaders(entity.id);
      console.log(`\n${entity.id} is read by:\n`);
      for (const e of readers) {
        console.log(`  ⟵ ${e.id}`);
        console.log(`    ${e.file_path}:${e.start_line}`);
      }
      if (readers.length === 0) console.log("  (no functions read this)");
      store.close();
      return;
    }

    // --writers: show what functions write to this variable
    if (options.writers) {
      const writers = store.getWriters(entity.id);
      console.log(`\n${entity.id} is written by:\n`);
      for (const e of writers) {
        console.log(`  ⟶ ${e.id}`);
        console.log(`    ${e.file_path}:${e.start_line}`);
      }
      if (writers.length === 0) console.log("  (no functions write to this)");
      store.close();
      return;
    }

    // --side-effects: show all reads and writes
    if (options.sideEffects) {
      const reads = store.getReads(entity.id);
      const writes = store.getWrites(entity.id);
      console.log(`\n${entity.id} side-effects:\n`);

      if (reads.length > 0) {
        console.log("Reads:");
        for (const e of reads) {
          console.log(`  ⟵ ${e.name} (${e.file_path}:${e.start_line})`);
        }
      }

      if (writes.length > 0) {
        console.log("Writes:");
        for (const e of writes) {
          console.log(`  ⟶ ${e.name} (${e.file_path}:${e.start_line})`);
        }
      }

      if (reads.length === 0 && writes.length === 0) {
        console.log("  (pure function - no side effects)");
      }

      store.close();
      return;
    }

    // --trace: find path to another entity
    if (options.trace) {
      const toEntity = entities.find((e) => e.id === options.trace);
      if (!toEntity) {
        console.error(`Target entity not found: ${options.trace}`);
        store.close();
        process.exit(1);
      }

      // BFS to find path
      const visited = new Set<string>();
      const queue: { id: string; path: string[] }[] = [{ id: entity.id, path: [entity.id] }];
      let found: string[] | null = null;

      while (queue.length > 0 && !found) {
        const { id: currentId, path } = queue.shift()!;
        if (currentId === toEntity.id) {
          found = path;
          break;
        }
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const callees = store.getCallees(currentId);
        for (const callee of callees) {
          if (!visited.has(callee.id)) {
            queue.push({ id: callee.id, path: [...path, callee.id] });
          }
        }
      }

      if (found) {
        console.log(`\nPath from ${entity.name} to ${toEntity.name}:\n`);
        for (let i = 0; i < found.length; i++) {
          const prefix = i === 0 ? "  " : "  → ";
          console.log(`${prefix}${found[i]}`);
        }
      } else {
        console.log(`\nNo path found from ${entity.id} to ${toEntity.id}`);
      }
      store.close();
      return;
    }

    // --source: show source code
    if (options.source) {
      const filePath = resolve(entity.file_path);

      if (!existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        store.close();
        process.exit(1);
      }

      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const startLine = entity.start_line - 1; // 0-indexed
      const endLine = entity.end_line;
      const sourceLines = lines.slice(startLine, endLine);

      console.log(`\n${entity.name}`);
      console.log(`${"─".repeat(60)}`);
      console.log(`File: ${entity.file_path}:${entity.start_line}-${entity.end_line}\n`);

      // Print with line numbers
      for (let i = 0; i < sourceLines.length; i++) {
        const lineNum = (startLine + i + 1).toString().padStart(4, " ");
        console.log(`${lineNum} │ ${sourceLines[i]}`);
      }

      store.close();
      return;
    }

    // No flags: show context
    const desc = descMap.get(entity.id);
    const callers = store.getCallers(entity.id);
    const callees = store.getCallees(entity.id);

    console.log(`\n${entity.name}`);
    console.log(`${"─".repeat(40)}`);
    console.log(`ID:        ${entity.id}`);
    console.log(`Kind:      ${entity.kind}`);
    console.log(`Location:  ${entity.file_path}:${entity.start_line}-${entity.end_line}`);
    console.log(`Signature: ${entity.signature}`);

    // Show system membership
    const systems = store.getEntitySystems(entity.id);
    if (systems.length > 0) {
      const systemStr = systems
        .map((s) => {
          const conf = s.confidence !== null ? ` (${(s.confidence * 100).toFixed(0)}%)` : "";
          return `${s.system.name}${conf}`;
        })
        .join(", ");
      console.log(`Systems:   ${systemStr}`);
    }

    if (desc) {
      console.log(`\nDescription:\n  ${desc}`);
    }
    if (callers.length > 0) {
      console.log(`\nCalled by (${callers.length}):`);
      for (const e of callers) {
        console.log(`  ← ${e.name} (${e.file_path}:${e.start_line})`);
      }
    }
    if (callees.length > 0) {
      console.log(`\nCalls (${callees.length}):`);
      for (const e of callees) {
        console.log(`  → ${e.name} (${e.file_path}:${e.start_line})`);
      }
    }

    // Show side-effects for functions
    if (entity.kind === "function") {
      const reads = store.getReads(entity.id);
      const writes = store.getWrites(entity.id);
      if (reads.length > 0) {
        console.log(`\nReads (${reads.length}):`);
        for (const e of reads) {
          console.log(`  ⟵ ${e.name} (${e.file_path}:${e.start_line})`);
        }
      }
      if (writes.length > 0) {
        console.log(`\nWrites (${writes.length}):`);
        for (const e of writes) {
          console.log(`  ⟶ ${e.name} (${e.file_path}:${e.start_line})`);
        }
      }
    }

    // Show readers/writers for variables
    if (entity.kind === "variable") {
      const readers = store.getReaders(entity.id);
      const writers = store.getWriters(entity.id);
      if (readers.length > 0) {
        console.log(`\nRead by (${readers.length}):`);
        for (const e of readers) {
          console.log(`  ⟵ ${e.name} (${e.file_path}:${e.start_line})`);
        }
      }
      if (writers.length > 0) {
        console.log(`\nWritten by (${writers.length}):`);
        for (const e of writers) {
          console.log(`  ⟶ ${e.name} (${e.file_path}:${e.start_line})`);
        }
      }
    }

    store.close();
  });

program
  .command("history")
  .description("Show commits in the database")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .action((options) => {
    const store = new GraphStore(resolve(options.db));
    const commits = store.getCommits();

    console.log(`\nCommits (${commits.length}):\n`);
    for (const commit of commits) {
      console.log(`  ${commit}`);
    }

    store.close();
  });

program
  .command("diff")
  .description("Show what changed between commits")
  .argument("<from>", "From commit SHA")
  .argument("<to>", "To commit SHA")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .action((from, to, options) => {
    const store = new GraphStore(resolve(options.db));

    const entitiesFrom = store.getEntities(from);
    const entitiesTo = store.getEntities(to);

    const fromMap = new Map(entitiesFrom.map((e) => [e.id, e]));
    const toMap = new Map(entitiesTo.map((e) => [e.id, e]));

    const added: string[] = [];
    const removed: string[] = [];
    const signatureChanged: string[] = [];
    const implChanged: string[] = [];

    for (const [id, entity] of toMap) {
      const prev = fromMap.get(id);
      if (!prev) {
        added.push(id);
      } else if (prev.signature_hash !== entity.signature_hash) {
        signatureChanged.push(id);
      } else if (prev.impl_hash !== entity.impl_hash) {
        implChanged.push(id);
      }
    }

    for (const id of fromMap.keys()) {
      if (!toMap.has(id)) {
        removed.push(id);
      }
    }

    console.log(`\nChanges from ${from.slice(0, 8)} to ${to.slice(0, 8)}:\n`);

    if (added.length) {
      console.log(`Added (${added.length}):`);
      added.forEach((id) => console.log(`  + ${id}`));
      console.log();
    }

    if (removed.length) {
      console.log(`Removed (${removed.length}):`);
      removed.forEach((id) => console.log(`  - ${id}`));
      console.log();
    }

    if (signatureChanged.length) {
      console.log(`Signature changed (${signatureChanged.length}):`);
      signatureChanged.forEach((id) => console.log(`  ~ ${id}`));
      console.log();
    }

    if (implChanged.length) {
      console.log(`Implementation changed (${implChanged.length}):`);
      implChanged.forEach((id) => console.log(`  * ${id}`));
      console.log();
    }

    if (!added.length && !removed.length && !signatureChanged.length && !implChanged.length) {
      console.log("No changes.");
    }

    store.close();
  });

program
  .command("describe")
  .description("Get or set description for an entity")
  .argument("<entity-id>", "Entity ID (e.g., src/db.ts::GraphStore.getEntities)")
  .argument("[description]", "Description text (omit to show current)")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("--stdin", "Read description from stdin")
  .action(async (entityId, description, options) => {
    const store = new GraphStore(resolve(options.db));

    // Verify entity exists
    const entity = store.getEntityById(entityId);
    if (!entity) {
      console.error(`Entity not found: ${entityId}`);
      console.error("Run 'mycelium query entities' to see available entities.");
      store.close();
      process.exit(1);
    }

    if (options.stdin) {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      description = Buffer.concat(chunks).toString("utf-8").trim();
    }

    if (description) {
      // Set description with current impl_hash
      store.setDescription(entityId, description, entity.impl_hash);
      console.log(`Description set for: ${entityId}`);
    } else {
      // Show current description
      const desc = store.getDescription(entityId);
      console.log(`\n${entityId}`);
      console.log(`  Signature: ${entity.signature}`);
      console.log(`  File: ${entity.file_path}:${entity.start_line}`);
      if (desc) {
        console.log(`\n  Description:`);
        console.log(`    ${desc.content}`);
        console.log(`\n  Updated: ${desc.updated_at}`);
      } else {
        console.log(`\n  No description set.`);
      }
    }

    store.close();
  });

program
  .command("descriptions")
  .description("List all entities with descriptions")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("--missing", "Show entities needing descriptions (missing or stale)")
  .action((options) => {
    const store = new GraphStore(resolve(options.db));
    const descriptions = store.getAllDescriptions();

    if (options.missing) {
      const needing = store.getEntitiesNeedingDescriptions();
      const descMap = new Map(descriptions.map((d) => [d.entity_id, d]));
      console.log(`\nEntities needing descriptions (${needing.length}):\n`);
      for (const e of needing) {
        const existing = descMap.get(e.id);
        const status = existing ? "(stale)" : "(missing)";
        console.log(`  ${e.id} ${status}`);
        console.log(`    ${e.signature}`);
        console.log();
      }
    } else {
      console.log(`\nDescriptions (${descriptions.length}):\n`);
      for (const desc of descriptions) {
        const entity = store.getEntityById(desc.entity_id);
        console.log(`  ${desc.entity_id}`);
        if (entity) {
          console.log(`    Signature: ${entity.signature}`);
        }
        console.log(`    ${desc.content}`);
        console.log();
      }
    }

    store.close();
  });

program
  .command("jsdoc")
  .description("Check or update JSDoc comments from descriptions")
  .argument("<mode>", "Mode: check | sync")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("-p, --pattern <patterns...>", "Glob patterns for source files", ["src/**/*.ts"])
  .action((mode, options) => {
    if (mode !== "check" && mode !== "sync") {
      console.error("Mode must be 'check' or 'sync'");
      process.exit(1);
    }

    const store = new GraphStore(resolve(options.db));
    const entities = store.getEntities();
    const descriptions = store.getAllDescriptions();
    const descMap = new Map(descriptions.map((d) => [d.entity_id, d]));

    // Group entities by file
    const fileEntities = new Map<string, typeof entities>();
    for (const entity of entities) {
      const desc = descMap.get(entity.id);
      if (!desc) continue;

      const list = fileEntities.get(entity.file_path) || [];
      list.push(entity);
      fileEntities.set(entity.file_path, list);
    }

    let totalChanges = 0;

    for (const [filePath, fileEnts] of fileEntities) {
      const fullPath = resolve(filePath);
      if (!existsSync(fullPath)) {
        console.warn(`File not found: ${filePath}`);
        continue;
      }

      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      // Sort by line number descending so edits don't shift line numbers
      const sorted = [...fileEnts].sort((a, b) => b.start_line - a.start_line);

      let modified = false;

      for (const entity of sorted) {
        const desc = descMap.get(entity.id);
        if (!desc) continue;

        const lineIdx = entity.start_line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) continue;

        // Check for existing JSDoc comment above the function
        let jsdocStart = -1;
        let jsdocEnd = -1;
        let existingJsdoc = "";

        for (let i = lineIdx - 1; i >= 0; i--) {
          const trimmed = lines[i].trim();
          if (trimmed === "") continue;
          if (trimmed.endsWith("*/")) {
            jsdocEnd = i;
          }
          if (trimmed.startsWith("/**")) {
            jsdocStart = i;
            break;
          }
          if (jsdocEnd === -1 && !trimmed.startsWith("*") && !trimmed.startsWith("//")) {
            break;
          }
        }

        if (jsdocStart !== -1 && jsdocEnd !== -1) {
          existingJsdoc = lines
            .slice(jsdocStart, jsdocEnd + 1)
            .join("\n");
        }

        // Extract description text from existing JSDoc
        const existingDesc = existingJsdoc
          .replace(/\/\*\*|\*\/|\s*\*\s*/g, " ")
          .replace(/@\w+[^@]*/g, "")
          .trim();

        const newDesc = desc.content.trim();

        if (existingDesc === newDesc) continue;

        // Get indentation from the function line
        const indent = lines[lineIdx].match(/^(\s*)/)?.[1] || "";

        // Format new JSDoc
        const newJsdoc = `${indent}/**\n${indent} * ${newDesc}\n${indent} */`;

        if (mode === "check") {
          console.log(`\n${entity.id} (${filePath}:${entity.start_line})`);
          if (existingJsdoc) {
            console.log("  Current:");
            console.log(`    ${existingDesc || "(empty)"}`);
          } else {
            console.log("  Current: (no JSDoc)");
          }
          console.log("  New:");
          console.log(`    ${newDesc}`);
          totalChanges++;
        } else {
          // Apply changes
          if (jsdocStart !== -1 && jsdocEnd !== -1) {
            // Replace existing JSDoc
            lines.splice(jsdocStart, jsdocEnd - jsdocStart + 1, newJsdoc);
          } else {
            // Insert new JSDoc before function
            lines.splice(lineIdx, 0, newJsdoc);
          }
          modified = true;
          totalChanges++;
          console.log(`Updated: ${entity.id}`);
        }
      }

      if (mode === "sync" && modified) {
        writeFileSync(fullPath, lines.join("\n"));
      }
    }

    if (mode === "check") {
      console.log(`\n${totalChanges} change(s) would be made.`);
      if (totalChanges > 0) {
        console.log("Run 'mycelium jsdoc sync' to apply.");
      }
    } else {
      console.log(`\n${totalChanges} JSDoc comment(s) updated.`);
    }

    store.close();
  });

program
  .command("export")
  .description("Export graph data as JSON for visualization")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("-o, --output <path>", "Output file path", "graph.json")
  .action((options) => {
    const store = new GraphStore(resolve(options.db));
    const entities = store.getEntities();
    const relations = store.getRelations();
    const descriptions = store.getAllDescriptions();
    const descMap = new Map(descriptions.map((d) => [d.entity_id, d]));

    // Deduplicate edges by source+target+kind
    const edgeMap = new Map<string, { source: string; target: string; kind: string }>();
    for (const r of relations) {
      const key = `${r.from_id}::${r.to_id}::${r.kind}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { source: r.from_id, target: r.to_id, kind: r.kind });
      }
    }

    const graphData = {
      nodes: entities.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        file_path: e.file_path,
        signature: e.signature,
        start_line: e.start_line,
        end_line: e.end_line,
        description: descMap.get(e.id)?.content,
      })),
      edges: Array.from(edgeMap.values()),
    };

    writeFileSync(resolve(options.output), JSON.stringify(graphData, null, 2));
    console.log(`Exported ${graphData.nodes.length} nodes and ${graphData.edges.length} edges to ${options.output}`);

    store.close();
  });

program
  .command("serve")
  .description("Start the web visualization client")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("-p, --port <port>", "Port for the dev server", "5173")
  .action((options) => {
    const clientDir = join(__dirname, "..", "client");

    if (!existsSync(clientDir)) {
      console.error("Client directory not found. Make sure the package is installed correctly.");
      process.exit(1);
    }

    // Export graph to client
    const store = new GraphStore(resolve(options.db));
    const entities = store.getEntities();
    const relations = store.getRelations();
    const descriptions = store.getAllDescriptions();
    const descMap = new Map(descriptions.map((d) => [d.entity_id, d]));

    const edgeMap = new Map<string, { source: string; target: string; kind: string }>();
    for (const r of relations) {
      const key = `${r.from_id}::${r.to_id}::${r.kind}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { source: r.from_id, target: r.to_id, kind: r.kind });
      }
    }

    const graphData = {
      nodes: entities.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        file_path: e.file_path,
        signature: e.signature,
        start_line: e.start_line,
        end_line: e.end_line,
        description: descMap.get(e.id)?.content,
      })),
      edges: Array.from(edgeMap.values()),
    };

    const graphPath = join(clientDir, "public", "graph.json");
    writeFileSync(graphPath, JSON.stringify(graphData, null, 2));
    console.log(`Exported ${graphData.nodes.length} nodes and ${graphData.edges.length} edges`);
    store.close();

    // Start vite dev server
    console.log(`\nStarting visualization at http://localhost:${options.port}/`);
    const vite = spawn("npx", ["vite", "--port", options.port], {
      cwd: clientDir,
      stdio: "inherit",
      shell: true,
    });

    vite.on("error", (err) => {
      console.error("Failed to start dev server:", err.message);
      process.exit(1);
    });
  });

// Community detection commands
const communityCmd = program
  .command("community")
  .description("Detect and manage code communities (systems)");

communityCmd
  .command("detect")
  .description("Run community detection algorithm on the call graph")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("-a, --algorithm <name>", "Algorithm to use (louvain)", "louvain")
  .option("-r, --resolution <number>", "Resolution parameter (higher = more communities)", "1")
  .action(async (options) => {
    const { getDetector, buildGraph } = await import("./community/index.js");

    const store = new GraphStore(resolve(options.db));
    const commitSha = getGitCommitSha();

    console.log(`Detecting communities using ${options.algorithm}...`);

    // Get entities and relations
    const entities = store.getEntities();
    const relations = store.getRelations();

    if (entities.length === 0) {
      console.error("No entities in database. Run 'mycelium sync' first.");
      store.close();
      process.exit(1);
    }

    // Build graph for community detection
    const graph = buildGraph(entities, relations, {
      edgeTypes: ["calls"],
      nodeKinds: ["function"],
    });

    console.log(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

    if (graph.nodes.length === 0) {
      console.error("No function nodes found.");
      store.close();
      process.exit(1);
    }

    // Run detection
    const detector = getDetector(options.algorithm as "louvain");
    const resolution = parseFloat(options.resolution);
    const communities = await detector.detect(graph, { resolution });

    // Group by community
    const communityGroups = new Map<number, string[]>();
    for (const [entityId, communityId] of communities) {
      const group = communityGroups.get(communityId) || [];
      group.push(entityId);
      communityGroups.set(communityId, group);
    }

    console.log(`Detected ${communityGroups.size} communities`);

    // Get user-named systems before clearing (for overlap matching)
    const userNamedSystems = store.getUserNamedSystemsWithMembers();

    // Calculate overlap between new communities and old user-named systems
    // overlap = intersection / union (Jaccard index)
    const OVERLAP_THRESHOLD = 0.7;
    const nameAssignments = new Map<number, { name: string; description: string | null; overlap: number }>();

    if (userNamedSystems.length > 0) {
      console.log(`\nMatching against ${userNamedSystems.length} user-named systems...`);

      // For each user-named system, find the best matching new community
      const claimedNames = new Set<string>();

      for (const { system: oldSystem, memberIds: oldMembers } of userNamedSystems) {
        const oldSet = new Set(oldMembers);
        let bestMatch: { communityId: number; overlap: number } | null = null;

        for (const [communityId, newMembers] of communityGroups) {
          // Skip if this community already claimed a name with higher overlap
          const existing = nameAssignments.get(communityId);
          if (existing && existing.overlap >= OVERLAP_THRESHOLD) continue;

          const newSet = new Set(newMembers);
          const intersection = [...oldSet].filter((x) => newSet.has(x)).length;
          const union = new Set([...oldSet, ...newSet]).size;
          const overlap = union > 0 ? intersection / union : 0;

          if (overlap >= OVERLAP_THRESHOLD) {
            if (!bestMatch || overlap > bestMatch.overlap) {
              bestMatch = { communityId, overlap };
            }
          }
        }

        if (bestMatch && !claimedNames.has(oldSystem.name)) {
          // Check if this community already has a better assignment
          const existing = nameAssignments.get(bestMatch.communityId);
          if (!existing || bestMatch.overlap > existing.overlap) {
            nameAssignments.set(bestMatch.communityId, {
              name: oldSystem.name,
              description: oldSystem.description,
              overlap: bestMatch.overlap,
            });
            claimedNames.add(oldSystem.name);
            console.log(`  "${oldSystem.name}" → community ${bestMatch.communityId} (${(bestMatch.overlap * 100).toFixed(0)}% overlap)`);
          }
        }
      }
    }

    // Clear existing and insert new
    store.clearSystems(commitSha);

    for (const [communityId, memberIds] of communityGroups) {
      const systemId = `community-${communityId}`;

      // Check if we have a name assignment from overlap matching
      const assignment = nameAssignments.get(communityId);
      let name: string;
      let nameSource: "auto" | "user";
      let description: string | null = null;

      if (assignment) {
        name = assignment.name;
        nameSource = "user";
        description = assignment.description;
      } else {
        // Auto-generate name from most common file path
        const fileCounts = new Map<string, number>();
        for (const memberId of memberIds) {
          const entity = entities.find((e) => e.id === memberId);
          if (entity) {
            const dir = entity.file_path.split("/").slice(0, -1).join("/") || entity.file_path;
            fileCounts.set(dir, (fileCounts.get(dir) || 0) + 1);
          }
        }
        const topDir = [...fileCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
        name = `${topDir.split("/").pop() || "system"}-${communityId}`;
        nameSource = "auto";
      }

      // Insert system
      store.insertSystem({
        id: systemId,
        name,
        name_source: nameSource,
        description,
        algorithm: options.algorithm,
        resolution,
        commit_sha: commitSha,
      });

      // Insert members
      for (const memberId of memberIds) {
        store.insertSystemMember({
          system_id: systemId,
          entity_id: memberId,
          confidence: null, // Louvain doesn't provide confidence scores
          commit_sha: commitSha,
        });
      }

      const preserved = assignment ? " (preserved)" : "";
      console.log(`  ${name}: ${memberIds.length} members${preserved}`);
    }

    store.close();
    console.log("\nDone! Use 'mycelium community list' to see results.");
  });

communityCmd
  .command("list")
  .description("List all detected communities")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("-u, --unnamed", "Only show auto-named communities (not user-renamed)")
  .option("-m, --members", "Show all members of each community")
  .option("--min-members <n>", "Minimum members to include (default: 2 for --unnamed, 1 otherwise)")
  .action((options) => {
    const store = new GraphStore(resolve(options.db));
    let systems = store.getSystems();
    const counts = store.getSystemMemberCounts();
    const countMap = new Map(counts.map((c) => [c.system_id, c.count]));

    // Filter to unnamed only if requested
    if (options.unnamed) {
      systems = systems.filter((s) => s.name_source === "auto");
    }

    // Filter by minimum members (default 2 for --unnamed, 1 otherwise)
    const minMembers = options.minMembers ? parseInt(options.minMembers) : (options.unnamed ? 2 : 1);
    systems = systems.filter((s) => (countMap.get(s.id) || 0) >= minMembers);

    if (systems.length === 0) {
      if (options.unnamed) {
        console.log("No unnamed communities. All communities have been named.");
      } else {
        console.log("No communities detected. Run 'mycelium community detect' first.");
      }
      store.close();
      return;
    }

    const label = options.unnamed ? "Unnamed communities" : "Communities";
    console.log(`\n${label} (${systems.length}):\n`);

    for (const system of systems) {
      const count = countMap.get(system.id) || 0;
      const desc = system.description ? ` - ${system.description}` : "";
      console.log(`${system.name} (${count} members)${desc}`);

      if (options.members) {
        // Show all members
        const members = store.getSystemMembers(system.id);
        for (const member of members) {
          console.log(`  ${member.entity.id}`);
        }
      } else {
        // Show entry points only (default behavior)
        const members = store.getSystemMembers(system.id);
        const memberIds = new Set(members.map((m) => m.entity_id));
        const entryPoints = members.filter((m) => {
          const callers = store.getCallers(m.entity_id);
          return !callers.some((c) => memberIds.has(c.id));
        });

        if (entryPoints.length > 0) {
          console.log(`  Entry points:`);
          for (const ep of entryPoints.slice(0, 3)) {
            console.log(`    → ${ep.entity.name} (${ep.entity.file_path}:${ep.entity.start_line})`);
          }
          if (entryPoints.length > 3) {
            console.log(`    ... and ${entryPoints.length - 3} more`);
          }
        }
      }
      console.log();
    }

    store.close();
  });

communityCmd
  .command("show")
  .description("Show all members of a community")
  .argument("<name>", "Community ID or name")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .action((name, options) => {
    const store = new GraphStore(resolve(options.db));
    const system = store.getSystemByIdOrName(name);

    if (!system) {
      console.error(`Community not found: ${name}`);
      console.error("Use 'mycelium community list' to see available communities.");
      store.close();
      process.exit(1);
    }

    const members = store.getSystemMembers(system.id);

    console.log(`\n${system.name} (${system.id})`);
    if (system.description) {
      console.log(`  ${system.description}`);
    }
    console.log(`  Algorithm: ${system.algorithm}, Resolution: ${system.resolution}`);
    console.log(`\nMembers (${members.length}):\n`);

    // Group by file
    const byFile = new Map<string, typeof members>();
    for (const member of members) {
      const file = member.entity.file_path;
      const list = byFile.get(file) || [];
      list.push(member);
      byFile.set(file, list);
    }

    for (const [file, fileMembers] of byFile) {
      console.log(`  ${file}:`);
      for (const m of fileMembers) {
        const conf = m.confidence !== null ? ` (${(m.confidence * 100).toFixed(0)}%)` : "";
        console.log(`    - ${m.entity.name}:${m.entity.start_line}${conf}`);
      }
    }

    store.close();
  });

communityCmd
  .command("rename")
  .description("Rename a community")
  .argument("<id>", "Community ID or current name")
  .argument("<name>", "New name")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .action((id, name, options) => {
    const store = new GraphStore(resolve(options.db));
    const success = store.renameSystem(id, name);

    if (success) {
      console.log(`Renamed "${id}" to "${name}"`);
    } else {
      console.error(`Community not found: ${id}`);
      process.exit(1);
    }

    store.close();
  });

communityCmd
  .command("describe")
  .description("Set description for a community")
  .argument("<id>", "Community ID or name")
  .argument("<description>", "Description text")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .action((id, description, options) => {
    const store = new GraphStore(resolve(options.db));
    const success = store.describeSystem(id, description);

    if (success) {
      console.log(`Description set for "${id}"`);
    } else {
      console.error(`Community not found: ${id}`);
      process.exit(1);
    }

    store.close();
  });

program.parse();
