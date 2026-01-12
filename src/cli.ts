#!/usr/bin/env node
import { Command } from "commander";
import { execSync } from "child_process";
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
        console.log("  /mycelium-sync     - Analyze codebase");
        console.log("  /mycelium-describe - Generate descriptions");
        console.log("  /mycelium-explore  - Query the graph");
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

    for (const entity of result.entities) {
      store.insertEntity(entity);
    }

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
  .command("query")
  .description("Query the graph")
  .argument("<type>", "Query type: calls | callers | entry-points | entities")
  .argument("[target]", "Target entity ID")
  .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
  .option("--at <commit>", "Query at specific commit")
  .action((type, target, options) => {
    const store = new GraphStore(resolve(options.db));
    const commitSha = options.at;

    switch (type) {
      case "entities": {
        const entities = store.getEntities(commitSha);
        console.log(`\nEntities (${entities.length}):\n`);
        for (const e of entities) {
          console.log(`  ${e.id}`);
          console.log(`    ${e.signature}`);
          console.log();
        }
        break;
      }

      case "calls": {
        if (!target) {
          console.error("Target entity ID required for 'calls' query");
          process.exit(1);
        }
        const callees = store.getCallees(target, commitSha);
        console.log(`\n${target} calls:\n`);
        for (const e of callees) {
          console.log(`  → ${e.id}`);
        }
        break;
      }

      case "callers": {
        if (!target) {
          console.error("Target entity ID required for 'callers' query");
          process.exit(1);
        }
        const callers = store.getCallers(target, commitSha);
        console.log(`\n${target} is called by:\n`);
        for (const e of callers) {
          console.log(`  ← ${e.id}`);
        }
        break;
      }

      case "entry-points": {
        const commits = commitSha ? [commitSha] : store.getCommits();
        const latestCommit = commits[0];
        if (!latestCommit) {
          console.log("No data in database. Run 'mycelium sync' first.");
          break;
        }
        const entryPointIds = store.findEntryPoints(latestCommit);
        console.log(`\nEntry points (${entryPointIds.length}):\n`);
        for (const id of entryPointIds) {
          const entity = store.getEntityById(id, latestCommit);
          console.log(`  ${id}`);
          if (entity) {
            console.log(`    ${entity.signature}`);
          }
          console.log();
        }
        break;
      }

      default:
        console.error(`Unknown query type: ${type}`);
        console.error("Available: entities, calls, callers, entry-points");
        process.exit(1);
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
      // Set description
      store.setDescription(entityId, description);
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
  .option("--missing", "Show entities without descriptions")
  .action((options) => {
    const store = new GraphStore(resolve(options.db));
    const entities = store.getEntities();
    const descriptions = store.getAllDescriptions();
    const descMap = new Map(descriptions.map((d) => [d.entity_id, d]));

    if (options.missing) {
      const missing = entities.filter((e) => !descMap.has(e.id));
      console.log(`\nEntities without descriptions (${missing.length}):\n`);
      for (const e of missing) {
        console.log(`  ${e.id}`);
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

program.parse();
