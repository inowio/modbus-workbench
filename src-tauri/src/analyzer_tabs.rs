use crate::analyzer::tile_from_row;
use crate::db::open_workspace_db;
use crate::models::AnalyzerTile;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use std::collections::HashSet;

const BREAKPOINTS: [&str; 2] = ["desktop", "mobile"];
const MAX_TAB_NAME_CHARS: usize = 32;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTab {
    pub id: i64,
    pub name: String,
    pub position: i64,
}

fn tab_from_row(row: &rusqlite::Row) -> rusqlite::Result<AnalyzerTab> {
    Ok(AnalyzerTab {
        id: row.get(0)?,
        name: row.get(1)?,
        position: row.get(2)?,
    })
}

fn tab_exists(conn: &Connection, tab_id: i64) -> Result<bool, String> {
    conn.query_row("SELECT 1 FROM analyzer_tabs WHERE id = ?1;", (tab_id,), |_| Ok(()))
        .optional()
        .map(|r| r.is_some())
        .map_err(|e| format!("failed to look up tab: {e}"))
}

fn require_tab(conn: &Connection, tab_id: i64) -> Result<(), String> {
    if tab_exists(conn, tab_id)? {
        Ok(())
    } else {
        Err("Tab not found".to_string())
    }
}

fn require_tile(conn: &Connection, tile_id: i64) -> Result<(), String> {
    let found = conn
        .query_row("SELECT 1 FROM analyzer_tiles WHERE id = ?1;", (tile_id,), |_| Ok(()))
        .optional()
        .map_err(|e| format!("failed to look up tile: {e}"))?;
    found.map(|_| ()).ok_or_else(|| "Tile not found".to_string())
}

/// Trims and validates a tab name; `except_id` is the tab being renamed (if any).
fn validate_tab_name(conn: &Connection, raw: &str, except_id: Option<i64>) -> Result<String, String> {
    let name = raw.trim().to_string();
    if name.is_empty() {
        return Err("Tab name is required".to_string());
    }
    if name.chars().count() > MAX_TAB_NAME_CHARS {
        return Err(format!("Tab name must be at most {MAX_TAB_NAME_CHARS} characters"));
    }
    let lowered = name.to_lowercase();
    for tab in list_analyzer_tabs_in_conn(conn)? {
        if Some(tab.id) != except_id && tab.name.to_lowercase() == lowered {
            return Err(format!("A tab named \"{name}\" already exists"));
        }
    }
    Ok(name)
}

fn read_tab(conn: &Connection, tab_id: i64) -> Result<AnalyzerTab, String> {
    conn.query_row(
        "SELECT id, name, position FROM analyzer_tabs WHERE id = ?1;",
        (tab_id,),
        tab_from_row,
    )
    .optional()
    .map_err(|e| format!("failed to read tab: {e}"))?
    .ok_or_else(|| "Tab not found".to_string())
}

pub(crate) fn list_analyzer_tabs_in_conn(conn: &Connection) -> Result<Vec<AnalyzerTab>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, position FROM analyzer_tabs ORDER BY position, id;")
        .map_err(|e| format!("failed to prepare query: {e}"))?;
    let rows = stmt
        .query_map([], tab_from_row)
        .map_err(|e| format!("failed to query analyzer tabs: {e}"))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("failed to read analyzer tab row: {e}"))?);
    }
    Ok(out)
}

pub(crate) fn create_analyzer_tab_in_conn(
    conn: &Connection,
    tab_name: &str,
    now_iso: &str,
) -> Result<AnalyzerTab, String> {
    let name = validate_tab_name(conn, tab_name, None)?;
    conn.execute(
        "INSERT INTO analyzer_tabs (name, position, created_at, updated_at)
         VALUES (?1, (SELECT COALESCE(MAX(position), -1) + 1 FROM analyzer_tabs), ?2, ?2);",
        params![name, now_iso],
    )
    .map_err(|e| format!("failed to create analyzer tab: {e}"))?;
    read_tab(conn, conn.last_insert_rowid())
}

