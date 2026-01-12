import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface Entity {
  id: string;
  kind: "function" | "type" | "interface" | "class" | "variable" | "module";
  name: string;
  file_path: string;
  start_line: number;
  end_line: number;
  signature: string;
  signature_hash: string;
  impl_hash: string | null;
  commit_sha: string;
  created_at: string;
}

export interface Relation {
  id: number;
  from_id: string;
  to_id: string;
  kind: "calls" | "uses_type" | "exports" | "imports";
  commit_sha: string;
  metadata: string | null;
}

export interface EntryPoint {
  entity_id: string;
  description: string | null;
  commit_sha: string;
}

export interface System {
  id: string;
  name: string;
  description: string | null;
  commit_sha: string;
}

export interface Description {
  entity_id: string;
  content: string;
  updated_at: string;
}

export function createDatabase(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    -- Core entities extracted from TypeScript
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      signature TEXT NOT NULL,
      signature_hash TEXT NOT NULL,
      impl_hash TEXT,
      commit_sha TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, commit_sha)
    );

    -- Relationships between entities
    CREATE TABLE IF NOT EXISTS relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      metadata TEXT,
      UNIQUE(from_id, to_id, kind, commit_sha)
    );

    -- Entry points (call graph roots)
    CREATE TABLE IF NOT EXISTS entry_points (
      entity_id TEXT NOT NULL,
      description TEXT,
      commit_sha TEXT NOT NULL,
      PRIMARY KEY (entity_id, commit_sha)
    );

    -- Systems (groupings of entry points)
    CREATE TABLE IF NOT EXISTS systems (
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      commit_sha TEXT NOT NULL,
      PRIMARY KEY (id, commit_sha)
    );

    CREATE TABLE IF NOT EXISTS system_entry_points (
      system_id TEXT NOT NULL,
      entry_point_id TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      PRIMARY KEY (system_id, entry_point_id, commit_sha)
    );

    -- Descriptions for entities (AI-generated or manual)
    CREATE TABLE IF NOT EXISTS descriptions (
      entity_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_entities_file ON entities(file_path);
    CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);
    CREATE INDEX IF NOT EXISTS idx_entities_commit ON entities(commit_sha);
    CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
    CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);
    CREATE INDEX IF NOT EXISTS idx_relations_commit ON relations(commit_sha);
  `);

  return db;
}

export class GraphStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = createDatabase(dbPath);
  }

  insertEntity(entity: Omit<Entity, "created_at">): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entities (id, kind, name, file_path, start_line, end_line, signature, signature_hash, impl_hash, commit_sha)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entity.id,
      entity.kind,
      entity.name,
      entity.file_path,
      entity.start_line,
      entity.end_line,
      entity.signature,
      entity.signature_hash,
      entity.impl_hash,
      entity.commit_sha
    );
  }

  insertRelation(relation: Omit<Relation, "id">): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO relations (from_id, to_id, kind, commit_sha, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      relation.from_id,
      relation.to_id,
      relation.kind,
      relation.commit_sha,
      relation.metadata
    );
  }

  insertEntryPoint(entryPoint: EntryPoint): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entry_points (entity_id, description, commit_sha)
      VALUES (?, ?, ?)
    `);
    stmt.run(entryPoint.entity_id, entryPoint.description, entryPoint.commit_sha);
  }

  getEntities(commitSha?: string): Entity[] {
    if (commitSha) {
      return this.db
        .prepare("SELECT * FROM entities WHERE commit_sha = ?")
        .all(commitSha) as Entity[];
    }
    // Get latest version of each entity
    return this.db
      .prepare(`
        SELECT e.* FROM entities e
        INNER JOIN (
          SELECT id, MAX(created_at) as max_created
          FROM entities
          GROUP BY id
        ) latest ON e.id = latest.id AND e.created_at = latest.max_created
      `)
      .all() as Entity[];
  }

  getEntityById(id: string, commitSha?: string): Entity | undefined {
    if (commitSha) {
      return this.db
        .prepare("SELECT * FROM entities WHERE id = ? AND commit_sha = ?")
        .get(id, commitSha) as Entity | undefined;
    }
    return this.db
      .prepare("SELECT * FROM entities WHERE id = ? ORDER BY created_at DESC LIMIT 1")
      .get(id) as Entity | undefined;
  }

  getRelations(commitSha?: string): Relation[] {
    if (commitSha) {
      return this.db
        .prepare("SELECT * FROM relations WHERE commit_sha = ?")
        .all(commitSha) as Relation[];
    }
    return this.db.prepare("SELECT * FROM relations").all() as Relation[];
  }

  getCallers(entityId: string, commitSha?: string): Entity[] {
    const query = commitSha
      ? `SELECT e.* FROM entities e
         JOIN relations r ON e.id = r.from_id
         WHERE r.to_id = ? AND r.kind = 'calls' AND r.commit_sha = ? AND e.commit_sha = ?`
      : `SELECT DISTINCT e.* FROM entities e
         JOIN relations r ON e.id = r.from_id
         WHERE r.to_id = ? AND r.kind = 'calls'`;

    return commitSha
      ? (this.db.prepare(query).all(entityId, commitSha, commitSha) as Entity[])
      : (this.db.prepare(query).all(entityId) as Entity[]);
  }

  getCallees(entityId: string, commitSha?: string): Entity[] {
    const query = commitSha
      ? `SELECT e.* FROM entities e
         JOIN relations r ON e.id = r.to_id
         WHERE r.from_id = ? AND r.kind = 'calls' AND r.commit_sha = ? AND e.commit_sha = ?`
      : `SELECT DISTINCT e.* FROM entities e
         JOIN relations r ON e.id = r.to_id
         WHERE r.from_id = ? AND r.kind = 'calls'`;

    return commitSha
      ? (this.db.prepare(query).all(entityId, commitSha, commitSha) as Entity[])
      : (this.db.prepare(query).all(entityId) as Entity[]);
  }

  getEntryPoints(commitSha?: string): Array<EntryPoint & { entity: Entity }> {
    const query = commitSha
      ? `SELECT ep.*, e.* FROM entry_points ep
         JOIN entities e ON ep.entity_id = e.id AND ep.commit_sha = e.commit_sha
         WHERE ep.commit_sha = ?`
      : `SELECT ep.*, e.* FROM entry_points ep
         JOIN entities e ON ep.entity_id = e.id`;

    const rows = commitSha
      ? this.db.prepare(query).all(commitSha)
      : this.db.prepare(query).all();

    return rows as Array<EntryPoint & { entity: Entity }>;
  }

  findEntryPoints(commitSha: string): string[] {
    // Entry points = entities that have outgoing calls but no incoming calls
    const query = `
      SELECT DISTINCT e.id FROM entities e
      WHERE e.commit_sha = ?
        AND e.kind = 'function'
        AND EXISTS (
          SELECT 1 FROM relations r
          WHERE r.from_id = e.id AND r.kind = 'calls' AND r.commit_sha = ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM relations r
          WHERE r.to_id = e.id AND r.kind = 'calls' AND r.commit_sha = ?
        )
    `;
    const rows = this.db.prepare(query).all(commitSha, commitSha, commitSha) as Array<{ id: string }>;
    return rows.map(r => r.id);
  }

  getCommits(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT commit_sha FROM entities ORDER BY created_at DESC")
      .all() as Array<{ commit_sha: string }>;
    return rows.map(r => r.commit_sha);
  }

  getDescription(entityId: string): Description | undefined {
    return this.db
      .prepare("SELECT * FROM descriptions WHERE entity_id = ?")
      .get(entityId) as Description | undefined;
  }

  setDescription(entityId: string, content: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO descriptions (entity_id, content, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(entityId, content);
  }

  getAllDescriptions(): Description[] {
    return this.db.prepare("SELECT * FROM descriptions").all() as Description[];
  }

  close(): void {
    this.db.close();
  }
}
