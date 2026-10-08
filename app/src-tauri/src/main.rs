//! visual[flow]: the editor in a webview, the bench drawn natively under it, and
//! in live mode the output full screen on a display of its own.

mod actions;
mod bench;
#[cfg(target_os = "macos")]
mod dev;
mod editor;
mod fx;
mod link;
mod listen;
mod output;
mod playlists;
mod settings;

use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use tauri::Manager;

struct App {
    bench: Mutex<Option<bench::Thread>>,
    ring: listen::Ring,
    listening: Mutex<Option<listen::Listening>>,
    library: PathBuf,
    /// The open preset's seed, kept so an edit reruns it with the same randomness.
    seed: AtomicU64,
}

impl App {
    /// The bench's command channel, once it has started.
    fn commands(&self) -> Result<Sender<bench::Cmd>, String> {
        self.bench.lock().unwrap().as_ref().map(|b| b.commands.clone()).ok_or_else(|| "the bench has not started".into())
    }

    /// Tell the bench `cmd`, if it is there to hear it.
    fn send(&self, cmd: bench::Cmd) {
        if let Ok(commands) = self.commands() {
            let _ = commands.send(cmd);
        }
    }

    /// Send the bench the command `make` builds around a reply channel, and wait
    /// for the reply. The bench's lock is let go before waiting.
    fn ask<T>(&self, make: impl FnOnce(Sender<T>) -> bench::Cmd) -> Result<T, String> {
        let commands = self.commands()?;
        let (tx, rx) = std::sync::mpsc::channel();
        commands.send(make(tx)).map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }
}

fn main() {
    let library = engine::preset::pack_dir();
    let deck = actions::Deck::new(playlists::Store::open(playlists::default_file(), library.clone()));
    tauri::Builder::default()
        .manage(App { bench: Mutex::new(None), ring: listen::ring(), listening: Mutex::new(None), library, seed: AtomicU64::new(1) })
        .manage(deck)
        .setup(|app| {
            actions::start_auto(app.handle().clone());
            link::start(app.handle().clone());
            #[cfg(target_os = "macos")]
            {
                let window = app.get_webview_window("main").expect("main window");
                let instance = wgpu::Instance::default();
                let surface = unsafe { bench::view::create(window.ns_window()?, &instance) };
                let state = app.state::<App>();
                output::init(app.handle().clone(), instance.clone());
                let effects = app.state::<actions::Deck>().fx.clone();
                dev::send_fx(app.handle());
                let thread = bench::start(instance, surface, (1, 1), state.ring.clone(), effects);
                *state.bench.lock().unwrap() = Some(thread);
                listen::resume(&state);
                dev::capture(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            editor::presets,
            editor::open,
            editor::apply,
            editor::set_value,
            editor::set_previews,
            editor::previews,
            editor::default_shader,
            editor::place_bench,
            listen::inputs,
            listen::listen_to,
            listen::listening,
            listen::levels,
            editor::stats,
            actions::act,
            actions::fx_state,
            actions::playlists,
            actions::playlist_create,
            actions::playlist_rename,
            actions::playlist_delete,
            actions::playlist_add,
            actions::playlist_remove,
            actions::playlist_move_item,
            actions::playlist_move,
            output::start_preset,
            output::live_start,
            output::displays,
            output::output_open,
            output::output_close,
            output::output_status,
            link::link_state,
            link::link_enable,
            link::link_set_one,
            link::link_nudge,
            link::link_reset_one,
            link::link_sync,
        ])
        .run(tauri::generate_context!())
        .expect("visual[flow]");
}