pub(crate) fn rename_analyzer_tab_in_conn(
    conn: &Connection,
    tab_id: i64,
    tab_name: &str,
    now_iso: &str,
) -> Result<AnalyzerTab, String> {
    require_tab(conn, tab_id)?;
    let name = validate_tab_name(conn, tab_name, Some(tab_id))?;
    conn.execute(
        "UPDATE analyzer_tabs SET name = ?1, updated_at = ?2 WHERE id = ?3;",
        params![name, now_iso, tab_id],
    )
    .map_err(|e| format!("failed to rename analyzer tab: {e}"))?;
    read_tab(conn, tab_id)
}

pub(crate) fn reorder_analyzer_tabs_in_conn(
    conn: &mut Connection,
    tab_ids: &[i64],
) -> Result<(), String> {
    let existing: HashSet<i64> = list_analyzer_tabs_in_conn(conn)?
        .into_iter()
        .map(|t| t.id)
        .collect();
    let given: HashSet<i64> = tab_ids.iter().copied().collect();
    if given.len() != tab_ids.len() || given != existing {
        return Err("Tab order must list every tab exactly once".to_string());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;
    for (pos, id) in tab_ids.iter().enumerate() {
        tx.execute(
            "UPDATE analyzer_tabs SET position = ?1 WHERE id = ?2;",
            params![pos as i64, id],
        )
        .map_err(|e| format!("failed to reorder analyzer tabs: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))
}

/// Places `tile_ids` below the existing tiles of `tab_id`, per breakpoint,
/// keeping the moved tiles' relative vertical order and their x/w/h.
fn place_tiles_at_bottom(tx: &Transaction, tab_id: i64, tile_ids: &[i64]) -> Result<(), String> {
    if tile_ids.is_empty() {
        return Ok(());
    }
    let moved: HashSet<i64> = tile_ids.iter().copied().collect();

    for bp in BREAKPOINTS {
        let mut base = 0i64;
        {
            let mut stmt = tx
                .prepare(
                    "SELECT l.tile_id, l.y + l.h
                     FROM analyzer_tile_layouts l
                     JOIN analyzer_tiles t ON t.id = l.tile_id
                     WHERE t.tab_id = ?1 AND l.breakpoint = ?2;",
                )
                .map_err(|e| format!("failed to prepare layout query: {e}"))?;
            let rows = stmt
                .query_map(params![tab_id, bp], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
                .map_err(|e| format!("failed to query tab layouts: {e}"))?;
            for r in rows {
                let (id, bottom) = r.map_err(|e| format!("failed to read layout row: {e}"))?;
                if !moved.contains(&id) {
                    base = base.max(bottom);
                }
            }
        }

        let mut moved_rows: Vec<(i64, i64)> = Vec::new();
        for id in tile_ids {
            let y: Option<i64> = tx
                .query_row(
                    "SELECT y FROM analyzer_tile_layouts WHERE tile_id = ?1 AND breakpoint = ?2;",
                    params![id, bp],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| format!("failed to read moved layout: {e}"))?;
            if let Some(y) = y {
                moved_rows.push((*id, y));
            }
        }
        let Some(min_y) = moved_rows.iter().map(|(_, y)| *y).min() else {
            continue;
        };
        for (id, y) in moved_rows {
            tx.execute(
                "UPDATE analyzer_tile_layouts SET y = ?1 WHERE tile_id = ?2 AND breakpoint = ?3;",
                params![base + (y - min_y), id, bp],
            )
            .map_err(|e| format!("failed to place tile layout: {e}"))?;
        }
    }
    Ok(())
}

pub(crate) fn delete_analyzer_tab_in_conn(
    conn: &mut Connection,
    tab_id: i64,
    move_tiles_to: Option<i64>,
    delete_tiles: bool,
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;
    require_tab(&tx, tab_id)?;

    let tab_count: i64 = tx
        .query_row("SELECT COUNT(*) FROM analyzer_tabs;", [], |r| r.get(0))
        .map_err(|e| format!("failed to count tabs: {e}"))?;
    if tab_count <= 1 {
        return Err("The last tab can't be deleted".to_string());
    }

    let tile_ids: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT id FROM analyzer_tiles WHERE tab_id = ?1 ORDER BY id;")
            .map_err(|e| format!("failed to prepare tile query: {e}"))?;
        let rows = stmt
            .query_map((tab_id,), |r| r.get(0))
            .map_err(|e| format!("failed to query tab tiles: {e}"))?;
        let mut ids = Vec::new();
        for r in rows {
            ids.push(r.map_err(|e| format!("failed to read tile id: {e}"))?);
        }
        ids
    };

    if !tile_ids.is_empty() {
        if let Some(target) = move_tiles_to {
            if target == tab_id {
                return Err("Tab not found".to_string());
            }
            require_tab(&tx, target)?;
            tx.execute(
                "UPDATE analyzer_tiles SET tab_id = ?1 WHERE tab_id = ?2;",
                params![target, tab_id],
            )
            .map_err(|e| format!("failed to move tiles: {e}"))?;
            place_tiles_at_bottom(&tx, target, &tile_ids)?;
        } else if delete_tiles {
            tx.execute("DELETE FROM analyzer_tiles WHERE tab_id = ?1;", (tab_id,))
                .map_err(|e| format!("failed to delete tiles: {e}"))?;
        } else {
            return Err("Choose whether to move or delete this tab's tiles".to_string());
        }
    }

    tx.execute("DELETE FROM analyzer_tabs WHERE id = ?1;", (tab_id,))
        .map_err(|e| format!("failed to delete analyzer tab: {e}"))?;
    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))
}

pub(crate) fn move_analyzer_tile_to_tab_in_conn(
    conn: &mut Connection,
    tile_id: i64,
    tab_id: i64,
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;
    require_tile(&tx, tile_id)?;
    require_tab(&tx, tab_id)?;
    tx.execute(
        "UPDATE analyzer_tiles SET tab_id = ?1 WHERE id = ?2;",
        params![tab_id, tile_id],
    )
    .map_err(|e| format!("failed to move tile: {e}"))?;
    place_tiles_at_bottom(&tx, tab_id, &[tile_id])?;
    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))
}

