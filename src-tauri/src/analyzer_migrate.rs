//! One-time migration of `analyzer_signals` to support register-less
//! "calculated" signals (`kind`), plus the `analyzer_signal_inputs` link table.

use rusqlite::Connection;

/// Single source of truth for the `analyzer_signals` shape. Used by the fresh
/// schema in `db.rs` (`analyzer_signals`) and by the rebuild (`analyzer_signals_new`).
pub(crate) fn analyzer_signals_ddl(table_name: &str) -> String {
    format!(
        "CREATE TABLE IF NOT EXISTS {table_name} (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'register',
  slave_id INTEGER NULL,
  connection_kind TEXT NOT NULL DEFAULT '',
  function_kind TEXT NOT NULL DEFAULT '',
  register_row_id INTEGER NULL,
  decoder_json TEXT NOT NULL DEFAULT '',
  last_value_json TEXT,
  last_updated_ts_ms INTEGER,
  state TEXT NOT NULL DEFAULT 'DISCONNECTED',
  error_json TEXT,
  FOREIGN KEY(slave_id) REFERENCES slaves(id) ON DELETE RESTRICT,
  FOREIGN KEY(register_row_id) REFERENCES slave_register_rows(id) ON DELETE RESTRICT,
  CHECK (
    (kind = 'register' AND slave_id IS NOT NULL AND register_row_id IS NOT NULL)
    OR (kind = 'calculated' AND slave_id IS NULL AND register_row_id IS NULL)
  )
);"
    )
}

const INDEX_DDL: &str = "
CREATE INDEX IF NOT EXISTS idx_analyzer_signals_slave
  ON analyzer_signals(slave_id);";

const INPUTS_DDL: &str = "
CREATE TABLE IF NOT EXISTS analyzer_signal_inputs (
  signal_id TEXT NOT NULL REFERENCES analyzer_signals(id) ON DELETE CASCADE,
  input_signal_id TEXT NOT NULL REFERENCES analyzer_signals(id) ON DELETE RESTRICT,
  PRIMARY KEY(signal_id, input_signal_id)
);
CREATE INDEX IF NOT EXISTS idx_analyzer_signal_inputs_input
  ON analyzer_signal_inputs(input_signal_id);";

/// Returns the column names of `analyzer_signals` (empty if the table is missing).
fn signal_columns(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(analyzer_signals)")
        .map_err(|e| format!("failed to inspect analyzer_signals: {e}"))?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| format!("failed to inspect analyzer_signals: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("failed to inspect analyzer_signals: {e}"))
}

fn fk_violations(conn: &Connection, table: &str) -> Result<i64, String> {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM pragma_foreign_key_check('{table}')"),
        [],
        |r| r.get(0),
    )
    .map_err(|e| format!("foreign_key_check({table}) failed: {e}"))
}

/// Tables whose foreign keys the rebuild can affect.
const CHECKED_TABLES: [&str; 2] = ["analyzer_signals", "analyzer_tile_signals"];

/// `(table, before, after)` violation counts. Fails only when a count grew: a
/// violation that existed before the upgrade must not block opening the workspace.
fn check_no_new_violations(counts: &[(&str, i64, i64)]) -> Result<(), String> {
    for &(table, before, after) in counts {
        if after > before {
            return Err(format!(
                "analyzer_signals migration would add {} foreign key violation(s) in {table} ({before} before, {after} after); nothing was changed",
                after - before
            ));
        }
    }
    Ok(())
}

