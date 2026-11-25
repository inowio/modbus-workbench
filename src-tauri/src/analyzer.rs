use crate::db::open_workspace_db;
use crate::models::{
    AnalyzerSignal, AnalyzerSignalUpsert, AnalyzerTile, AnalyzerTileCreate, AnalyzerTileLayout,
    AnalyzerTileLayoutUpsert, AnalyzerTileSignalInfo, AnalyzerTileUpdate,
};
use rusqlite::{params, Connection, OptionalExtension};

fn normalize_tile_inputs(kind: String, title: String, config_json: String) -> Result<(String, String, String), String> {
    let normalized_kind = kind.trim().to_lowercase();
    if normalized_kind != "widget" && normalized_kind != "chart" {
        return Err("tile kind must be 'widget' or 'chart'".to_string());
    }

    let normalized_title = title.trim().to_string();
    let normalized_config = config_json.trim().to_string();

    Ok((normalized_kind, normalized_title, normalized_config))
}

#[tauri::command]
pub fn list_analyzer_tile_layouts(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<AnalyzerTileLayout>, String> {
    let conn = open_workspace_db(&app, &name)?;
    let mut stmt = conn
        .prepare(
            "SELECT l.tile_id, l.breakpoint, l.x, l.y, l.w, l.h\n             FROM analyzer_tile_layouts l\n             JOIN analyzer_tiles t ON t.id = l.tile_id\n             ORDER BY l.tile_id ASC, l.breakpoint ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AnalyzerTileLayout {
                tile_id: row.get(0)?,
                breakpoint: row.get(1)?,
                x: row.get(2)?,
                y: row.get(3)?,
                w: row.get(4)?,
                h: row.get(5)?,
            })
        })
        .map_err(|e| format!("failed to query analyzer tile layouts: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer tile layout row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn update_analyzer_tile(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
    patch: AnalyzerTileUpdate,
    now_iso: String,
) -> Result<AnalyzerTile, String> {
    if tile_id <= 0 {
        return Err("tile_id must be > 0".to_string());
    }

    let (kind, title, config_json) =
        normalize_tile_inputs(patch.kind, patch.title, patch.config_json)?;

    let mut conn = open_workspace_db(&app, &name)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    let updated = tx
        .execute(
            "UPDATE analyzer_tiles\n             SET kind=?1, title=?2, config_json=?3, polling_enabled=?4, updated_at=?5\n             WHERE id=?6;",
            params![
                kind,
                title,
                config_json,
                if patch.polling_enabled { 1 } else { 0 },
                now_iso,
                tile_id
            ],
        )
        .map_err(|e| format!("failed to update analyzer tile: {e}"))?;

    if updated == 0 {
        return Err("tile not found".to_string());
    }

    tx.execute(
        "DELETE FROM analyzer_tile_signals WHERE tile_id = ?1;",
        (tile_id,),
    )
    .map_err(|e| format!("failed to clear tile signals: {e}"))?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO analyzer_tile_signals (tile_id, signal_id, role)\n                 VALUES (?1, ?2, ?3);",
            )
            .map_err(|e| format!("failed to prepare tile signal insert: {e}"))?;

        for link in patch.signal_links {
            let role = link.role.trim();
            if role.is_empty() {
                return Err("signal link role is required".to_string());
            }
            let signal_id = link.signal_id.trim();
            if signal_id.is_empty() {
                return Err("signal_id is required".to_string());
            }
            stmt.execute(params![tile_id, signal_id, role])
                .map_err(|e| format!("failed to link tile signal: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    let conn = open_workspace_db(&app, &name)?;
    conn.query_row(
        "SELECT id, kind, title, config_json, polling_enabled, created_at, updated_at\n         FROM analyzer_tiles\n         WHERE id = ?1;",
        (tile_id,),
        |row| {
            let polling_int: i64 = row.get(4)?;
            Ok(AnalyzerTile {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                config_json: row.get(3)?,
                polling_enabled: polling_int != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| format!("failed to read updated analyzer tile: {e}"))
}

#[tauri::command]
pub fn list_analyzer_tiles(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<AnalyzerTile>, String> {
    let conn = open_workspace_db(&app, &name)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, kind, title, config_json, polling_enabled, created_at, updated_at\n             FROM analyzer_tiles\n             ORDER BY id ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let polling_int: i64 = row.get(4)?;
            Ok(AnalyzerTile {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                config_json: row.get(3)?,
                polling_enabled: polling_int != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("failed to query analyzer tiles: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer tile row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn create_analyzer_tile(
    app: tauri::AppHandle,
    name: String,
    tile: AnalyzerTileCreate,
    now_iso: String,
) -> Result<AnalyzerTile, String> {
    let (kind, title, config_json) =
        normalize_tile_inputs(tile.kind, tile.title, tile.config_json)?;

    let mut conn = open_workspace_db(&app, &name)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    tx.execute(
        "INSERT INTO analyzer_tiles (kind, title, config_json, polling_enabled, created_at, updated_at)\n         VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
        params![
            kind,
            title,
            config_json,
            if tile.polling_enabled { 1 } else { 0 },
            now_iso.clone(),
            now_iso.clone()
        ],
    )
    .map_err(|e| format!("failed to create analyzer tile: {e}"))?;

    let tile_id = tx.last_insert_rowid();

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO analyzer_tile_layouts (tile_id, breakpoint, x, y, w, h)\n                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)\n                 ON CONFLICT(tile_id, breakpoint) DO UPDATE SET\n                   x=excluded.x, y=excluded.y, w=excluded.w, h=excluded.h;",
            )
            .map_err(|e| format!("failed to prepare layouts insert: {e}"))?;

        for l in tile.layouts {
            stmt.execute(params![tile_id, l.breakpoint, l.x, l.y, l.w, l.h])
                .map_err(|e| format!("failed to upsert tile layout: {e}"))?;
        }
    }

    {
        let mut stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO analyzer_tile_signals (tile_id, signal_id, role)\n                 VALUES (?1, ?2, ?3);",
            )
            .map_err(|e| format!("failed to prepare tile signal insert: {e}"))?;

        for link in tile.signal_links {
            stmt.execute(params![tile_id, link.signal_id.trim(), link.role.trim()])
                .map_err(|e| format!("failed to link tile signal: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    let conn = open_workspace_db(&app, &name)?;
    conn.query_row(
        "SELECT id, kind, title, config_json, polling_enabled, created_at, updated_at\n         FROM analyzer_tiles\n         WHERE id = ?1;",
        (tile_id,),
        |row| {
            let polling_int: i64 = row.get(4)?;
            Ok(AnalyzerTile {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                config_json: row.get(3)?,
                polling_enabled: polling_int != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| format!("failed to read created analyzer tile: {e}"))
}

#[cfg(test)]
mod tests {
    use super::normalize_tile_inputs;

    use super::{
        delete_analyzer_signal_in_conn, list_analyzer_signals_in_conn,
        list_analyzer_tile_signals_in_conn, upsert_analyzer_signal_in_conn,
    };
    use crate::db::ensure_workspace_db;
    use crate::models::AnalyzerSignalUpsert;
    use rusqlite::Connection;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db() -> (PathBuf, Connection) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("analyzer_signals_test_{nanos}"));
        std::fs::create_dir_all(&dir).expect("temp dir");
        ensure_workspace_db(&dir, "workspace.db").expect("schema");
        let conn = Connection::open(dir.join("workspace.db")).expect("open db");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("pragma");
        (dir, conn)
    }

    fn cleanup(dir: PathBuf, conn: Connection) {
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Seeds one slave with two holding-register rows (addresses 10 and 11).
    /// Returns (slave_id, row_a_id, row_b_id).
    fn seed_slave_and_rows(conn: &Connection) -> (i64, i64, i64) {
        conn.execute(
            "INSERT INTO slaves (name, unit_id, poll_interval_ms, connection_kind, address_offset, created_at, updated_at)
             VALUES ('S', 1, 1000, 'tcp', 0, 'now', 'now');",
            [],
        )
        .expect("slave");
        let slave_id = conn.last_insert_rowid();
        let mut ids = Vec::new();
        for addr in [10, 11] {
            conn.execute(
                "INSERT INTO slave_register_rows (slave_id, function_code, address, alias, data_type, \"order\", display_format, updated_at)
                 VALUES (?1, 3, ?2, 'reg', 'u16', 'ABCD', 'dec', 'now');",
                (slave_id, addr),
            )
            .expect("row");
            ids.push(conn.last_insert_rowid());
        }
        (slave_id, ids[0], ids[1])
    }

    fn reg_upsert(id: &str, slave_id: i64, row_id: i64) -> AnalyzerSignalUpsert {
        AnalyzerSignalUpsert {
            id: id.to_string(),
            kind: "register".to_string(),
            slave_id: Some(slave_id),
            function_kind: "holding".to_string(),
            register_row_id: Some(row_id),
            decoder_json: "{}".to_string(),
        }
    }

    fn calc_upsert(id: &str, input_ids: &[&str]) -> AnalyzerSignalUpsert {
        let inputs: Vec<String> = input_ids
            .iter()
            .enumerate()
            .map(|(i, s)| format!(r#"{{"name":"V{i}","signalId":"{s}","value":"shown"}}"#))
            .collect();
        AnalyzerSignalUpsert {
            id: id.to_string(),
            kind: "calculated".to_string(),
            slave_id: None,
            function_kind: String::new(),
            register_row_id: None,
            decoder_json: format!(
                r#"{{"math":{{"version":1,"inputs":[{}],"variables":[]}}}}"#,
                inputs.join(",")
            ),
        }
    }

    #[test]
    fn calculated_input_ids_parses_trims_and_dedups() {
        let json = r#"{"math":{"inputs":[{"signalId":" A "},{"signalId":"B"},{"signalId":"A"},{"name":"x"}]}}"#;
        assert_eq!(super::calculated_input_ids(json), vec!["A", "B"]);
        assert!(super::calculated_input_ids("not json").is_empty());
        assert!(super::calculated_input_ids("{}").is_empty());
    }

    #[test]
    fn register_upsert_and_list_roundtrip() {
        let (dir, mut conn) = temp_db();
        let (slave_id, row_a, _) = seed_slave_and_rows(&conn);

        let out = upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("A", slave_id, row_a))
            .expect("upsert");
        assert_eq!(out.kind, "register");
        assert_eq!(out.slave_id, Some(slave_id));
        assert_eq!(out.register_row_id, Some(row_a));
        assert_eq!(out.address, Some(10));
        assert_eq!(out.function_code, Some(3));
        assert_eq!(out.alias.as_deref(), Some("reg"));
        assert_eq!(out.data_type.as_deref(), Some("u16"));
        assert_eq!(out.order.as_deref(), Some("ABCD"));
        assert_eq!(out.display_format.as_deref(), Some("dec"));
        assert_eq!(out.connection_kind, "tcp");
        assert!(out.input_signal_ids.is_empty());

        let list = list_analyzer_signals_in_conn(&conn).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "A");
        assert_eq!(list[0].kind, "register");
        assert!(list[0].input_signal_ids.is_empty());
        cleanup(dir, conn);
    }

    #[test]
    fn register_duplicate_message_unchanged() {
        let (dir, mut conn) = temp_db();
        let (slave_id, row_a, _) = seed_slave_and_rows(&conn);
        upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("A", slave_id, row_a)).expect("a");
        let err = upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("A2", slave_id, row_a))
            .expect_err("dup");
        assert_eq!(
            err,
            format!("Signal already exists for Slave {slave_id} HOLDING Addr 10 (existing: A)")
        );
        cleanup(dir, conn);
    }

    #[test]
    fn calculated_upsert_stores_inputs() {
        let (dir, mut conn) = temp_db();
        let (slave_id, row_a, row_b) = seed_slave_and_rows(&conn);
        upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("A", slave_id, row_a)).expect("a");
        upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("B", slave_id, row_b)).expect("b");

        let out = upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("C", &["A", "B"]))
            .expect("calc");
        assert_eq!(out.kind, "calculated");
        assert_eq!(out.slave_id, None);
        assert_eq!(out.register_row_id, None);
        assert_eq!(out.address, None);
        assert_eq!(out.input_signal_ids, vec!["A", "B"]);

        let n: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM analyzer_signal_inputs WHERE signal_id = 'C';",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 2);

        // Re-upsert with one input replaces the link rows.
        let out = upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("C", &["B"])).expect("re");
        assert_eq!(out.input_signal_ids, vec!["B"]);

        let list = list_analyzer_signals_in_conn(&conn).expect("list");
        assert_eq!(list.len(), 3);
        cleanup(dir, conn);
    }

    #[test]
    fn calculated_upsert_rejects_unknown_calculated_or_self_inputs() {
        let (dir, mut conn) = temp_db();
        let (slave_id, row_a, _) = seed_slave_and_rows(&conn);
        upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("A", slave_id, row_a)).expect("a");
        upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("C", &["A"])).expect("c");

        let err = upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("D", &["Z"]))
            .expect_err("unknown");
        assert!(err.contains("Input signal \"Z\" not found"), "{err}");

        let err = upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("D", &["C"]))
            .expect_err("calculated input");
        assert!(err.contains("must be a register signal"), "{err}");

        let err = upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("D", &["D"]))
            .expect_err("self");
        assert!(err.contains("cannot use itself"), "{err}");

        let err = upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("D", &[]))
            .expect_err("none");
        assert!(err.contains("needs at least one input"), "{err}");

        // Nothing was written for the rejected signal.
        let list = list_analyzer_signals_in_conn(&conn).expect("list");
        assert!(list.iter().all(|s| s.id != "D"));
        cleanup(dir, conn);
    }

    #[test]
    fn calculated_upsert_rejects_bad_math_shape() {
        let (dir, mut conn) = temp_db();
        let (slave_id, row_a, _) = seed_slave_and_rows(&conn);
        upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("A", slave_id, row_a)).expect("a");

        let input = r#"[{"name":"V","signalId":"A","value":"shown"}]"#;
        let bad = [
            format!(r#"{{"math":{{"version":2,"inputs":{input},"variables":[]}}}}"#),
            format!(r#"{{"math":{{"inputs":{input},"variables":[]}}}}"#),
            format!(r#"{{"math":{{"version":"1","inputs":{input},"variables":[]}}}}"#),
            format!(r#"{{"math":{{"version":1,"inputs":{input}}}}}"#),
            format!(r#"{{"math":{{"version":1,"inputs":{input},"variables":{{}}}}}}"#),
        ];
        for json in bad {
            let mut s = calc_upsert("D", &["A"]);
            s.decoder_json = json.clone();
            let err = upsert_analyzer_signal_in_conn(&mut conn, &s).expect_err(&json);
            assert_eq!(err, "invalid math configuration", "{json}");
        }
        let list = list_analyzer_signals_in_conn(&conn).expect("list");
        assert!(list.iter().all(|s| s.id != "D"));

        upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("D", &["A"])).expect("valid shape");
        cleanup(dir, conn);
    }

    #[test]
    fn kind_cannot_change() {
        let (dir, mut conn) = temp_db();
        let (slave_id, row_a, _) = seed_slave_and_rows(&conn);
        upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("A", slave_id, row_a)).expect("a");
        upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("B", slave_id, row_a + 1)).expect("b");

        let err = upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("A", &["B"]))
            .expect_err("kind change");
        assert_eq!(err, "Signal kind can't be changed");
        cleanup(dir, conn);
    }

    #[test]
    fn register_save_cannot_drop_a_variable_a_calculated_signal_reads() {
        let (dir, mut conn) = temp_db();
        let (slave_id, row_a, row_b) = seed_slave_and_rows(&conn);
        let with_c = r#"{"math":{"version":1,"inputs":[],"variables":[{"name":"C","kind":"calc","start":{"ref":"register"},"steps":[]}]}}"#;
        let mut a = reg_upsert("A", slave_id, row_a);
        a.decoder_json = with_c.to_string();
        upsert_analyzer_signal_in_conn(&mut conn, &a).expect("a");

        let mut f = calc_upsert("F", &["A"]);
        f.decoder_json = r#"{"show":"FH","math":{"version":1,"inputs":[{"name":"T","signalId":"A","value":"C"}],"variables":[{"name":"FH","kind":"calc","start":{"ref":"T"},"steps":[]}]}}"#.to_string();
        upsert_analyzer_signal_in_conn(&mut conn, &f).expect("f");

        // Renaming C to D in A would break F.
        a.decoder_json = with_c.replace("\"C\"", "\"D\"");
        let err = upsert_analyzer_signal_in_conn(&mut conn, &a).expect_err("blocked");
        assert_eq!(
            err,
            "F uses variable \"C\". Keep that variable, or change the calculated signal's inputs first."
        );

        // Other edits that keep C are fine (e.g. a unit).
        a.decoder_json = with_c.replacen("{\"math\"", "{\"unit\":\"°C\",\"math\"", 1);
        upsert_analyzer_signal_in_conn(&mut conn, &a).expect("keeps C");

        // A signal read only via "shown" can drop all its math.
        let mut b = reg_upsert("B", slave_id, row_b);
        b.decoder_json = with_c.to_string();
        upsert_analyzer_signal_in_conn(&mut conn, &b).expect("b");
        upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("G", &["B"])).expect("g");
        b.decoder_json = "{}".to_string();
        upsert_analyzer_signal_in_conn(&mut conn, &b).expect("shown-only dependents don't block");
        cleanup(dir, conn);
    }

    #[test]
    fn delete_blocked_when_used_as_input() {
        let (dir, mut conn) = temp_db();
        let (slave_id, row_a, _) = seed_slave_and_rows(&conn);
        upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("A", slave_id, row_a)).expect("a");
        upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("C", &["A"])).expect("c");

        let err = delete_analyzer_signal_in_conn(&conn, "A").expect_err("blocked");
        assert_eq!(
            err,
            "Signal \"A\" is used by calculated signal(s): C. Remove it from their inputs first."
        );

        delete_analyzer_signal_in_conn(&conn, "C").expect("delete C");
        delete_analyzer_signal_in_conn(&conn, "A").expect("delete A");

        let n: i64 = conn
            .query_row("SELECT COUNT(1) FROM analyzer_signal_inputs;", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        cleanup(dir, conn);
    }

    #[test]
    fn tile_signals_include_calculated() {
        let (dir, mut conn) = temp_db();
        let (slave_id, row_a, _) = seed_slave_and_rows(&conn);
        upsert_analyzer_signal_in_conn(&mut conn, &reg_upsert("A", slave_id, row_a)).expect("a");
        upsert_analyzer_signal_in_conn(&mut conn, &calc_upsert("C", &["A"])).expect("c");
        conn.execute(
            "INSERT INTO analyzer_tiles (kind, title, config_json, polling_enabled, created_at, updated_at)
             VALUES ('widget', 't', '{}', 0, 'now', 'now');",
            [],
        )
        .expect("tile");
        let tile_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO analyzer_tile_signals (tile_id, signal_id) VALUES (?1, 'C');",
            (tile_id,),
        )
        .expect("link");

        let infos = list_analyzer_tile_signals_in_conn(&conn, tile_id).expect("tile signals");
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0].signal_id, "C");
        assert_eq!(infos[0].kind, "calculated");
        assert_eq!(infos[0].function_code, 0);
        assert_eq!(infos[0].address, -1);
        assert_eq!(infos[0].display_format, "dec");
        cleanup(dir, conn);
    }

    #[test]
    fn normalizes_tile_inputs() {
        let (kind, title, config) = normalize_tile_inputs(
            " Widget ".to_string(),
            "  Title  ".to_string(),
            "  {}  ".to_string(),
        )
        .expect("normalize");

        assert_eq!(kind, "widget");
        assert_eq!(title, "Title");
        assert_eq!(config, "{}");
    }

    #[test]
    fn rejects_invalid_tile_kind() {
        let err = normalize_tile_inputs("bad".to_string(), "t".to_string(), "{}".to_string())
            .expect_err("expected error");
        assert_eq!(err, "tile kind must be 'widget' or 'chart'");
    }
}