pub(crate) fn duplicate_analyzer_tile_in_conn(
    conn: &mut Connection,
    tile_id: i64,
    tab_id: i64,
    now_iso: &str,
) -> Result<AnalyzerTile, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("failed to start transaction: {e}"))?;
    require_tile(&tx, tile_id)?;
    require_tab(&tx, tab_id)?;

    tx.execute(
        "INSERT INTO analyzer_tiles (kind, title, config_json, polling_enabled, created_at, updated_at, tab_id)
         SELECT kind, title || ' (copy)', config_json, polling_enabled, ?1, ?1, ?2
         FROM analyzer_tiles WHERE id = ?3;",
        params![now_iso, tab_id, tile_id],
    )
    .map_err(|e| format!("failed to duplicate tile: {e}"))?;
    let new_id = tx.last_insert_rowid();

    tx.execute(
        "INSERT INTO analyzer_tile_layouts (tile_id, breakpoint, x, y, w, h)
         SELECT ?1, breakpoint, x, y, w, h FROM analyzer_tile_layouts WHERE tile_id = ?2;",
        params![new_id, tile_id],
    )
    .map_err(|e| format!("failed to duplicate tile layouts: {e}"))?;
    tx.execute(
        "INSERT INTO analyzer_tile_signals (tile_id, signal_id, role, poll_interval_ms)
         SELECT ?1, signal_id, role, poll_interval_ms FROM analyzer_tile_signals WHERE tile_id = ?2;",
        params![new_id, tile_id],
    )
    .map_err(|e| format!("failed to duplicate tile signals: {e}"))?;

    place_tiles_at_bottom(&tx, tab_id, &[new_id])?;

    let tile = tx
        .query_row(
            "SELECT id, kind, title, config_json, polling_enabled, created_at, updated_at, tab_id
             FROM analyzer_tiles WHERE id = ?1;",
            (new_id,),
            tile_from_row,
        )
        .map_err(|e| format!("failed to read duplicated tile: {e}"))?;
    tx.commit()
        .map_err(|e| format!("failed to commit transaction: {e}"))?;
    Ok(tile)
}

