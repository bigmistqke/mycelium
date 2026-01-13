import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface Entity {
  id: string;
  kind: "function" | "type" | "interface" | "class" | "variable" | "module" | "property";
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
  kind: "calls" | "uses_type" | "exports" | "imports" | "reads" | "writes";
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
  name_source: "auto" | "user";
  description: string | null;
  algorithm: string | null;
  resolution: number | null;
  commit_sha: string;
}

export interface SystemMember {
  system_id: string;
  entity_id: string;
  confidence: number | null;
  commit_sha: string;
}

export interface Description {
  entity_id: string;
  content: string;
  impl_hash: string | null;
  updated_at: string;
}

/**
 * Creates and initializes the SQLite database with all required tables (entities, relations, entry_points, systems, descriptions). Sets up WAL mode for better concurrent access.
 */
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
      name_source TEXT NOT NULL DEFAULT 'auto',
      description TEXT,
      algorithm TEXT,
      resolution REAL,
      commit_sha TEXT NOT NULL,
      PRIMARY KEY (id, commit_sha)
    );

    CREATE TABLE IF NOT EXISTS system_entry_points (
      system_id TEXT NOT NULL,
      entry_point_id TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      PRIMARY KEY (system_id, entry_point_id, commit_sha)
    );

    -- System members (which entities belong to which systems)
    CREATE TABLE IF NOT EXISTS system_members (
      system_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      confidence REAL,
      commit_sha TEXT NOT NULL,
      PRIMARY KEY (system_id, entity_id, commit_sha)
    );

    CREATE INDEX IF NOT EXISTS idx_system_members_entity ON system_members(entity_id);
    CREATE INDEX IF NOT EXISTS idx_system_members_system ON system_members(system_id);

    -- Descriptions for entities (AI-generated or manual)
    CREATE TABLE IF NOT EXISTS descriptions (
      entity_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      impl_hash TEXT,
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

  /**
   * Checks if an entity exists with identical signature and implementation hashes. Used to skip redundant inserts during sync.
   */
  isEntityUnchanged(id: string, signatureHash: string, implHash: string | null): boolean {
    const existing = this.db
      .prepare("SELECT signature_hash, impl_hash FROM entities WHERE id = ? ORDER BY created_at DESC LIMIT 1")
      .get(id) as { signature_hash: string; impl_hash: string | null } | undefined;

    if (!existing) return false;
    return existing.signature_hash === signatureHash && existing.impl_hash === implHash;
  }

  /**
   * Persists a code entity (function, type, etc.) to the database. Uses INSERT OR REPLACE to update existing entities for the same commit.
   */
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

  /**
   * Records a relationship between entities (calls, uses_type, exports, imports). Uses INSERT OR IGNORE to prevent duplicate edges.
   */
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

  /**
   * Marks a function as an entry point (call graph root). Entry points are functions with outgoing calls but no callers.
   */
  insertEntryPoint(entryPoint: EntryPoint): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entry_points (entity_id, description, commit_sha)
      VALUES (?, ?, ?)
    `);
    stmt.run(entryPoint.entity_id, entryPoint.description, entryPoint.commit_sha);
  }

  /**
   * Retrieves all entities from the database. If commitSha is provided, returns entities at that specific commit. Otherwise returns the latest version of each entity.
   */
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

  /**
   * Retrieves a single entity by ID, optionally at a specific commit. Returns the latest version if no commit specified.
   */
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

  /**
   * Returns all relationship edges, optionally filtered by commit. Used for building the full call graph visualization.
   */
  getRelations(commitSha?: string): Relation[] {
    if (commitSha) {
      return this.db
        .prepare("SELECT * FROM relations WHERE commit_sha = ?")
        .all(commitSha) as Relation[];
    }
    return this.db.prepare("SELECT * FROM relations").all() as Relation[];
  }

  /**
   * Finds all functions that call a given entity. Essential for impact analysis - understanding what would break if this function changes.
   */
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

  /**
   * Finds all functions called by a given entity. Used to trace execution flow downward from entry points.
   */
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

  /**
   * Returns entry points with their associated entity data. Entry points define the main flows through the codebase.
   */
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

  /**
   * Identifies call graph roots - functions that make outgoing calls but receive no incoming calls. These represent system entry points like CLI commands or API handlers.
   */
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

  /**
   * Returns all unique commit SHAs in the database, ordered by creation time. Used to list available snapshots for temporal queries.
   */
  getCommits(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT commit_sha FROM entities ORDER BY created_at DESC")
      .all() as Array<{ commit_sha: string }>;
    return rows.map(r => r.commit_sha);
  }

  /**
   * Retrieves the stored description for an entity. Returns undefined if no description has been set.
   */
  getDescription(entityId: string): Description | undefined {
    return this.db
      .prepare("SELECT * FROM descriptions WHERE entity_id = ?")
      .get(entityId) as Description | undefined;
  }

  /**
   * Stores or updates a description for an entity. Descriptions are AI-generated or manually written and persist across syncs. Also stores the current impl_hash to detect when re-description is needed.
   */
  setDescription(entityId: string, content: string, implHash?: string | null): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO descriptions (entity_id, content, impl_hash, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(entityId, content, implHash ?? null);
  }

  /**
   * Checks if an entity's description is stale (impl_hash changed since description was written).
   */
  isDescriptionStale(entityId: string): boolean {
    const entity = this.getEntityById(entityId);
    if (!entity) return false;

    const desc = this.getDescription(entityId);
    if (!desc) return true; // No description = needs one

    // If impl_hash wasn't tracked when description was set, consider it stale
    if (desc.impl_hash === null) return true;

    return desc.impl_hash !== entity.impl_hash;
  }

  /**
   * Returns entities that need descriptions: either missing or stale (implementation changed).
   */
  getEntitiesNeedingDescriptions(): Entity[] {
    // Get all entities and filter to those needing descriptions
    const entities = this.getEntities();
    return entities.filter(e => this.isDescriptionStale(e.id));
  }

  /**
   * Returns all stored descriptions. Used by the descriptions command to show documented entities.
   */
  getAllDescriptions(): Description[] {
    return this.db.prepare("SELECT * FROM descriptions").all() as Description[];
  }

  /**
   * Finds all variables read by a given function.
   */
  getReads(entityId: string, commitSha?: string): Entity[] {
    const query = commitSha
      ? `SELECT e.* FROM entities e
         JOIN relations r ON e.id = r.to_id
         WHERE r.from_id = ? AND r.kind = 'reads' AND r.commit_sha = ? AND e.commit_sha = ?`
      : `SELECT DISTINCT e.* FROM entities e
         JOIN relations r ON e.id = r.to_id
         WHERE r.from_id = ? AND r.kind = 'reads'`;

    return commitSha
      ? (this.db.prepare(query).all(entityId, commitSha, commitSha) as Entity[])
      : (this.db.prepare(query).all(entityId) as Entity[]);
  }

  /**
   * Finds all variables written by a given function.
   */
  getWrites(entityId: string, commitSha?: string): Entity[] {
    const query = commitSha
      ? `SELECT e.* FROM entities e
         JOIN relations r ON e.id = r.to_id
         WHERE r.from_id = ? AND r.kind = 'writes' AND r.commit_sha = ? AND e.commit_sha = ?`
      : `SELECT DISTINCT e.* FROM entities e
         JOIN relations r ON e.id = r.to_id
         WHERE r.from_id = ? AND r.kind = 'writes'`;

    return commitSha
      ? (this.db.prepare(query).all(entityId, commitSha, commitSha) as Entity[])
      : (this.db.prepare(query).all(entityId) as Entity[]);
  }

  /**
   * Finds all functions that read a given variable.
   */
  getReaders(variableId: string, commitSha?: string): Entity[] {
    const query = commitSha
      ? `SELECT e.* FROM entities e
         JOIN relations r ON e.id = r.from_id
         WHERE r.to_id = ? AND r.kind = 'reads' AND r.commit_sha = ? AND e.commit_sha = ?`
      : `SELECT DISTINCT e.* FROM entities e
         JOIN relations r ON e.id = r.from_id
         WHERE r.to_id = ? AND r.kind = 'reads'`;

    return commitSha
      ? (this.db.prepare(query).all(variableId, commitSha, commitSha) as Entity[])
      : (this.db.prepare(query).all(variableId) as Entity[]);
  }

  /**
   * Finds all functions that write to a given variable.
   */
  getWriters(variableId: string, commitSha?: string): Entity[] {
    const query = commitSha
      ? `SELECT e.* FROM entities e
         JOIN relations r ON e.id = r.from_id
         WHERE r.to_id = ? AND r.kind = 'writes' AND r.commit_sha = ? AND e.commit_sha = ?`
      : `SELECT DISTINCT e.* FROM entities e
         JOIN relations r ON e.id = r.from_id
         WHERE r.to_id = ? AND r.kind = 'writes'`;

    return commitSha
      ? (this.db.prepare(query).all(variableId, commitSha, commitSha) as Entity[])
      : (this.db.prepare(query).all(variableId) as Entity[]);
  }

  // ==================== Community/System Methods ====================

  /**
   * Clears existing systems and members for a commit before inserting new detection results.
   */
  clearSystems(commitSha: string): void {
    this.db.prepare("DELETE FROM system_members WHERE commit_sha = ?").run(commitSha);
    this.db.prepare("DELETE FROM system_entry_points WHERE commit_sha = ?").run(commitSha);
    this.db.prepare("DELETE FROM systems WHERE commit_sha = ?").run(commitSha);
  }

  /**
   * Inserts a detected system (community) into the database.
   */
  insertSystem(system: Omit<System, "description"> & { description?: string | null }): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO systems (id, name, name_source, description, algorithm, resolution, commit_sha)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      system.id,
      system.name,
      system.name_source,
      system.description ?? null,
      system.algorithm,
      system.resolution,
      system.commit_sha
    );
  }

  /**
   * Inserts a system member (entity belonging to a system).
   */
  insertSystemMember(member: SystemMember): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO system_members (system_id, entity_id, confidence, commit_sha)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(member.system_id, member.entity_id, member.confidence, member.commit_sha);
  }

  /**
   * Returns all systems, optionally filtered by commit.
   */
  getSystems(commitSha?: string): System[] {
    if (commitSha) {
      return this.db
        .prepare("SELECT * FROM systems WHERE commit_sha = ?")
        .all(commitSha) as System[];
    }
    // Get latest version of each system
    return this.db
      .prepare(`
        SELECT s.* FROM systems s
        INNER JOIN (
          SELECT id, MAX(rowid) as max_rowid
          FROM systems
          GROUP BY id
        ) latest ON s.id = latest.id AND s.rowid = latest.max_rowid
      `)
      .all() as System[];
  }

  /**
   * Returns a system by ID or name.
   */
  getSystemByIdOrName(idOrName: string, commitSha?: string): System | undefined {
    const query = commitSha
      ? "SELECT * FROM systems WHERE (id = ? OR name = ?) AND commit_sha = ? LIMIT 1"
      : "SELECT * FROM systems WHERE (id = ? OR name = ?) ORDER BY rowid DESC LIMIT 1";

    return commitSha
      ? (this.db.prepare(query).get(idOrName, idOrName, commitSha) as System | undefined)
      : (this.db.prepare(query).get(idOrName, idOrName) as System | undefined);
  }

  /**
   * Returns all members of a system with their entity data.
   */
  getSystemMembers(systemId: string, commitSha?: string): Array<SystemMember & { entity: Entity }> {
    const query = commitSha
      ? `SELECT sm.*, e.* FROM system_members sm
         JOIN entities e ON sm.entity_id = e.id
         WHERE sm.system_id = ? AND sm.commit_sha = ?`
      : `SELECT sm.*, e.* FROM system_members sm
         JOIN entities e ON sm.entity_id = e.id
         WHERE sm.system_id = ?`;

    const rows = commitSha
      ? this.db.prepare(query).all(systemId, commitSha)
      : this.db.prepare(query).all(systemId);

    return (rows as Record<string, unknown>[]).map((row) => ({
      system_id: row.system_id as string,
      entity_id: row.entity_id as string,
      confidence: row.confidence as number | null,
      commit_sha: row.commit_sha as string,
      entity: {
        id: row.id as string,
        kind: row.kind as Entity["kind"],
        name: row.name as string,
        file_path: row.file_path as string,
        start_line: row.start_line as number,
        end_line: row.end_line as number,
        signature: row.signature as string,
        signature_hash: row.signature_hash as string,
        impl_hash: row.impl_hash as string | null,
        commit_sha: row.commit_sha as string,
        created_at: row.created_at as string,
      },
    }));
  }

  /**
   * Returns the systems an entity belongs to.
   */
  getEntitySystems(entityId: string, commitSha?: string): Array<{ system: System; confidence: number | null }> {
    const query = commitSha
      ? `SELECT s.*, sm.confidence FROM systems s
         JOIN system_members sm ON s.id = sm.system_id AND s.commit_sha = sm.commit_sha
         WHERE sm.entity_id = ? AND sm.commit_sha = ?`
      : `SELECT s.*, sm.confidence FROM systems s
         JOIN system_members sm ON s.id = sm.system_id
         WHERE sm.entity_id = ?`;

    const rows = commitSha
      ? this.db.prepare(query).all(entityId, commitSha)
      : this.db.prepare(query).all(entityId);

    return (rows as Record<string, unknown>[]).map((row) => ({
      system: {
        id: row.id as string,
        name: row.name as string,
        name_source: (row.name_source as "auto" | "user") || "auto",
        description: row.description as string | null,
        algorithm: row.algorithm as string | null,
        resolution: row.resolution as number | null,
        commit_sha: row.commit_sha as string,
      },
      confidence: row.confidence as number | null,
    }));
  }

  /**
   * Updates a system's name and marks it as user-named.
   */
  renameSystem(idOrName: string, newName: string): boolean {
    const system = this.getSystemByIdOrName(idOrName);
    if (!system) return false;

    this.db
      .prepare("UPDATE systems SET name = ?, name_source = 'user' WHERE id = ? AND commit_sha = ?")
      .run(newName, system.id, system.commit_sha);
    return true;
  }

  /**
   * Returns all user-named systems with their member entity IDs.
   * Used for overlap matching when re-running community detection.
   */
  getUserNamedSystemsWithMembers(): Array<{ system: System; memberIds: string[] }> {
    const systems = this.db
      .prepare("SELECT * FROM systems WHERE name_source = 'user'")
      .all() as System[];

    return systems.map((system) => {
      const members = this.db
        .prepare("SELECT entity_id FROM system_members WHERE system_id = ?")
        .all(system.id) as Array<{ entity_id: string }>;

      return {
        system,
        memberIds: members.map((m) => m.entity_id),
      };
    });
  }

  /**
   * Updates a system's description.
   */
  describeSystem(idOrName: string, description: string): boolean {
    const system = this.getSystemByIdOrName(idOrName);
    if (!system) return false;

    this.db
      .prepare("UPDATE systems SET description = ? WHERE id = ? AND commit_sha = ?")
      .run(description, system.id, system.commit_sha);
    return true;
  }

  /**
   * Returns count of members per system.
   */
  getSystemMemberCounts(commitSha?: string): Array<{ system_id: string; count: number }> {
    const query = commitSha
      ? "SELECT system_id, COUNT(*) as count FROM system_members WHERE commit_sha = ? GROUP BY system_id"
      : "SELECT system_id, COUNT(*) as count FROM system_members GROUP BY system_id";

    return commitSha
      ? (this.db.prepare(query).all(commitSha) as Array<{ system_id: string; count: number }>)
      : (this.db.prepare(query).all() as Array<{ system_id: string; count: number }>);
  }

  /**
   * Closes the database connection. Should be called when done with queries to release resources.
   */
  close(): void {
    this.db.close();
  }
}
