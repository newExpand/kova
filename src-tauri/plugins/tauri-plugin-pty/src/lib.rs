// Local fork of tauri-plugin-pty 0.1.1
// Changed: read() returns Vec<u8> instead of String::from_utf8_lossy
// This prevents multi-byte UTF-8 sequences (Korean, CJK, emoji) from being
// corrupted when split across read buffer boundaries.
//
// Sleep/wake resilience: read() uses nix::poll with a 5s timeout on Unix
// to prevent infinite blocking when the PTY master fd becomes stale
// (e.g., after macOS sleep kills the SSH connection).

use std::{
    collections::BTreeMap,
    ffi::OsString,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, PtyPair, PtySize};
use tauri::{
    async_runtime::{Mutex, RwLock},
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[derive(Default)]
struct PluginState {
    session_id: AtomicU32,
    sessions: RwLock<BTreeMap<PtyHandler, Arc<Session>>>,
}

struct Session {
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    child_killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    reader: Mutex<Box<dyn std::io::Read + Send>>,
    /// Raw file descriptor of the PTY master (Unix only).
    /// Used by `nix::poll` to add a timeout to the blocking `read()`.
    /// Obtained from `MasterPty::as_raw_fd()`; shares the same kernel file
    /// description as the cloned reader, so polling it detects data for `read()`.
    #[cfg(unix)]
    reader_fd: Option<std::os::unix::io::RawFd>,
}

type PtyHandler = u32;

#[tauri::command]
async fn spawn<R: Runtime>(
    file: String,
    args: Vec<String>,
    term_name: Option<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    encoding: Option<String>,
    handle_flow_control: Option<bool>,
    flow_control_pause: Option<String>,
    flow_control_resume: Option<String>,

    state: tauri::State<'_, PluginState>,
    _app_handle: AppHandle<R>,
) -> Result<PtyHandler, String> {
    let _ = encoding;
    let _ = handle_flow_control;
    let _ = flow_control_pause;
    let _ = flow_control_resume;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    // Extract raw fd BEFORE destructuring the pair (as_raw_fd needs the master).
    #[cfg(unix)]
    let reader_fd = pair.master.as_raw_fd();

    let mut cmd = CommandBuilder::new(file);
    cmd.args(args);
    if let Some(ref name) = term_name {
        cmd.env(OsString::from("TERM"), OsString::from(name));
    }
    if let Some(cwd) = cwd {
        cmd.cwd(OsString::from(cwd));
    }
    for (k, v) in env.iter() {
        cmd.env(OsString::from(k), OsString::from(v));
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let child_killer = child.clone_killer();
    let handler = state.session_id.fetch_add(1, Ordering::Relaxed);

    // Destructure PtyPair — drop slave fd immediately.
    // After child spawn, only the child process holds the slave fd.
    // When child is killed, master read() will get EOF instead of blocking forever.
    let PtyPair { master, slave: _slave } = pair;
    drop(_slave);

    let session = Arc::new(Session {
        master: Mutex::new(master),
        child: Mutex::new(child),
        child_killer: Mutex::new(child_killer),
        writer: Mutex::new(writer),
        reader: Mutex::new(reader),
        #[cfg(unix)]
        reader_fd,
    });
    state.sessions.write().await.insert(handler, session);
    Ok(handler)
}

#[tauri::command]
async fn write(
    pid: PtyHandler,
    data: String,
    state: tauri::State<'_, PluginState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    session
        .writer
        .lock()
        .await
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Poll timeout for read() in milliseconds.
/// Each poll iteration waits this long before checking fd health (POLLHUP/POLLERR).
/// The loop retries automatically — only returns on data ready, EOF, or fd death.
#[cfg(unix)]
const READ_POLL_TIMEOUT_MS: u16 = 5000;

// CHANGED: Returns Vec<u8> instead of String.
// The original used String::from_utf8_lossy which corrupts multi-byte UTF-8
// characters (Korean, CJK, emoji) that are split across read buffer boundaries.
// Returning raw bytes lets xterm.js's byte parser handle partial sequences correctly.
//
// Sleep/wake resilience: on Unix, uses poll() with a timeout loop instead of a raw
// blocking read(). After each timeout, POLLHUP/POLLERR are checked to detect dead fds
// (e.g., SSH connection died during macOS sleep). This prevents spawn_blocking threads
// from being permanently occupied by stale reads.
// IMPORTANT: "Timeout" must NOT be returned as an error — the tauri-pty JS readData()
// loop exits on ANY error (EOF exits silently, all others terminate the loop permanently).
// Poll retries must happen entirely inside Rust.
#[tauri::command]
async fn read(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<Vec<u8>, String> {
    let session = match state.sessions.read().await.get(&pid) {
        Some(s) => s.clone(),
        // Session was already killed — treat as normal EOF so the JS read loop exits cleanly
        None => return Err("EOF".to_string()),
    };
    // Blocking I/O read — must run off the tokio async runtime.
    // readData() calls this in a tight loop; without spawn_blocking,
    // each iteration permanently occupies a tokio worker thread.
    tauri::async_runtime::spawn_blocking(move || {
        // On Unix, use poll() with a timeout loop to prevent infinite blocking
        // when the PTY fd becomes stale (e.g., after macOS sleep).
        #[cfg(unix)]
        if let Some(fd) = session.reader_fd {
            use nix::poll::{poll, PollFd, PollFlags, PollTimeout};
            use std::os::unix::io::BorrowedFd;

            // SAFETY: fd is valid because this closure holds an Arc<Session>, keeping the
            // MasterPty (and its underlying fd) alive. Even if kill() removes the session
            // from the map, our Arc clone prevents the drop until this closure completes.
            let borrowed = unsafe { BorrowedFd::borrow_raw(fd) };

            loop {
                let mut fds = [PollFd::new(borrowed, PollFlags::POLLIN)];
                match poll(&mut fds, PollTimeout::from(READ_POLL_TIMEOUT_MS)) {
                    Ok(0) => {
                        // Timeout — no data yet. Retry poll; the next iteration will
                        // detect POLLHUP/POLLERR/POLLNVAL if the fd has become dead.
                        continue;
                    }
                    Ok(_) => {
                        if let Some(revents) = fds[0].revents() {
                            // POLLERR / POLLNVAL: unrecoverable fd error → EOF immediately.
                            // POLLNVAL can occur if kill() races with read() and the fd
                            // becomes invalid between session lookup and poll().
                            if revents.contains(PollFlags::POLLERR)
                                || revents.contains(PollFlags::POLLNVAL)
                            {
                                return Err("EOF".to_string());
                            }
                            // POLLHUP without POLLIN: child exited, no data left → EOF
                            // POLLHUP *with* POLLIN: child exited but buffered data remains
                            // — fall through to read the final output first.
                            if revents.contains(PollFlags::POLLHUP)
                                && !revents.contains(PollFlags::POLLIN)
                            {
                                return Err("EOF".to_string());
                            }
                        }
                        break; // data ready (possibly with pending hangup) — proceed to read
                    }
                    Err(nix::errno::Errno::EINTR) => continue, // interrupted by signal, retry
                    Err(e) => return Err(e.to_string()),
                }
            }
        }

        let mut buf = [0u8; 4096];
        let n = session
            .reader
            .blocking_lock()
            .read(&mut buf)
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("EOF".to_string());
        }
        Ok(buf[..n].to_vec())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn resize(
    pid: PtyHandler,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PluginState>,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    session
        .master
        .lock()
        .await
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn kill(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<(), String> {
    let session = state
        .sessions
        .write()
        .await
        .remove(&pid)
        .ok_or("Unavailable pid")?;
    // Move kill + session drop to a blocking thread.
    // 1) child_killer.kill() sends SIGHUP (may briefly block)
    // 2) When session's last Arc drops, UnixMasterWriter::drop()
    //    does tcgetattr + write_all — blocking I/O.
    // Neither should run on the tokio async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = session.child_killer.blocking_lock().kill() {
            tracing::warn!("[tauri-plugin-pty] Failed to kill child process: {}", e);
        }
        drop(session);
    });
    Ok(())
}

#[tauri::command]
async fn exitstatus(pid: PtyHandler, state: tauri::State<'_, PluginState>) -> Result<u32, String> {
    let session = state
        .sessions
        .read()
        .await
        .get(&pid)
        .ok_or("Unavailable pid")?
        .clone();
    // waitpid() is a blocking syscall — must NOT run on tokio async threads.
    let exit_code = tauri::async_runtime::spawn_blocking(move || {
        session
            .child
            .blocking_lock()
            .wait()
            .map(|s| s.exit_code())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(exit_code)
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("pty")
        .invoke_handler(tauri::generate_handler![
            spawn, write, read, resize, kill, exitstatus
        ])
        .setup(|app_handle, _api| {
            app_handle.manage(PluginState::default());
            Ok(())
        })
        .build()
}