#[tauri::command]
pub fn list_analyzer_tabs(app: tauri::AppHandle, name: String) -> Result<Vec<AnalyzerTab>, String> {
    let conn = open_workspace_db(&app, &name)?;
    list_analyzer_tabs_in_conn(&conn)
}

#[tauri::command]
pub fn create_analyzer_tab(
    app: tauri::AppHandle,
    name: String,
    tab_name: String,
    now_iso: String,
) -> Result<AnalyzerTab, String> {
    let conn = open_workspace_db(&app, &name)?;
    create_analyzer_tab_in_conn(&conn, &tab_name, &now_iso)
}

#[tauri::command]
pub fn rename_analyzer_tab(
    app: tauri::AppHandle,
    name: String,
    tab_id: i64,
    tab_name: String,
    now_iso: String,
) -> Result<AnalyzerTab, String> {
    let conn = open_workspace_db(&app, &name)?;
    rename_analyzer_tab_in_conn(&conn, tab_id, &tab_name, &now_iso)
}

#[tauri::command]
pub fn reorder_analyzer_tabs(
    app: tauri::AppHandle,
    name: String,
    tab_ids: Vec<i64>,
) -> Result<(), String> {
    let mut conn = open_workspace_db(&app, &name)?;
    reorder_analyzer_tabs_in_conn(&mut conn, &tab_ids)
}

#[tauri::command]
pub fn delete_analyzer_tab(
    app: tauri::AppHandle,
    name: String,
    tab_id: i64,
    move_tiles_to: Option<i64>,
    delete_tiles: bool,
) -> Result<(), String> {
    let mut conn = open_workspace_db(&app, &name)?;
    delete_analyzer_tab_in_conn(&mut conn, tab_id, move_tiles_to, delete_tiles)
}

#[tauri::command]
pub fn move_analyzer_tile_to_tab(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
    tab_id: i64,
) -> Result<(), String> {
    let mut conn = open_workspace_db(&app, &name)?;
    move_analyzer_tile_to_tab_in_conn(&mut conn, tile_id, tab_id)
}

