# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-11-25

### Added
- **FileZilla-Style Quick Connect Bar:** Inline quick-connect bar below the toolbar with protocol selector (`SFTP`, `FTP`, `FTPS`, `SSH`), host, username, password, port, a wide recent-connections dropdown (persisted without passwords), and one-click *"Save to connections tree"* (`BookmarkPlus`) both on the bar and on each history entry.
- **Native Save/Open Dialogs for Backups:** Export now opens the native *"Save As..."* dialog (suggested filename `cd-remote-backup-YYYY-MM-DD.json`) and Import uses the native *"Open File..."* dialog.
- **Automated Test Suites:** Added Rust unit tests (`cargo test`) and frontend Vitest suites (`pnpm test`) covering security validators, cryptography, protocol parsers, path utilities, and tab lifecycle logic.

### Changed
- **Contextual FTP Panel Toggles:** The Local, Console, and Queue panel toggles (and `Ctrl+1/2/3` shortcuts) now appear only when the active/focused tab is a file transfer session (`FTP`, `FTPS`, or `SFTP`).
- **App Icon & Logo:** Removed the inner white circle from the application icon (`app-icon.svg`, regenerated desktop/installer icons) and in-app `AppLogo`.
- **Screen-Lock Behavior:** Locking the vault now overlays `<UnlockModal />` and clears vault metadata while preserving open tabs, SSH terminals, and active transfers so users return to their exact workspace upon unlocking.
- **Frontend Performance & Architecture:** Switched all Zustand consumers to targeted `useShallow` selectors, added safe `cancelled` cleanup guards on Tauri/DOM listeners, made xterm.js react to OS `"system"` theme changes, and consolidated shared pure utilities (`src/utils/{format,protocols,paths,storage}.ts`).

### Fixed
- **Connection & Transfer Lifecycle Leaks:** Prevented orphaned connections when closing a tab during an in-flight handshake or concurrent reconnect (per-tab generation tracking), canceled active/queued/conflicted transfers for closed tabs, fixed `WeakUnboundedSender` cleanup and log file closing in SSH sessions, and added graceful shutdown on application window close.
- **Console Panel Raw FTP Guard:** Fixed `ConsolePanel` evaluating the imported helper instead of the `ftpLike` boolean.

### Security
- **Strict Content Security Policy (CSP):** Enabled an explicit CSP in `tauri.conf.json` and added a 50 MiB limit on backup reads plus unlocked-vault enforcement on backup writes.
- **TLS & SSH Verification Hardening:** Restored real cryptographic TLS 1.2/1.3 handshake signature verification when `accept_invalid_certs` is enabled, eliminated SSH host-key TOCTOU by binding trust to the exact `expected_host_key_fingerprint`, and flagged `key_type` changes for existing hosts as mismatches.
- **Input & Protocol Hardening:** Blocked FTP CRLF/NUL injection, redacted `PASS` commands in raw FTP logs, filtered unsafe remote entry names (`..`, `/`, `\`) in FTP/SFTP listings and recursive downloads, hardened `local_delete` against roots/`..`/`\\?\`, restricted `WebLinksAddon` to `http:`/`https:`, added 30s connection timeouts, created `vault.key` and SSH logs with `0o600` on Unix, and wrapped decrypted secrets in `Zeroizing` with redacted `Debug`.

## [1.1.0] - 2026-11-24

### Added
- **Separated SSH & File Transfer Creation:** Distinct actions and modals for creating and quick-connecting SSH terminals vs. file transfer sessions (FTP, FTPS, SFTP).
- **Duplicate Session:** Right-click context menu option to duplicate any saved session with pre-filled configuration and independent private credential cloning.
- **Multiline Paste Confirmation:** Read-only confirmation dialog showing line count and full preview whenever pasting multiline text into an SSH terminal.
- **Manual SSH Terminal Logging:** Toolbar toggle in each SSH terminal to manually record clean plain-text output (ANSI sequences stripped) to a chosen `.log` file.
- **Two-Panel Split Workspace:** Side-by-side (horizontal) and top-and-bottom (vertical) resizable split screen for viewing any two open tabs simultaneously without disconnecting live sessions.
- **Drag-to-Reorder Tabs & Session Tree:** Pointer-based drag and drop to reorder open session tabs and reorder folders/sessions within the sidebar tree (keeping folders above sessions while supporting moving items across folders or to root).
- **Windows UNC Network Paths:** Support for navigating Windows network shares (`\\server\share\folder`) in the local file explorer, breadcrumb bar, and directory tree.
- **New Languages & Installer Language Selector:** Added full Italian (`it`), French (`fr`), and German (`de`) translations, enabled the NSIS installer language selector dialog, and automatically initialize the app language from the installer selection on first launch.

### Changed
- **Project Renamed to CD Remote:** Updated application branding, package names, identifiers (`com.formatocd.cd-remote`), and backup format (`cd-remote`) with automatic migration from existing `cd-connector.db` vaults and backward-compatible backup imports.
- **Solid Inverted Terminal Icon:** Replaced the outlined terminal icon with a custom solid inverted terminal badge across the sidebar, tabs, homepage, modals, and toolbars.
- **Windows Installer Packaging:** Configured `mainBinaryName` (`cd-remote`), custom NSIS default install directory (`%LOCALAPPDATA%\cd-remote`), and post-build bundle renaming (`pnpm build:release`) so installers display **CD Remote** while keeping space-free `cd-remote` filenames.

## [1.0.0] - 2026-03-01

### Added
- **Multi-Protocol Engine:** Native Rust support for **FTP**, **FTPS** (Explicit & Implicit via `rustls`), **SFTP** (`russh` + `russh-sftp`), and interactive **SSH Terminal** (`@xterm/xterm`) with TOFU host key verification (`known_hosts`).
- **Encrypted Local Vault:** SQLite storage with **Mode A (Master Password: Argon2id + AES-256-GCM)** and **Mode B (Transparent Encryption)**, transactional mode migration, and reusable/private credentials management.
- **Portable JSON Import/Export:** Granular export of folders, sessions, and optionally encrypted credentials with an interactive conflict-resolution import preview and first-launch restore wizard.
- **Modular Workspace & File Explorer:** Hierarchical session tree with folders and icon colors, multi-tab workspace, virtualized file tables, directory tree pane, editable breadcrumb bars, right-click context menus, and POSIX `chmod` modal.
- **Asynchronous Transfer Queue:** Recursive uploads/downloads with real-time progress, speed, ETA, byte-level pause/resume, bandwidth limits, conflict resolution modal, and bidirectional + OS drag-and-drop transfers.
- **Themes & Localization:** Light, Dark, and System themes with English and Spanish UI translations.

[Unreleased]: https://github.com/formatocd/cd-remote/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/formatocd/cd-remote/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/formatocd/cd-remote/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/formatocd/cd-remote/releases/tag/v1.0.0
