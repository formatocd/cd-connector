# CD Remote

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)
[![Built with Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-2021-orange?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)

**CD Remote** is a modern, lightweight, open-source cross-platform file transfer and SSH terminal client for **Windows**, **macOS**, and **Linux**, developed by [formatocd](https://github.com/formatocd).

Built with **Rust**, **Tauri v2**, **React**, **TypeScript**, and **TailwindCSS**, CD Remote combines native performance and a small memory footprint with a clean, modular interface and strong local encryption.

---

## Download

Pre-built installers for **Windows**, **macOS**, and **Linux** are available on the [GitHub Releases](https://github.com/formatocd/cd-remote/releases) page.

---

## Features

- **Multi-Protocol Support**
  - **FTP** (plain), **FTPS** (Explicit `AUTH TLS` & Implicit `990` with `rustls`), **SFTP** (pure Rust via `russh` + `russh-sftp`), and **SSH Terminal** (interactive PTY + `@xterm/xterm`).
  - Passive/Active mode for FTP and optional per-session self-signed TLS certificate acceptance for FTPS.
  - **TOFU Host Key Verification** (`known_hosts` stored in SQLite) with mismatch warnings for SFTP and SSH.
- **Encrypted Local Vault & Flexible Security**
  - **Mode A (Master Password):** Key derived via **Argon2id**, secrets encrypted with **AES-256-GCM**, master key kept strictly in volatile memory and securely wiped (`zeroize`).
  - **Mode B (Transparent Encryption):** Zero-prompt startup using a locally generated high-entropy key.
  - Seamless migration between Mode A and Mode B with transactional re-encryption.
  - **Reusable Credentials Manager** (password, SSH private key with optional passphrase, SSH agent) plus manual per-session credentials.
- **Portable Backup & Sharing**
  - Export folders, sessions, and credentials to JSON with granular control over whether to include usernames and/or encrypted secrets protected by a dedicated export password (independent of your local master password).
  - Interactive editable import preview with conflict detection, plus **restore directly from JSON** on first launch.
- **Modern Modular Workspace**
  - Interactive Homepage with Quick Connect, instant session/host search, and recently opened sessions.
  - Collapsible hierarchical session tree with nested folders, Drag & Drop organization, and customizable icon colors.
  - Multi-tab simultaneous sessions with resizable split panels (`react-resizable-panels`) and independent toggleable Local Explorer, Directory Tree, Console, and Transfer Queue panels.
  - Virtualized file tables (`@tanstack/react-virtual`) capable of smoothly rendering 10,000+ entries, Material-style extension icons, Windows Explorer-style multi-selection, right-click context menus, editable breadcrumb bars, and interactive `chmod` modal.
  - Light, Dark, and System themes, plus multi-language UI (**English**, **Spanish**, **Italian**, **French**, and **German**).
- **Asynchronous Transfer Queue & Drag & Drop**
  - Recursive directory uploads and downloads with real-time progress, speed, and ETA.
  - Byte-level pause & resume (SFTP seek and FTP `REST` with automatic fallback), configurable concurrency, and global upload/download bandwidth limits.
  - Conflict resolution modal (**Overwrite**, **Overwrite if newer or different size**, **Skip**, **Auto-rename**) with *"Apply to remaining conflicts"*.
  - Bidirectional internal Drag & Drop (Local ↔ Remote) and native OS-to-App Drag & Drop uploads.
- **Integrated SSH Terminal Emulator**
  - Full ANSI/256-color PTY terminal (`@xterm/xterm`) with customizable font family (including Nerd Fonts), font size, copy-on-select toggle, and one-click **"Open SSH Terminal"** from any active SFTP tab.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + B` | Toggle sessions sidebar |
| `Ctrl + 1` | Toggle local file explorer |
| `Ctrl + 2` | Toggle console / session log |
| `Ctrl + 3` | Toggle transfer queue |
| `F2` | Rename selected file or folder |
| `Delete` | Delete selected file(s) or folder(s) |
| `F5` | Refresh active directory |
| `Backspace` | Navigate to parent directory |
| `Ctrl + Shift + C / V` | Copy / Paste in SSH terminal |

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Backend / Core** | Rust, `tokio`, `suppaftp` (`rustls`), `russh`, `russh-sftp` |
| **Desktop Shell** | Tauri v2 |
| **Frontend** | React 19, TypeScript, TailwindCSS v4, Zustand, i18next, `@tanstack/react-virtual`, `react-resizable-panels`, `@xterm/xterm` |
| **Database** | SQLite (`rusqlite` bundled) |
| **Cryptography** | Argon2id (`argon2`), AES-256-GCM (`aes-gcm`), `zeroize` |

---

## Development & Building from Source

### Prerequisites
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Node.js](https://nodejs.org/) (v20+) and [pnpm](https://pnpm.io/) (v10+)
- Platform-specific Tauri v2 prerequisites (see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/))

### Run in Development Mode
```bash
pnpm install
pnpm tauri dev
```

### Build Native Production Installers
```bash
pnpm build
pnpm tauri build
```

Generated installers will be placed under `src-tauri/target/release/bundle/`.

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.  
Copyright © 2026 Carlos Durán (`formatocd`).