/// Runs inside the caller's `foreign_keys = OFF` window. Takes the write lock,
/// re-checks the column (a racing open may have migrated already), rebuilds.
fn rebuild_signals(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("BEGIN IMMEDIATE;")
        .map_err(|e| format!("failed to begin analyzer_signals migration: {e}"))?;
    let cols = signal_columns(conn)?;
    if cols.is_empty() || cols.iter().any(|c| c == "kind") {
        return conn
            .execute_batch("COMMIT;")
            .map_err(|e| format!("failed to commit analyzer_signals migration: {e}"));
    }

    let mut before = Vec::with_capacity(CHECKED_TABLES.len());
    for table in CHECKED_TABLES {
        before.push(fk_violations(conn, table)?);
    }

    let sql = format!(
        "DROP TABLE IF EXISTS analyzer_signals_new;
         {ddl}
         INSERT INTO analyzer_signals_new
           (id, kind, slave_id, connection_kind, function_kind, register_row_id,
            decoder_json, last_value_json, last_updated_ts_ms, state, error_json)
         SELECT id, 'register', slave_id, connection_kind, function_kind, register_row_id,
                decoder_json, last_value_json, last_updated_ts_ms, state, error_json
         FROM analyzer_signals;
         DROP TABLE analyzer_signals;
         ALTER TABLE analyzer_signals_new RENAME TO analyzer_signals;
         {INDEX_DDL}",
        ddl = analyzer_signals_ddl("analyzer_signals_new"),
    );
    conn.execute_batch(&sql)
        .map_err(|e| format!("failed to rebuild analyzer_signals: {e}"))?;

    // Scoped checks, compared with the counts before the rebuild: only a violation
    // the rebuild introduced fails (and rolls back) the migration.
    let mut counts = Vec::with_capacity(CHECKED_TABLES.len());
    for (table, before) in CHECKED_TABLES.iter().zip(before) {
        counts.push((*table, before, fk_violations(conn, table)?));
    }
    check_no_new_violations(&counts)?;
    conn.execute_batch("COMMIT;")
        .map_err(|e| format!("failed to commit analyzer_signals migration: {e}"))
}

/// Idempotent. If `analyzer_signals` does not exist there is nothing to
/// migrate and this returns `Ok(())` without touching anything. Otherwise it
/// rebuilds the table once (when it lacks `kind`) and always ensures
/// `analyzer_signal_inputs` exists.
pub(crate) fn migrate_analyzer_signals_kind(conn: &Connection) -> Result<(), String> {
    let cols = signal_columns(conn)?;
    if cols.is_empty() {
        return Ok(());
    }
    if !cols.iter().any(|c| c == "kind") {
        // foreign_keys cannot change inside a transaction.
        conn.execute_batch("PRAGMA foreign_keys = OFF;")
            .map_err(|e| format!("failed to disable foreign_keys: {e}"))?;
        let res = rebuild_signals(conn);
        if res.is_err() {
            let _ = conn.execute_batch("ROLLBACK;");
        }
        let restore = conn.execute_batch("PRAGMA foreign_keys = ON;");
        match (res, restore) {
            (Ok(()), Ok(())) => {}
            (Ok(()), Err(e)) => return Err(format!("failed to re-enable foreign_keys: {e}")),
            (Err(r), Ok(())) => return Err(r),
            (Err(r), Err(e)) => {
                return Err(format!("{r}; additionally failed to re-enable foreign_keys: {e}"))
            }
        }
    }
    conn.execute_batch(INPUTS_DDL)
        .map_err(|e| format!("failed to create analyzer_signal_inputs: {e}"))
}

const TABS_DDL: &str = "
CREATE TABLE IF NOT EXISTS analyzer_tabs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);";

fn tabs_in_tx(conn: &Connection) -> Result<(), String> {
    let has_tiles: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='analyzer_tiles'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("failed to inspect analyzer_tiles: {e}"))?;
    if has_tiles == 0 {
        return Ok(());
    }
    conn.execute_batch(TABS_DDL)
        .map_err(|e| format!("failed to create analyzer_tabs: {e}"))?;
    let has_col: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('analyzer_tiles') WHERE name='tab_id'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("failed to inspect analyzer_tiles: {e}"))?;
    if has_col == 0 {
        conn.execute_batch(
            "ALTER TABLE analyzer_tiles ADD COLUMN tab_id INTEGER REFERENCES analyzer_tabs(id);",
        )
        .map_err(|e| format!("failed to add analyzer_tiles.tab_id: {e}"))?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_analyzer_tiles_tab ON analyzer_tiles(tab_id);
         INSERT INTO analyzer_tabs (name, position, created_at, updated_at)
           SELECT 'Main', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE NOT EXISTS (SELECT 1 FROM analyzer_tabs);
         UPDATE analyzer_tiles
           SET tab_id = (SELECT id FROM analyzer_tabs ORDER BY position, id LIMIT 1)
           WHERE tab_id IS NULL;",
    )
    .map_err(|e| format!("failed to populate analyzer_tabs: {e}"))
}

