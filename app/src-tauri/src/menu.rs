//! The macOS menu: the app menu (About, Check for Updates…, Welcome…, Flashing
//! Lights Warning…, Credits, Hide, Hide Others, Quit) and the usual Edit and
//! Window menus, so copy, paste and fullscreen keep working. The four custom
//! items emit an event to the page.

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{App, Emitter, Runtime};

/// The custom items' ids, each the name of the event it emits. `flash-warning`
/// shows the first run's photosensitivity warning again (#100).
pub const ITEMS: [(&str, &str); 4] = [("update-check", "Check for Updates…"), ("welcome", "Welcome…"), ("flash-warning", "Flashing Lights Warning…"), ("credits", "Credits")];

/// The event a menu item emits, if it is one of ours.
pub fn event_for(id: &str) -> Option<&'static str> {
    ITEMS.iter().find(|(event, _)| *event == id).map(|(event, _)| *event)
}

/// Sets the app's menu and sends our items' events to the page.
pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let h = app.handle();
    let [updates, welcome, warning, credits] = ITEMS.map(|(id, text)| MenuItem::with_id(h, id, text, true, None::<&str>));
    let app_menu = Submenu::with_items(
        h,
        "visual[flow]",
        true,
        &[
            &PredefinedMenuItem::about(h, None, Some(AboutMetadata::default()))?,
            &updates?,
            &welcome?,
            &warning?,
            &credits?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::hide(h, None)?,
            &PredefinedMenuItem::hide_others(h, None)?,
            &PredefinedMenuItem::show_all(h, None)?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::quit(h, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        h,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(h, None)?,
            &PredefinedMenuItem::redo(h, None)?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::cut(h, None)?,
            &PredefinedMenuItem::copy(h, None)?,
            &PredefinedMenuItem::paste(h, None)?,
            &PredefinedMenuItem::select_all(h, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        h,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(h, None)?, &PredefinedMenuItem::maximize(h, None)?, &PredefinedMenuItem::fullscreen(h, None)?, &PredefinedMenuItem::close_window(h, None)?],
    )?;
    app.set_menu(Menu::with_items(h, &[&app_menu, &edit, &window])?)?;
    app.on_menu_event(|app, event| {
        if let Some(name) = event_for(event.id().as_ref()) {
            let _ = app.emit(name, ());
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items_map_to_their_events() {
        assert_eq!(ITEMS.map(|(_, text)| text), ["Check for Updates…", "Welcome…", "Flashing Lights Warning…", "Credits"]);
        assert_eq!(event_for("update-check"), Some("update-check"));
        assert_eq!(event_for("welcome"), Some("welcome"));
        assert_eq!(event_for("flash-warning"), Some("flash-warning"));
        assert_eq!(event_for("credits"), Some("credits"));
        assert_eq!(event_for("quit"), None);
    }
}
