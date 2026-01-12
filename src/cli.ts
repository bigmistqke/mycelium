#!/usr/bin/env node
import { Command } from "commander";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { GraphStore } from "./db.js";
import { TypeScriptAnalyzer } from "./analyzer.js";

const DEFAULT_DB_PATH = ".mycelium/graph.db";

function getGitCommitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return `manual-${Date.now()}`;
  }
}

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

program.parse();
