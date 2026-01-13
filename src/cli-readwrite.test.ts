import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

describe("CLI read/write commands", () => {
  let tempDir: string;
  let dbPath: string;
  let fixturePath: string;
  let greetId: string;
  let addId: string;

  let tsconfigPath: string;

  beforeEach(() => {
    // Create temp directory
    tempDir = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    dbPath = join(tempDir, "test.db");
    fixturePath = join(tempDir, "test.ts");
    tsconfigPath = join(tempDir, "tsconfig.json");

    // Create minimal tsconfig to isolate from parent project
    writeFileSync(tsconfigPath, '{"compilerOptions":{}}');

    // Create a simple test file
    writeFileSync(
      fixturePath,
      `export function greet(name: string): string {
  return "Hello, " + name;
}

export function add(a: number, b: number): number {
  return a + b;
}
`
    );

    // Sync the test file
    execSync(`node dist/cli.js sync -p "${fixturePath}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`, {
      encoding: "utf-8",
    });

    // find outputs IDs one per line - get the first match (function, not params/return)
    greetId = execSync(`node dist/cli.js find greet -d "${dbPath}"`, {
      encoding: "utf-8",
    }).split('\n')[0];

    addId = execSync(`node dist/cli.js find add -d "${dbPath}"`, {
      encoding: "utf-8",
    }).split('\n')[0];
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("read command", () => {
    it("reads entity source code", () => {
      const output = execSync(
        `node dist/cli.js read "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      expect(output).toContain("id:");
      expect(output).toContain("name: greet");
      expect(output).toContain("kind: function");
      expect(output).toContain("---");
      expect(output).toContain('return "Hello, " + name');
    });

    it("includes correct line numbers", () => {
      const output = execSync(
        `node dist/cli.js read "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      expect(output).toContain("lines: 1-3");
    });

    it("auto-syncs when file is stale", () => {
      // Modify file directly
      const content = readFileSync(fixturePath, "utf-8");
      writeFileSync(
        fixturePath,
        content.replace('return "Hello, "', 'return "Hi, "')
      );

      // Read should auto-sync and return updated content
      const output = execSync(
        `node dist/cli.js read "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      expect(output).toContain('return "Hi, " + name');
    });

    it("fails with helpful message for non-existent entity", () => {
      try {
        execSync(`node dist/cli.js read "nonexistent" -d "${dbPath}" --tsconfig "${tsconfigPath}"`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.stderr.toString()).toContain("entity not found");
        expect(e.stderr.toString()).toContain("mycelium find");
      }
    });
  });

  describe("write command", () => {
    it("replaces entity source code", () => {
      const newSource = `export function greet(name: string): string {
  return "Howdy, " + name + "!";
}`;

      execSync(
        `echo '${newSource}' | node dist/cli.js write "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      // Verify file was updated
      const content = readFileSync(fixturePath, "utf-8");
      expect(content).toContain("Howdy,");
      expect(content).toContain("!");
    });

    it("preserves other entities in file", () => {
      const newSource = `export function greet(name: string): string {
  return "Yo, " + name;
}`;

      execSync(
        `echo '${newSource}' | node dist/cli.js write "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      // Verify add function is still there
      const content = readFileSync(fixturePath, "utf-8");
      expect(content).toContain("export function add");
      expect(content).toContain("return a + b");
    });

    it("updates line numbers after write", () => {
      // Add extra lines to greet
      const newSource = `export function greet(name: string): string {
  // Added comment line 1
  // Added comment line 2
  return "Hello, " + name;
}`;

      execSync(
        `echo '${newSource}' | node dist/cli.js write "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      // Read greet - should have more lines now
      const greetOutput = execSync(
        `node dist/cli.js read "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );
      expect(greetOutput).toContain("lines: 1-5");

      // Read add - should have shifted line numbers
      const addOutput = execSync(
        `node dist/cli.js read "${addId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );
      expect(addOutput).toContain("lines: 7-9");
    });

    it("returns confirmation with entity count", () => {
      const newSource = `export function greet(name: string): string {
  return "Hey, " + name;
}`;

      const output = execSync(
        `echo '${newSource}' | node dist/cli.js write "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      expect(output).toContain("wrote:");
      expect(output).toContain("synced:");
    });
  });

  describe("read then write roundtrip", () => {
    it("can read, modify, and write back", () => {
      // Read original
      const readOutput = execSync(
        `node dist/cli.js read "${addId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      // Extract source (after ---)
      const source = readOutput.split("---\n")[1].trim();
      expect(source).toContain("return a + b");

      // Modify and write back
      const modified = source.replace("a + b", "a * b");
      execSync(
        `echo '${modified}' | node dist/cli.js write "${addId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      // Read again to verify
      const verifyOutput = execSync(
        `node dist/cli.js read "${addId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );
      expect(verifyOutput).toContain("return a * b");
    });
  });

  describe("create command", () => {
    it("creates a new file with content", () => {
      const newFilePath = join(tempDir, "new-module.ts");
      const newSource = `export function multiply(a: number, b: number): number {
  return a * b;
}`;

      const output = execSync(
        `echo '${newSource}' | node dist/cli.js create "${newFilePath}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      expect(output).toContain("created:");
      expect(output).toContain("synced:");
      expect(output).toContain("multiply");

      // Verify file exists
      const content = readFileSync(newFilePath, "utf-8");
      expect(content).toContain("return a * b");
    });

    it("fails if file already exists without --force", () => {
      try {
        execSync(
          `echo 'content' | node dist/cli.js create "${fixturePath}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
          { encoding: "utf-8", stdio: "pipe" }
        );
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.stderr.toString()).toContain("file already exists");
      }
    });

    it("overwrites existing file with --force", () => {
      const newSource = `export function replaced(): string {
  return "replaced";
}`;

      execSync(
        `echo '${newSource}' | node dist/cli.js create "${fixturePath}" --force -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      const content = readFileSync(fixturePath, "utf-8");
      expect(content).toContain("replaced");
      expect(content).not.toContain("greet");
    });

    it("creates directories if needed", () => {
      const nestedPath = join(tempDir, "nested", "deep", "module.ts");
      const source = `export const CONSTANT = 42;`;

      execSync(
        `echo '${source}' | node dist/cli.js create "${nestedPath}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      const content = readFileSync(nestedPath, "utf-8");
      expect(content).toContain("CONSTANT = 42");
    });
  });

  describe("delete command", () => {
    it("deletes an entity from file", () => {
      // Delete greet function
      const output = execSync(
        `node dist/cli.js delete "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      expect(output).toContain("deleted:");

      // Verify greet is gone but add remains
      const content = readFileSync(fixturePath, "utf-8");
      expect(content).not.toContain("function greet");
      expect(content).toContain("function add");
    });

    it("updates line numbers of remaining entities", () => {
      // Delete greet (lines 1-3)
      execSync(`node dist/cli.js delete "${greetId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`, {
        encoding: "utf-8",
      });

      // Read add - should now be at different lines
      const output = execSync(
        `node dist/cli.js read "${addId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      // add should now start earlier in the file
      expect(output).toContain("lines:");
      expect(output).toContain("return a + b");
    });

    it("warns when file becomes empty", () => {
      // Create a file with single entity
      const singlePath = join(tempDir, "single.ts");
      writeFileSync(singlePath, `export function only(): void {}`);

      execSync(`node dist/cli.js sync -p "${singlePath}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`, {
        encoding: "utf-8",
      });

      const onlyId = execSync(
        `node dist/cli.js find only -d "${dbPath}"`,
        { encoding: "utf-8" }
      ).split('\n')[0];

      const output = execSync(
        `node dist/cli.js delete "${onlyId}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      expect(output).toContain("warning:");
      expect(output).toContain("empty");
    });

    it("deletes file when empty with --file flag", () => {
      // Create a file with single entity
      const singlePath = join(tempDir, "to-delete.ts");
      writeFileSync(singlePath, `export function toDelete(): void {}`);

      execSync(`node dist/cli.js sync -p "${singlePath}" -d "${dbPath}" --tsconfig "${tsconfigPath}"`, {
        encoding: "utf-8",
      });

      const deleteId = execSync(
        `node dist/cli.js find toDelete -d "${dbPath}"`,
        { encoding: "utf-8" }
      ).split('\n')[0];

      const output = execSync(
        `node dist/cli.js delete "${deleteId}" --file -d "${dbPath}" --tsconfig "${tsconfigPath}"`,
        { encoding: "utf-8" }
      );

      expect(output).toContain("removed:");
      expect(output).toContain("empty");

      // Verify file is gone
      expect(existsSync(singlePath)).toBe(false);
    });

    it("fails with helpful message for non-existent entity", () => {
      try {
        execSync(`node dist/cli.js delete "nonexistent" -d "${dbPath}" --tsconfig "${tsconfigPath}"`, {
          encoding: "utf-8",
          stdio: "pipe",
        });
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.stderr.toString()).toContain("entity not found");
        expect(e.stderr.toString()).toContain("mycelium find");
      }
    });
  });
});
