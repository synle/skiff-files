//! Spawn helpers for Windows console-subsystem subprocesses (`git`,
//! `powershell`, `reg`, …) that must run silently without flashing a console
//! window.
//!
//! Skiff Files' GUI parent is compiled with
//! `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`
//! (`main.rs:2`) and therefore has no console of its own. Without
//! `CREATE_NO_WINDOW` (the Win32 process-creation flag `0x08000000`), every
//! short-lived child the parent spawns briefly allocates and tears down its
//! own console — a visible black flash. The pattern is most visible on
//! repeated calls (Skiffsync `cprepo` shelling out to `git ls-files`).
//!
//! Always use `hidden_command(...)` instead of `std::process::Command::new(...)`
//! when shelling out to a console program from a `#[cfg(target_os = "windows")]`
//! code path. The exception is when the user explicitly *requested* a terminal
//! (e.g. the "Open Terminal here" action that runs `cmd /K` — leave that
//! alone).
//!
//! No-op fallback on non-Windows targets so callers don't need to `cfg`-gate
//! every spawn site.

use std::process::Command;

/// Build a `Command` for `program` with the platform-appropriate flags
/// applied. On Windows this pre-applies `CREATE_NO_WINDOW` so the child runs
/// without flashing a console window. On macOS / Linux this is just
/// `Command::new(program)` — neither OS auto-allocates a terminal for a child
/// process, so no equivalent flag is needed.
pub fn hidden_command(program: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(program)
    }
}