#[tauri::command]
pub fn duplicate_analyzer_tile(
    app: tauri::AppHandle,
    name: String,
    tile_id: i64,
    tab_id: i64,
    now_iso: String,
) -> Result<AnalyzerTile, String> {
    let mut conn = open_workspace_db(&app, &name)?;
    duplicate_analyzer_tile_in_conn(&mut conn, tile_id, tab_id, &now_iso)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyzer::create_analyzer_tile_in_conn;
    use crate::db::ensure_workspace_db;
    use crate::models::AnalyzerTileCreate;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db() -> (PathBuf, Connection) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("analyzer_tabs_test_{nanos}"));
        std::fs::create_dir_all(&dir).expect("temp dir");
        ensure_workspace_db(&dir, "workspace.db").expect("schema");
        let conn = Connection::open(dir.join("workspace.db")).expect("open db");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("pragma");
        (dir, conn)
    }

    fn cleanup(dir: PathBuf, conn: Connection) {
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }

    fn main_tab(conn: &Connection) -> i64 {
        list_analyzer_tabs_in_conn(conn).unwrap()[0].id
    }

    /// Inserts a tile in `tab_id` with desktop (and optionally mobile) layout.
    fn seed_tile(conn: &Connection, tab_id: i64, title: &str, desktop: (i64, i64, i64, i64)) -> i64 {
        conn.execute(
            "INSERT INTO analyzer_tiles (kind, title, config_json, polling_enabled, created_at, updated_at, tab_id)
             VALUES ('widget', ?1, '{\"a\":1}', 1, 'now', 'now', ?2);",
            params![title, tab_id],
        )
        .expect("tile");
        let id = conn.last_insert_rowid();
        let (x, y, w, h) = desktop;
        conn.execute(
            "INSERT INTO analyzer_tile_layouts (tile_id, breakpoint, x, y, w, h)
             VALUES (?1, 'desktop', ?2, ?3, ?4, ?5);",
            params![id, x, y, w, h],
        )
        .expect("layout");
        id
    }

    fn desktop_layout(conn: &Connection, tile_id: i64) -> (i64, i64, i64, i64) {
        conn.query_row(
            "SELECT x, y, w, h FROM analyzer_tile_layouts WHERE tile_id = ?1 AND breakpoint = 'desktop';",
            (tile_id,),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .expect("layout row")
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn seed_signal(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO analyzer_signals (id, kind, decoder_json) VALUES (?1, 'calculated', '{}');",
            (id,),
        )
        .expect("signal");
    }

    #[test]
    fn tab_name_rules() {
        let (dir, conn) = temp_db();
        assert_eq!(create_analyzer_tab_in_conn(&conn, "", "t").unwrap_err(), "Tab name is required");
        assert_eq!(create_analyzer_tab_in_conn(&conn, "  ", "t").unwrap_err(), "Tab name is required");
        assert_eq!(
            create_analyzer_tab_in_conn(&conn, &"x".repeat(33), "t").unwrap_err(),
            "Tab name must be at most 32 characters"
        );
        assert!(create_analyzer_tab_in_conn(&conn, &"x".repeat(32), "t").is_ok());
        assert_eq!(
            create_analyzer_tab_in_conn(&conn, "main", "t").unwrap_err(),
            "A tab named \"main\" already exists"
        );
        let main = main_tab(&conn);
        let renamed = rename_analyzer_tab_in_conn(&conn, main, "MAIN", "t").unwrap();
        assert_eq!(renamed.name, "MAIN");
        let other = create_analyzer_tab_in_conn(&conn, "Other", "t").unwrap();
        assert_eq!(
            rename_analyzer_tab_in_conn(&conn, other.id, " main ", "t").unwrap_err(),
            "A tab named \"main\" already exists"
        );
        assert_eq!(
            rename_analyzer_tab_in_conn(&conn, 9999, "Zed", "t").unwrap_err(),
            "Tab not found"
        );
        cleanup(dir, conn);
    }

    #[test]
    fn create_appends_and_reorder_requires_permutation() {
        let (dir, mut conn) = temp_db();
        let main = main_tab(&conn);
        let boiler = create_analyzer_tab_in_conn(&conn, "Boiler", "t").unwrap();
        let power = create_analyzer_tab_in_conn(&conn, "Power", "t").unwrap();
        assert_eq!((boiler.position, power.position), (1, 2));

        reorder_analyzer_tabs_in_conn(&mut conn, &[power.id, main, boiler.id]).unwrap();
        let order: Vec<i64> = list_analyzer_tabs_in_conn(&conn).unwrap().iter().map(|t| t.id).collect();
        assert_eq!(order, vec![power.id, main, boiler.id]);

        let msg = "Tab order must list every tab exactly once";
        assert_eq!(reorder_analyzer_tabs_in_conn(&mut conn, &[power.id, main]).unwrap_err(), msg);
        assert_eq!(
            reorder_analyzer_tabs_in_conn(&mut conn, &[power.id, power.id, main]).unwrap_err(),
            msg
        );
        assert_eq!(
            reorder_analyzer_tabs_in_conn(&mut conn, &[power.id, main, 9999]).unwrap_err(),
            msg
        );
        cleanup(dir, conn);
    }

    #[test]
    fn delete_tab_rules() {
        let (dir, mut conn) = temp_db();
        let main = main_tab(&conn);
        assert_eq!(
            delete_analyzer_tab_in_conn(&mut conn, main, None, false).unwrap_err(),
            "The last tab can't be deleted"
        );

        let extra = create_analyzer_tab_in_conn(&conn, "Extra", "t").unwrap().id;
        seed_tile(&conn, main, "m1", (0, 0, 4, 4));
        seed_tile(&conn, main, "m2", (0, 4, 4, 3));
        let t1 = seed_tile(&conn, extra, "e1", (1, 2, 5, 2));
        let t2 = seed_tile(&conn, extra, "e2", (3, 6, 2, 2));

        assert_eq!(
            delete_analyzer_tab_in_conn(&mut conn, extra, None, false).unwrap_err(),
            "Choose whether to move or delete this tab's tiles"
        );
        assert_eq!(
            delete_analyzer_tab_in_conn(&mut conn, extra, Some(9999), false).unwrap_err(),
            "Tab not found"
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM analyzer_tabs;"), 2);

        delete_analyzer_tab_in_conn(&mut conn, extra, Some(main), false).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM analyzer_tabs;"), 1);
        // Main's tiles end at y=7; moved set keeps relative order (2 -> 7, 6 -> 11).
        assert_eq!(desktop_layout(&conn, t1), (1, 7, 5, 2));
        assert_eq!(desktop_layout(&conn, t2), (3, 11, 2, 2));
        assert_eq!(
            count(&conn, &format!("SELECT COUNT(*) FROM analyzer_tiles WHERE tab_id = {main};")),
            4
        );

        // delete_tiles removes tiles + links, never signals.
        let doomed = create_analyzer_tab_in_conn(&conn, "Doomed", "t").unwrap().id;
        let d1 = seed_tile(&conn, doomed, "d1", (0, 0, 2, 2));
        seed_signal(&conn, "sig1");
        conn.execute(
            "INSERT INTO analyzer_tile_signals (tile_id, signal_id, role) VALUES (?1, 'sig1', 'primary');",
            (d1,),
        )
        .unwrap();
        let tiles_before = count(&conn, "SELECT COUNT(*) FROM analyzer_tiles;");
        delete_analyzer_tab_in_conn(&mut conn, doomed, None, true).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM analyzer_tiles;"), tiles_before - 1);
        assert_eq!(
            count(&conn, &format!("SELECT COUNT(*) FROM analyzer_tile_layouts WHERE tile_id = {d1};")),
            0
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM analyzer_tile_signals;"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM analyzer_signals;"), 1);

        // Empty tab deletes with no options.
        let empty = create_analyzer_tab_in_conn(&conn, "Empty", "t").unwrap().id;
        delete_analyzer_tab_in_conn(&mut conn, empty, None, false).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM analyzer_tabs;"), 1);
        cleanup(dir, conn);
    }

    #[test]
    fn move_tile_places_below() {
        let (dir, mut conn) = temp_db();
        let main = main_tab(&conn);
        let other = create_analyzer_tab_in_conn(&conn, "Other", "t").unwrap().id;
        seed_tile(&conn, main, "m1", (0, 0, 4, 4));
        seed_tile(&conn, main, "m2", (0, 4, 4, 3));
        let t = seed_tile(&conn, other, "t", (2, 2, 3, 2));

        move_analyzer_tile_to_tab_in_conn(&mut conn, t, main).unwrap();
        assert_eq!(desktop_layout(&conn, t), (2, 7, 3, 2));
        assert_eq!(
            count(&conn, &format!("SELECT tab_id FROM analyzer_tiles WHERE id = {t};")),
            main
        );
        assert_eq!(
            move_analyzer_tile_to_tab_in_conn(&mut conn, 9999, main).unwrap_err(),
            "Tile not found"
        );
        assert_eq!(
            move_analyzer_tile_to_tab_in_conn(&mut conn, t, 9999).unwrap_err(),
            "Tab not found"
        );
        cleanup(dir, conn);
    }

    #[test]
    fn duplicate_tile_copies_everything() {
        let (dir, mut conn) = temp_db();
        let main = main_tab(&conn);
        let other = create_analyzer_tab_in_conn(&conn, "Other", "t").unwrap().id;
        seed_tile(&conn, other, "o1", (0, 0, 6, 5));
        let src = seed_tile(&conn, main, "Temp", (1, 0, 4, 3));
        seed_signal(&conn, "sigA");
        seed_signal(&conn, "sigB");
        for (sig, role, poll) in [("sigA", "primary", 250), ("sigB", "secondary", 5000)] {
            conn.execute(
                "INSERT INTO analyzer_tile_signals (tile_id, signal_id, role, poll_interval_ms)
                 VALUES (?1, ?2, ?3, ?4);",
                params![src, sig, role, poll],
            )
            .unwrap();
        }

        let copy = duplicate_analyzer_tile_in_conn(&mut conn, src, other, "later").unwrap();
        assert_eq!(copy.title, "Temp (copy)");
        assert_eq!(copy.kind, "widget");
        assert_eq!(copy.config_json, "{\"a\":1}");
        assert!(copy.polling_enabled);
        assert_eq!(copy.tab_id, other);
        assert_ne!(copy.id, src);
        assert_eq!(desktop_layout(&conn, copy.id), (1, 5, 4, 3));

        let links = |tile: i64| -> Vec<(String, String, i64)> {
            let mut stmt = conn
                .prepare(
                    "SELECT signal_id, role, poll_interval_ms FROM analyzer_tile_signals
                     WHERE tile_id = ?1 ORDER BY signal_id;",
                )
                .unwrap();
            stmt.query_map((tile,), |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };
        assert_eq!(links(copy.id), links(src));
        assert_eq!(links(src).len(), 2);

        // Original untouched.
        assert_eq!(desktop_layout(&conn, src), (1, 0, 4, 3));
        assert_eq!(
            count(&conn, &format!("SELECT tab_id FROM analyzer_tiles WHERE id = {src};")),
            main
        );

        // Duplicating within the same tab lands below the source.
        let same = duplicate_analyzer_tile_in_conn(&mut conn, src, main, "later").unwrap();
        assert_eq!(desktop_layout(&conn, same.id).1, 3);
        assert_eq!(
            duplicate_analyzer_tile_in_conn(&mut conn, 9999, main, "x").unwrap_err(),
            "Tile not found"
        );
        cleanup(dir, conn);
    }

    #[test]
    fn create_tile_defaults_to_first_tab() {
        let (dir, mut conn) = temp_db();
        let main = main_tab(&conn);
        let other = create_analyzer_tab_in_conn(&conn, "Other", "t").unwrap().id;
        let mk = |tab_id: Option<i64>| AnalyzerTileCreate {
            kind: "widget".to_string(),
            title: "T".to_string(),
            config_json: "{}".to_string(),
            polling_enabled: false,
            layouts: vec![],
            signal_links: vec![],
            tab_id,
        };
        assert_eq!(create_analyzer_tile_in_conn(&mut conn, mk(None), "t").unwrap().tab_id, main);
        assert_eq!(
            create_analyzer_tile_in_conn(&mut conn, mk(Some(other)), "t").unwrap().tab_id,
            other
        );
        assert_eq!(
            create_analyzer_tile_in_conn(&mut conn, mk(Some(9999)), "t").unwrap_err(),
            "Tab not found"
        );
        cleanup(dir, conn);
    }
}
