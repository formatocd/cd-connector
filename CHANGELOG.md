# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/formatocd/cd-remote/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/formatocd/cd-remote/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/formatocd/cd-remote/releases/tag/v1.0.0