/// Read-only check that the tabs upgrade has nothing to do: the table, column
/// and index exist, there is at least one tab, and no tile lacks a tab. Any
/// error reads as "not done" so the transactional path decides.
fn tabs_already_migrated(conn: &Connection) -> bool {
    let shape_ok = conn
        .query_row(
            "SELECT
               (SELECT COUNT(*) FROM pragma_table_info('analyzer_tiles') WHERE name='tab_id') = 1
               AND (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='analyzer_tabs') = 1
               AND (SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_analyzer_tiles_tab') = 1",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap_or(false);
    if !shape_ok {
        return false;
    }
    conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM analyzer_tabs)
           AND NOT EXISTS (SELECT 1 FROM analyzer_tiles WHERE tab_id IS NULL)",
        [],
        |r| r.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

/// Idempotent. Creates `analyzer_tabs`, adds `analyzer_tiles.tab_id`, guarantees
/// at least one tab (`Main`), and back-fills tiles without a tab onto the first
/// one. Does nothing when `analyzer_tiles` does not exist. Runs on every
/// workspace open, so an already-upgraded database is checked read-only and
/// never takes the write lock.
pub(crate) fn migrate_analyzer_tabs(conn: &Connection) -> Result<(), String> {
    if tabs_already_migrated(conn) {
        return Ok(());
    }
    conn.execute_batch("BEGIN IMMEDIATE;")
        .map_err(|e| format!("failed to begin analyzer_tabs migration: {e}"))?;
    match tabs_in_tx(conn) {
        Ok(()) => conn
            .execute_batch("COMMIT;")
            .map_err(|e| format!("failed to commit analyzer_tabs migration: {e}")),
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ensure_workspace_db;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("analyzer_migrate_test_{nanos}"));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn cleanup(dir: PathBuf, conn: Connection) {
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 0.5.0 schema + seed data.
    fn old_schema_db() -> (PathBuf, Connection) {
        let dir = temp_dir();
        let conn = Connection::open(dir.join("workspace.db")).expect("open db");
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
            CREATE TABLE slaves (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              unit_id INTEGER NOT NULL,
              poll_interval_ms INTEGER,
              connection_kind TEXT NOT NULL DEFAULT 'serial',
              address_offset INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE slave_register_rows (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              slave_id INTEGER NOT NULL,
              function_code INTEGER NOT NULL,
              address INTEGER NOT NULL,
              alias TEXT NOT NULL DEFAULT '',
              data_type TEXT NOT NULL,
              \"order\" TEXT NOT NULL DEFAULT 'ABCD',
              display_format TEXT NOT NULL,
              write_value INTEGER,
              updated_at TEXT NOT NULL,
              UNIQUE(slave_id, function_code, address),
              FOREIGN KEY(slave_id) REFERENCES slaves(id) ON DELETE CASCADE
            );
            CREATE TABLE analyzer_tiles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              kind TEXT NOT NULL,
              title TEXT NOT NULL DEFAULT '',
              config_json TEXT NOT NULL DEFAULT '',
              polling_enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(id)
            );
            CREATE TABLE analyzer_signals (
              id TEXT PRIMARY KEY,
              slave_id INTEGER NOT NULL,
              connection_kind TEXT NOT NULL,
              function_kind TEXT NOT NULL,
              register_row_id INTEGER NOT NULL,
              decoder_json TEXT NOT NULL DEFAULT '',
              last_value_json TEXT,
              last_updated_ts_ms INTEGER,
              state TEXT NOT NULL DEFAULT 'DISCONNECTED',
              error_json TEXT,
              FOREIGN KEY(slave_id) REFERENCES slaves(id) ON DELETE RESTRICT,
              FOREIGN KEY(register_row_id) REFERENCES slave_register_rows(id) ON DELETE RESTRICT
            );
            CREATE INDEX idx_analyzer_signals_slave ON analyzer_signals(slave_id);
            CREATE TABLE analyzer_tile_signals (
              tile_id INTEGER NOT NULL,
              signal_id TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'primary',
              poll_interval_ms INTEGER NOT NULL DEFAULT 1000,
              PRIMARY KEY(tile_id, signal_id),
              FOREIGN KEY(tile_id) REFERENCES analyzer_tiles(id) ON DELETE CASCADE,
              FOREIGN KEY(signal_id) REFERENCES analyzer_signals(id) ON DELETE CASCADE
            );
            INSERT INTO slaves (id,name,unit_id,created_at,updated_at) VALUES (1,'S',1,'t','t');
            INSERT INTO slave_register_rows (id,slave_id,function_code,address,data_type,display_format,updated_at)
              VALUES (1,1,3,0,'u16','dec','t');
            INSERT INTO analyzer_signals
              (id,slave_id,connection_kind,function_kind,register_row_id,decoder_json,last_value_json,state)
              VALUES ('T_2_IN_0',1,'serial','read',1,'{\"unit\":\"V\"}','{\"rawWords\":[328]}','OK');
            INSERT INTO analyzer_tiles (id,kind,created_at,updated_at) VALUES (2,'k','t','t');
            INSERT INTO analyzer_tile_signals (tile_id,signal_id) VALUES (2,'T_2_IN_0');",
        )
        .expect("old schema");
        (dir, conn)
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            == 1
    }

    #[test]
    fn migrates_old_signals_preserving_rows_and_links() {
        let (dir, conn) = old_schema_db();
        migrate_analyzer_signals_kind(&conn).expect("migrate");

        let (kind, dec, last, slave, reg): (String, String, String, i64, i64) = conn
            .query_row(
                "SELECT kind, decoder_json, last_value_json, slave_id, register_row_id
                 FROM analyzer_signals WHERE id='T_2_IN_0'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(kind, "register");
        assert_eq!(dec, "{\"unit\":\"V\"}");
        assert_eq!(last, "{\"rawWords\":[328]}");
        assert_eq!((slave, reg), (1, 1));

        let links: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM analyzer_tile_signals WHERE tile_id=2 AND signal_id='T_2_IN_0'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(links, 1);

        let violations: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(violations, 0);
        assert!(table_exists(&conn, "analyzer_signal_inputs"));
        let idx: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_analyzer_signals_slave'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx, 1);
        let fk_on: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk_on, 1);
        cleanup(dir, conn);
    }

    #[test]
    fn migration_is_idempotent() {
        let (dir, conn) = old_schema_db();
        migrate_analyzer_signals_kind(&conn).expect("first");
        migrate_analyzer_signals_kind(&conn).expect("second");
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM analyzer_signals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        cleanup(dir, conn);
    }

    #[test]
    fn new_schema_accepts_calculated_and_rejects_half_rows() {
        let (dir, conn) = old_schema_db();
        migrate_analyzer_signals_kind(&conn).expect("migrate");

        conn.execute(
            "INSERT INTO analyzer_signals (id,kind,decoder_json,state)
             VALUES ('C','calculated','{}','DISCONNECTED')",
            [],
        )
        .expect("calculated ok");
        assert!(conn
            .execute(
                "INSERT INTO analyzer_signals (id,kind,slave_id,decoder_json,state)
                 VALUES ('C2','calculated',1,'{}','DISCONNECTED')",
                [],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO analyzer_signals (id,kind,slave_id,decoder_json,state)
                 VALUES ('R2','register',1,'{}','DISCONNECTED')",
                [],
            )
            .is_err());
        cleanup(dir, conn);
    }

    /// Seeds a row whose slave does not exist (written with foreign keys off).
    fn seed_dangling_signal(conn: &Connection) {
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO analyzer_signals
               (id,slave_id,connection_kind,function_kind,register_row_id,decoder_json,state)
               VALUES ('BAD',99,'serial','read',1,'{}','OK');
             PRAGMA foreign_keys = ON;",
        )
        .expect("seed dangling");
    }

    fn dangling_row_count(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM analyzer_signals WHERE id='BAD' AND slave_id=99",
            [],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn pre_existing_foreign_key_violation_does_not_block_migration() {
        let (dir, conn) = old_schema_db();
        seed_dangling_signal(&conn);
        let before = fk_violations(&conn, "analyzer_signals").unwrap();
        assert_eq!(before, 1);

        migrate_analyzer_signals_kind(&conn).expect("migrate despite old violation");
        assert!(signal_columns(&conn).unwrap().iter().any(|c| c == "kind"));
        // The row is kept as-is (never silently dropped or changed), and no new violation appeared.
        assert_eq!(dangling_row_count(&conn), 1);
        assert_eq!(fk_violations(&conn, "analyzer_signals").unwrap(), before);
        assert_eq!(fk_violations(&conn, "analyzer_tile_signals").unwrap(), 0);
        let fk_on: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk_on, 1);
        cleanup(dir, conn);
    }

    #[test]
    fn new_violations_check_fails_only_when_a_count_grows() {
        assert!(check_no_new_violations(&[("t", 0, 0), ("u", 2, 2)]).is_ok());
        assert!(check_no_new_violations(&[("t", 3, 1)]).is_ok());
        let err = check_no_new_violations(&[("t", 0, 0), ("u", 1, 3)]).unwrap_err();
        assert_eq!(
            err,
            "analyzer_signals migration would add 2 foreign key violation(s) in u (1 before, 3 after); nothing was changed"
        );
    }

    #[test]
    fn rebuild_failure_rolls_back_and_restores_foreign_keys() {
        let (dir, conn) = old_schema_db();
        seed_dangling_signal(&conn);
        // A view squatting on the rebuild's scratch name makes the rebuild fail.
        conn.execute_batch("CREATE VIEW analyzer_signals_new AS SELECT 1;")
            .expect("blocking view");

        assert!(migrate_analyzer_signals_kind(&conn).is_err());
        assert!(!signal_columns(&conn).unwrap().iter().any(|c| c == "kind"));
        assert_eq!(dangling_row_count(&conn), 1);
        assert!(!table_exists(&conn, "analyzer_signals_new"));
        let fk_on: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk_on, 1);
        cleanup(dir, conn);
    }

    #[test]
    fn fresh_workspace_db_has_new_shape() {
        let dir = temp_dir();
        ensure_workspace_db(&dir, "workspace.db").expect("schema");
        let conn = Connection::open(dir.join("workspace.db")).expect("open");
        assert!(signal_columns(&conn).unwrap().iter().any(|c| c == "kind"));
        assert!(table_exists(&conn, "analyzer_signal_inputs"));
        cleanup(dir, conn);
    }

    /// Simulates a 0.5-era workspace: no `analyzer_tabs`, tiles without `tab_id`,
    /// tile 1 with desktop+mobile layouts, tile 2 with desktop only. Foreign keys
    /// are off while reshaping so dropping `analyzer_tiles` cannot cascade into layouts.
    fn pre_tabs_db() -> (PathBuf, Connection) {
        let dir = temp_dir();
        ensure_workspace_db(&dir, "workspace.db").expect("schema");
        let conn = Connection::open(dir.join("workspace.db")).expect("open");
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             DROP TABLE analyzer_tiles;
             DROP TABLE analyzer_tabs;
             CREATE TABLE analyzer_tiles (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               kind TEXT NOT NULL,
               title TEXT NOT NULL DEFAULT '',
               config_json TEXT NOT NULL DEFAULT '',
               polling_enabled INTEGER NOT NULL DEFAULT 1,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               UNIQUE(id)
             );
             INSERT INTO analyzer_tiles (id,kind,created_at,updated_at) VALUES (1,'k','t','t'),(2,'k','t','t');
             INSERT INTO analyzer_tile_layouts (tile_id,breakpoint,x,y,w,h) VALUES
               (1,'desktop',0,0,4,3),(1,'mobile',1,2,2,5),(2,'desktop',4,0,4,3);
             PRAGMA foreign_keys = ON;",
        )
        .expect("0.5 shape");
        (dir, conn)
    }

    fn tabs(conn: &Connection) -> Vec<(i64, String, i64)> {
        let mut stmt = conn
            .prepare("SELECT id, name, position FROM analyzer_tabs ORDER BY position, id")
            .unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        rows.collect::<Result<Vec<_>, _>>().unwrap()
    }

    fn tile_tab(conn: &Connection, id: i64) -> Option<i64> {
        conn.query_row("SELECT tab_id FROM analyzer_tiles WHERE id=?1", [id], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn tabs_upgrade_puts_existing_tiles_in_main() {
        let (dir, conn) = pre_tabs_db();
        migrate_analyzer_tabs(&conn).expect("migrate");

        let t = tabs(&conn);
        assert_eq!(t.len(), 1);
        assert_eq!((t[0].1.as_str(), t[0].2), ("Main", 0));
        assert_eq!(tile_tab(&conn, 1), Some(t[0].0));
        assert_eq!(tile_tab(&conn, 2), Some(t[0].0));

        let mut stmt = conn
            .prepare("SELECT tile_id,breakpoint,x,y,w,h FROM analyzer_tile_layouts ORDER BY tile_id,breakpoint")
            .unwrap();
        let layouts: Vec<(i64, String, i64, i64, i64, i64)> = stmt
            .query_map([], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        drop(stmt);
        assert_eq!(
            layouts,
            vec![
                (1, "desktop".to_string(), 0, 0, 4, 3),
                (1, "mobile".to_string(), 1, 2, 2, 5),
                (2, "desktop".to_string(), 4, 0, 4, 3),
            ]
        );
        cleanup(dir, conn);
    }

    #[test]
    fn tabs_upgrade_is_idempotent_and_backfills_nulls() {
        let (dir, conn) = pre_tabs_db();
        migrate_analyzer_tabs(&conn).expect("first");
        migrate_analyzer_tabs(&conn).expect("second");
        let t = tabs(&conn);
        assert_eq!(t.len(), 1);

        conn.execute("UPDATE analyzer_tiles SET tab_id = NULL WHERE id = 2", []).unwrap();
        migrate_analyzer_tabs(&conn).expect("third");
        assert_eq!(tile_tab(&conn, 2), Some(t[0].0));
        cleanup(dir, conn);
    }

    #[test]
    fn tabs_upgrade_fast_path_takes_no_write_lock_and_changes_nothing() {
        let (dir, conn) = pre_tabs_db();
        migrate_analyzer_tabs(&conn).expect("first");
        let tabs_before = tabs(&conn);
        let tiles_before = (tile_tab(&conn, 1), tile_tab(&conn, 2));
        let total_changes = |c: &Connection| -> i64 {
            c.query_row("SELECT total_changes()", [], |r| r.get(0)).unwrap()
        };
        let changes_before = total_changes(&conn);

        // Another connection holds the write lock: the fast path must not need it.
        let other = Connection::open(dir.join("workspace.db")).expect("open other");
        other.execute_batch("BEGIN IMMEDIATE;").expect("lock");
        conn.busy_timeout(std::time::Duration::from_millis(0)).unwrap();
        migrate_analyzer_tabs(&conn).expect("already migrated: read-only");
        other.execute_batch("ROLLBACK;").unwrap();
        drop(other);

        assert_eq!(total_changes(&conn), changes_before);
        assert_eq!(tabs(&conn), tabs_before);
        assert_eq!((tile_tab(&conn, 1), tile_tab(&conn, 2)), tiles_before);

        // A NULL tab_id still takes the transactional path.
        conn.execute("UPDATE analyzer_tiles SET tab_id = NULL WHERE id = 1", []).unwrap();
        migrate_analyzer_tabs(&conn).expect("backfill");
        assert_eq!(tile_tab(&conn, 1), Some(tabs_before[0].0));
        cleanup(dir, conn);
    }

    #[test]
    fn tabs_upgrade_creates_main_for_empty_workspace() {
        let dir = temp_dir();
        ensure_workspace_db(&dir, "workspace.db").expect("schema");
        let conn = Connection::open(dir.join("workspace.db")).expect("open");
        let t = tabs(&conn);
        assert_eq!(t.len(), 1);
        assert_eq!((t[0].1.as_str(), t[0].2), ("Main", 0));
        cleanup(dir, conn);
    }
}