#[tauri::command]
pub fn save_analyzer_tile_layouts(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
    layouts: Vec<AnalyzerTileLayoutUpsert>,
) -> Result<(), String> {
    let mut conn = open_workspace_db(&app, &name)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO analyzer_tile_layouts (tile_id, breakpoint, x, y, w, h)\n                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)\n                 ON CONFLICT(tile_id, breakpoint) DO UPDATE SET\n                   x=excluded.x, y=excluded.y, w=excluded.w, h=excluded.h;",
            )
            .map_err(|e| format!("failed to prepare layout upsert: {e}"))?;

        for l in layouts {
            stmt.execute(params![tile_id, l.breakpoint, l.x, l.y, l.w, l.h])
                .map_err(|e| format!("failed to upsert layout: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn delete_analyzer_tile(app: tauri::AppHandle, name: String, tile_id: i64) -> Result<(), String> {
    let conn = open_workspace_db(&app, &name)?;
    conn.execute("DELETE FROM analyzer_tiles WHERE id = ?1;", (tile_id,))
        .map_err(|e| format!("failed to delete analyzer tile: {e}"))?;
    Ok(())
}

/// Reads `math.inputs[*].signalId` from a calculated signal's `decoder_json`.
/// Trimmed, de-duplicated, order-preserving. Bad JSON gives an empty vec.
pub(crate) fn calculated_input_ids(decoder_json: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(decoder_json) else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    if let Some(inputs) = v.pointer("/math/inputs").and_then(|i| i.as_array()) {
        for input in inputs {
            if let Some(id) = input.get("signalId").and_then(|s| s.as_str()) {
                let id = id.trim();
                if !id.is_empty() && !out.iter().any(|e| e == id) {
                    out.push(id.to_string());
                }
            }
        }
    }
    out
}

/// Minimal shape check for a calculated signal's `decoder_json`: `math.version`
/// must be 1 and `math.variables` an array. The frontend owns full validation;
/// this keeps an unknown or broken math block from being stored.
fn has_valid_math_shape(decoder_json: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(decoder_json) else {
        return false;
    };
    v.pointer("/math/version").and_then(|n| n.as_u64()) == Some(1)
        && v.pointer("/math/variables").is_some_and(|vars| vars.is_array())
}

pub(crate) fn delete_analyzer_signal_in_conn(conn: &Connection, id: &str) -> Result<(), String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("signal_id is required".to_string());
    }

    let mut stmt = conn
        .prepare(
            "SELECT signal_id FROM analyzer_signal_inputs
             WHERE input_signal_id = ?1
             ORDER BY signal_id ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;
    let users: Vec<String> = stmt
        .query_map((id,), |row| row.get(0))
        .map_err(|e| format!("failed to check signal usage: {e}"))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("failed to check signal usage: {e}"))?;
    if !users.is_empty() {
        return Err(format!(
            "Signal \"{}\" is used by calculated signal(s): {}. Remove it from their inputs first.",
            id,
            users.join(", ")
        ));
    }

    conn.execute("DELETE FROM analyzer_signals WHERE id = ?1;", (id,))
        .map_err(|e| format!("failed to delete analyzer signal: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_analyzer_signal(app: tauri::AppHandle, name: String, signal_id: String) -> Result<(), String> {
    let conn = open_workspace_db(&app, &name)?;
    delete_analyzer_signal_in_conn(&conn, &signal_id)
}

#[tauri::command]
pub fn set_analyzer_tile_polling_enabled(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
    polling_enabled: bool,
    now_iso: String,
) -> Result<AnalyzerTile, String> {
    if tile_id <= 0 {
        return Err("tile_id must be > 0".to_string());
    }

    let conn = open_workspace_db(&app, &name)?;
    conn.execute(
        "UPDATE analyzer_tiles\n         SET polling_enabled=?1, updated_at=?2\n         WHERE id=?3;",
        params![if polling_enabled { 1 } else { 0 }, now_iso, tile_id],
    )
    .map_err(|e| format!("failed to update tile polling: {e}"))?;

    conn.query_row(
        "SELECT id, kind, title, config_json, polling_enabled, created_at, updated_at\n         FROM analyzer_tiles\n         WHERE id = ?1;",
        (tile_id,),
        |row| {
            let polling_int: i64 = row.get(4)?;
            Ok(AnalyzerTile {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                config_json: row.get(3)?,
                polling_enabled: polling_int != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| format!("failed to read updated tile: {e}"))
}

pub(crate) fn list_analyzer_tile_signals_in_conn(
    conn: &Connection,
    tile_id: i64,
) -> Result<Vec<AnalyzerTileSignalInfo>, String> {
    if tile_id <= 0 {
        return Err("tile_id must be > 0".to_string());
    }

    let mut stmt = conn
        .prepare(
            "SELECT
                ats.tile_id,
                ats.signal_id,
                ats.role,
                s.kind,
                COALESCE(rr.function_code, 0),
                COALESCE(rr.address, -1),
                COALESCE(rr.alias, ''),
                COALESCE(rr.data_type, ''),
                COALESCE(rr.\"order\", ''),
                COALESCE(rr.display_format, 'dec'),
                s.decoder_json,
                s.last_value_json,
                s.last_updated_ts_ms,
                s.state,
                s.error_json
             FROM analyzer_tile_signals ats
             JOIN analyzer_signals s ON s.id = ats.signal_id
             LEFT JOIN slave_register_rows rr ON rr.id = s.register_row_id
             WHERE ats.tile_id = ?1
             ORDER BY ats.signal_id ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map((tile_id,), |row| {
            Ok(AnalyzerTileSignalInfo {
                tile_id: row.get(0)?,
                signal_id: row.get(1)?,
                role: row.get(2)?,
                kind: row.get(3)?,
                function_code: row.get(4)?,
                address: row.get(5)?,
                alias: row.get(6)?,
                data_type: row.get(7)?,
                order: row.get(8)?,
                display_format: row.get(9)?,
                decoder_json: row.get(10)?,
                last_value_json: row.get(11).ok(),
                last_updated_ts_ms: row.get(12).ok(),
                state: row.get(13)?,
                error_json: row.get(14).ok(),
            })
        })
        .map_err(|e| format!("failed to query analyzer tile signals: {e}"))?;

    let mut out: Vec<AnalyzerTileSignalInfo> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer tile signal row: {e}"))?);
    }

    Ok(out)
}

#[tauri::command]
pub fn list_analyzer_tile_signals(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
) -> Result<Vec<AnalyzerTileSignalInfo>, String> {
    let conn = open_workspace_db(&app, &name)?;
    list_analyzer_tile_signals_in_conn(&conn, tile_id)
}

/// Loads signals (all, or just `only_id`) with their register details and input ids.
fn query_signals(conn: &Connection, only_id: Option<&str>) -> Result<Vec<AnalyzerSignal>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.kind, s.slave_id, COALESCE(sl.connection_kind, s.connection_kind),
                    s.function_kind, s.register_row_id,
                    rr.address, rr.function_code, rr.alias, rr.data_type, rr.\"order\", rr.display_format,
                    s.decoder_json,
                    s.last_value_json, s.last_updated_ts_ms,
                    s.state, s.error_json
             FROM analyzer_signals s
             LEFT JOIN slaves sl ON sl.id = s.slave_id
             LEFT JOIN slave_register_rows rr ON rr.id = s.register_row_id
             WHERE (?1 IS NULL OR s.id = ?1)
             ORDER BY s.id ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;

    let rows = stmt
        .query_map((only_id,), |row| {
            Ok(AnalyzerSignal {
                id: row.get(0)?,
                kind: row.get(1)?,
                slave_id: row.get(2)?,
                connection_kind: row.get(3)?,
                function_kind: row.get(4)?,
                register_row_id: row.get(5)?,
                address: row.get(6)?,
                function_code: row.get(7)?,
                alias: row.get(8)?,
                data_type: row.get(9)?,
                order: row.get(10)?,
                display_format: row.get(11)?,
                decoder_json: row.get(12)?,
                input_signal_ids: Vec::new(),
                last_value_json: row.get(13).ok(),
                last_updated_ts_ms: row.get(14).ok(),
                state: row.get(15)?,
                error_json: row.get(16).ok(),
            })
        })
        .map_err(|e| format!("failed to query analyzer signals: {e}"))?;

    let mut out: Vec<AnalyzerSignal> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer signal row: {e}"))?);
    }

    let mut in_stmt = conn
        .prepare("SELECT signal_id, input_signal_id FROM analyzer_signal_inputs ORDER BY rowid ASC;")
        .map_err(|e| format!("failed to prepare query: {e}"))?;
    let links = in_stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("failed to query analyzer signal inputs: {e}"))?;
    for l in links {
        let (signal_id, input_id) =
            l.map_err(|e| format!("failed to read analyzer signal input row: {e}"))?;
        if let Some(sig) = out.iter_mut().find(|s| s.id == signal_id) {
            sig.input_signal_ids.push(input_id);
        }
    }

    Ok(out)
}

/// Variable names defined by `decoder_json`'s `math.variables[*].name`.
fn math_variable_names(decoder_json: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(decoder_json) else {
        return Vec::new();
    };
    v.pointer("/math/variables")
        .and_then(|vars| vars.as_array())
        .map(|vars| {
            vars.iter()
                .filter_map(|var| var.get("name").and_then(|n| n.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Refuses a register-signal save that drops a variable a calculated signal reads
/// (`math.inputs[*].value` naming a variable of this signal) — it would break silently.
fn check_dependent_variables(conn: &Connection, id: &str, new_decoder_json: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.decoder_json FROM analyzer_signals s
             JOIN analyzer_signal_inputs i ON i.signal_id = s.id
             WHERE i.input_signal_id = ?1
             ORDER BY s.id ASC;",
        )
        .map_err(|e| format!("failed to prepare query: {e}"))?;
    let users: Vec<(String, String)> = stmt
        .query_map((id,), |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("failed to check signal usage: {e}"))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("failed to check signal usage: {e}"))?;
    if users.is_empty() {
        return Ok(());
    }

    let defined = math_variable_names(new_decoder_json);
    let mut missing: Vec<String> = Vec::new();
    for (user_id, user_json) in &users {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(user_json) else { continue };
        let Some(inputs) = v.pointer("/math/inputs").and_then(|i| i.as_array()) else { continue };
        for input in inputs {
            if input.get("signalId").and_then(|s| s.as_str()).map(str::trim) != Some(id) {
                continue;
            }
            let Some(value) = input.get("value").and_then(|s| s.as_str()) else { continue };
            if value == "shown" || value == "register" || defined.iter().any(|d| d == value) {
                continue;
            }
            let entry = format!("{user_id} uses variable \"{value}\"");
            if !missing.contains(&entry) {
                missing.push(entry);
            }
        }
    }
    if missing.is_empty() {
        return Ok(());
    }
    Err(format!(
        "{}. Keep {}, or change the calculated signal's inputs first.",
        missing.join("; "),
        if missing.len() == 1 { "that variable" } else { "those variables" }
    ))
}

fn upsert_register_signal(
    conn: &Connection,
    id: &str,
    s: &AnalyzerSignalUpsert,
) -> Result<(), String> {
    check_dependent_variables(conn, id, s.decoder_json.trim())?;
    let slave_id = s.slave_id.ok_or_else(|| "slave_id is required".to_string())?;
    let register_row_id = s
        .register_row_id
        .ok_or_else(|| "register_row_id is required".to_string())?;

    let effective_connection_kind: String = conn
        .query_row(
            "SELECT connection_kind FROM slaves WHERE id = ?1;",
            (slave_id,),
            |row| row.get(0),
        )
        .map_err(|e| format!("failed to resolve slave connection_kind: {e}"))?;

    let function_kind_lc = s.function_kind.trim().to_lowercase();
    if function_kind_lc.is_empty() {
        return Err("function_kind is required".to_string());
    }

    let address: i64 = conn
        .query_row(
            "SELECT address FROM slave_register_rows WHERE id = ?1;",
            (register_row_id,),
            |row| row.get(0),
        )
        .map_err(|e| format!("failed to resolve register row address: {e}"))?;

    let existing_id: Option<String> = conn
        .query_row(
            "SELECT s.id
             FROM analyzer_signals s
             JOIN slave_register_rows rr ON rr.id = s.register_row_id
             WHERE s.slave_id = ?1
               AND lower(s.function_kind) = ?2
               AND rr.address = ?3
               AND s.id <> ?4
             LIMIT 1;",
            params![slave_id, function_kind_lc, address, id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("failed to check duplicate analyzer signal: {e}"))?;

    if let Some(existing_id) = existing_id {
        return Err(format!(
            "Signal already exists for Slave {} {} Addr {} (existing: {})",
            slave_id,
            s.function_kind.trim().to_uppercase(),
            address,
            existing_id
        ));
    }

    conn.execute(
        "INSERT INTO analyzer_signals (
            id,
            slave_id,
            connection_kind,
            function_kind,
            register_row_id,
            decoder_json,
            last_value_json,
            last_updated_ts_ms,
            state,
            error_json
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            NULL, NULL, 'DISCONNECTED', NULL
        )
        ON CONFLICT(id) DO UPDATE SET
            slave_id=excluded.slave_id,
            connection_kind=excluded.connection_kind,
            function_kind=excluded.function_kind,
            register_row_id=excluded.register_row_id,
            decoder_json=excluded.decoder_json;",
        params![
            id,
            slave_id,
            effective_connection_kind.trim(),
            s.function_kind.trim(),
            register_row_id,
            s.decoder_json.trim(),
        ],
    )
    .map_err(|e| format!("failed to upsert analyzer signal: {e}"))?;
    Ok(())
}

fn upsert_calculated_signal(
    conn: &mut Connection,
    id: &str,
    s: &AnalyzerSignalUpsert,
) -> Result<(), String> {
    if !has_valid_math_shape(&s.decoder_json) {
        return Err("invalid math configuration".to_string());
    }
    let inputs = calculated_input_ids(&s.decoder_json);
    if inputs.is_empty() {
        return Err("Calculated signal needs at least one input".to_string());
    }

    for input in &inputs {
        if input == id {
            return Err("Calculated signal cannot use itself as an input".to_string());
        }
        let kind: Option<String> = conn
            .query_row(
                "SELECT kind FROM analyzer_signals WHERE id = ?1;",
                (input.as_str(),),
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("failed to resolve input signal: {e}"))?;
        match kind.as_deref() {
            None => return Err(format!("Input signal \"{input}\" not found")),
            Some("register") => {}
            Some(_) => {
                return Err(format!("Input signal \"{input}\" must be a register signal"));
            }
        }
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;
    tx.execute(
        "INSERT INTO analyzer_signals (
            id, kind, slave_id, connection_kind, function_kind, register_row_id,
            decoder_json, last_value_json, last_updated_ts_ms, state, error_json
        ) VALUES (
            ?1, 'calculated', NULL, '', '', NULL, ?2,
            NULL, NULL, 'DISCONNECTED', NULL
        )
        ON CONFLICT(id) DO UPDATE SET decoder_json=excluded.decoder_json;",
        params![id, s.decoder_json.trim()],
    )
    .map_err(|e| format!("failed to upsert analyzer signal: {e}"))?;
    tx.execute("DELETE FROM analyzer_signal_inputs WHERE signal_id = ?1;", (id,))
        .map_err(|e| format!("failed to replace signal inputs: {e}"))?;
    for input in &inputs {
        tx.execute(
            "INSERT INTO analyzer_signal_inputs (signal_id, input_signal_id) VALUES (?1, ?2);",
            params![id, input],
        )
        .map_err(|e| format!("failed to save signal input: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))
}

pub(crate) fn upsert_analyzer_signal_in_conn(
    conn: &mut Connection,
    s: &AnalyzerSignalUpsert,
) -> Result<AnalyzerSignal, String> {
    let id = s.id.trim();
    if id.is_empty() {
        return Err("signal id is required".to_string());
    }
    let kind = s.kind.trim();
    if kind != "register" && kind != "calculated" {
        return Err("signal kind must be 'register' or 'calculated'".to_string());
    }

    let existing_kind: Option<String> = conn
        .query_row("SELECT kind FROM analyzer_signals WHERE id = ?1;", (id,), |row| row.get(0))
        .optional()
        .map_err(|e| format!("failed to check signal kind: {e}"))?;
    if existing_kind.is_some_and(|k| k != kind) {
        return Err("Signal kind can't be changed".to_string());
    }

    if kind == "register" {
        upsert_register_signal(conn, id, s)?;
    } else {
        upsert_calculated_signal(conn, id, s)?;
    }

    query_signals(conn, Some(id))?
        .into_iter()
        .next()
        .ok_or_else(|| "failed to read analyzer signal: not found".to_string())
}

#[tauri::command]
pub fn upsert_analyzer_signal(
    app: tauri::AppHandle,
    name: String,
    signal: AnalyzerSignalUpsert,
) -> Result<AnalyzerSignal, String> {
    let mut conn = open_workspace_db(&app, &name)?;
    upsert_analyzer_signal_in_conn(&mut conn, &signal)
}

pub(crate) fn list_analyzer_signals_in_conn(conn: &Connection) -> Result<Vec<AnalyzerSignal>, String> {
    query_signals(conn, None)
}

#[tauri::command]
pub fn list_analyzer_signals(app: tauri::AppHandle, name: String) -> Result<Vec<AnalyzerSignal>, String> {
    let conn = open_workspace_db(&app, &name)?;
    list_analyzer_signals_in_conn(&conn)
}

#[tauri::command]
pub fn can_delete_slave_register_row(
    app: tauri::AppHandle,
    name: String,
    register_row_id: i64,
) -> Result<bool, String> {
    let conn = open_workspace_db(&app, &name)?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM analyzer_signals WHERE register_row_id = ?1;",
            (register_row_id,),
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(count == 0)
}
