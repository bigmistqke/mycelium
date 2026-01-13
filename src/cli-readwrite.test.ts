import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

describe("CLI read/write commands", () => {
  let tempDir: string;
  let dbPath: string;
  let fixturePath: string;
  let greetId: string;
  let addId: string;

  beforeEach(() => {
    // Create temp directory
    tempDir = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    dbPath = join(tempDir, "test.db");
    fixturePath = join(tempDir, "test.ts");

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
    execSync(`node dist/cli.js sync -p "${fixturePath}" -d "${dbPath}"`, {
      encoding: "utf-8",
    });

    // Discover actual entity IDs from query (analyzer may use relative paths)
    const queryOutput = execSync(`node dist/cli.js query "%::greet" -d "${dbPath}"`, {
      encoding: "utf-8",
    });
    // Extract ID from output like "  path::greet\n    [function] ..."
    const greetMatch = queryOutput.match(/^\s+(\S+::greet)\s*$/m);
    greetId = greetMatch ? greetMatch[1] : `${fixturePath}::greet`;

    const addQueryOutput = execSync(`node dist/cli.js query "%::add" -d "${dbPath}"`, {
      encoding: "utf-8",
    });
    const addMatch = addQueryOutput.match(/^\s+(\S+::add)\s*$/m);
    addId = addMatch ? addMatch[1] : `${fixturePath}::add`;
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("read command", () => {
    it("reads entity source code", () => {
      const output = execSync(
        `node dist/cli.js read "${greetId}" -d "${dbPath}"`,
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
        `node dist/cli.js read "${greetId}" -d "${dbPath}"`,
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
        `node dist/cli.js read "${greetId}" -d "${dbPath}"`,
        { encoding: "utf-8" }
      );

      expect(output).toContain('return "Hi, " + name');
    });

    it("fails with helpful message for non-existent entity", () => {
      try {
        execSync(`node dist/cli.js read "nonexistent" -d "${dbPath}"`, {
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
        `echo '${newSource}' | node dist/cli.js write "${greetId}" -d "${dbPath}"`,
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
        `echo '${newSource}' | node dist/cli.js write "${greetId}" -d "${dbPath}"`,
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
        `echo '${newSource}' | node dist/cli.js write "${greetId}" -d "${dbPath}"`,
        { encoding: "utf-8" }
      );

      // Read greet - should have more lines now
      const greetOutput = execSync(
        `node dist/cli.js read "${greetId}" -d "${dbPath}"`,
        { encoding: "utf-8" }
      );
      expect(greetOutput).toContain("lines: 1-5");

      // Read add - should have shifted line numbers
      const addOutput = execSync(
        `node dist/cli.js read "${addId}" -d "${dbPath}"`,
        { encoding: "utf-8" }
      );
      expect(addOutput).toContain("lines: 7-9");
    });

    it("returns confirmation with entity count", () => {
      const newSource = `export function greet(name: string): string {
  return "Hey, " + name;
}`;

      const output = execSync(
        `echo '${newSource}' | node dist/cli.js write "${greetId}" -d "${dbPath}"`,
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
        `node dist/cli.js read "${addId}" -d "${dbPath}"`,
        { encoding: "utf-8" }
      );

      // Extract source (after ---)
      const source = readOutput.split("---\n")[1].trim();
      expect(source).toContain("return a + b");

      // Modify and write back
      const modified = source.replace("a + b", "a * b");
      execSync(
        `echo '${modified}' | node dist/cli.js write "${addId}" -d "${dbPath}"`,
        { encoding: "utf-8" }
      );

      // Read again to verify
      const verifyOutput = execSync(
        `node dist/cli.js read "${addId}" -d "${dbPath}"`,
        { encoding: "utf-8" }
      );
      expect(verifyOutput).toContain("return a * b");
    });
  });
});
