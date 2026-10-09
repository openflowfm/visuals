//! visual[flow]: the player in a webview, the bench drawn natively under it, and
//! in live mode the output full screen on a display of its own. Built with the
//! `lab` feature, the page is the editor too ([`editor`]).

mod actions;
mod bench;
mod catalog;
#[cfg(target_os = "macos")]
mod dev;
#[cfg(feature = "lab")]
mod editor;
mod fx;
mod library;
mod link;
mod listen;
mod menu;
mod output;
mod pack;
mod playlists;
mod preview;
mod settings;
mod tap;
mod testsound;
mod updater;
mod userlib;

/// The page's commands: the player's, then `lab`'s (the editor's, from
/// [`editor`]) as given.
macro_rules! commands {
    ($($lab:ident),* $(,)?) => {
        tauri::generate_handler![
            library::presets,
            library::open,
            catalog::library_index,
            userlib::library_data,
            userlib::library_set,
            preview::place_bench,
            preview::stats,
            listen::inputs,
            listen::audio_sources,
            listen::listen_to,
            listen::listening,
            listen::levels,
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
            pack::pack_status,
            pack::pack_download,
            pack::pack_add,
            settings::first_run,
            settings::first_run_done,
            updater::update_check,
            updater::update_install,
            testsound::test_sound,
            $(editor::$lab,)*
        ]
    };
}

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
    #[cfg(target_os = "macos")]
    let headless = dev::headless();
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    // Headless (`VISUALS_HEADLESS`): never take focus from the app in front.
    #[cfg(target_os = "macos")]
    let builder = builder.activate_ignoring_other_apps(!headless);
    #[cfg(feature = "lab")]
    let builder = builder.invoke_handler(commands!(apply, set_value, set_previews, previews, default_shader));
    #[cfg(not(feature = "lab"))]
    let builder = builder.invoke_handler(commands!());
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut app = builder
        .manage(App { bench: Mutex::new(None), ring: listen::ring(), listening: Mutex::new(None), library, seed: AtomicU64::new(1) })
        .manage(deck)
        .manage(userlib::Store::open(userlib::default_file()))
        .register_uri_scheme_protocol(catalog::SCHEME, |ctx, request| catalog::serve(ctx.app_handle(), &request))
        .setup(move |app| {
            menu::install(app)?;
            if let Some(starter) = pack::starter(app.handle()) {
                app.state::<actions::Deck>().store.lock().unwrap().add_folder(starter);
            }
            pack::start(app.handle());
            actions::start_auto(app.handle().clone());
            link::start(app.handle().clone());
            updater::start(app.handle().clone());
            #[cfg(not(target_os = "macos"))]
            app.get_webview_window("main").expect("main window").show()?;
            #[cfg(target_os = "macos")]
            {
                // The window starts hidden (`tauri.conf.json`): shown here, or
                // headless, drawn where no display shows it.
                let window = app.get_webview_window("main").expect("main window");
                if headless {
                    window.with_webview(|webview| {
                        let mtm = objc2::MainThreadMarker::new().expect("main thread");
                        // SAFETY: tauri hands over the live WKWebView and NSWindow, on the main thread.
                        unsafe {
                            dev::keep_drawing(webview.inner());
                            dev::park(mtm, &*(webview.ns_window() as *const objc2_app_kit::NSWindow));
                        }
                    })?;
                } else {
                    window.show()?;
                    window.set_focus()?;
                }
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
        .build(tauri::generate_context!())
        .expect("visual[flow]");
    // Headless: no Dock icon or menu bar, and the app can't be made active.
    #[cfg(target_os = "macos")]
    if headless {
        app.set_activation_policy(tauri::ActivationPolicy::Prohibited);
    }
    app.run(|_, _| {});
}
