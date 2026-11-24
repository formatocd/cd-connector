# Contributing to CD Remote

Thank you for your interest in contributing to **CD Remote**!

## Workflow

1. **Open an Issue** describing the bug, enhancement, or feature you want to work on.
2. **Create a feature branch** from `main` following the naming convention:
   ```bash
   git checkout -b feature/<issue_id>
   ```
3. **Keep commits clean and in English** (all repository code, comments, documentation, and PR descriptions must be in English).
4. **Verify your changes locally** before opening a Pull Request:
   ```bash
   pnpm build
   cargo check --manifest-path src-tauri/Cargo.toml
   ```
5. **Open a Pull Request** targeting `main` and link the corresponding issue.

## Guidelines

- **License compatibility:** All third-party crates and npm packages must be compatible with the **MIT License** (e.g., MIT, Apache-2.0, BSD, ISC).
- **Security first:** Never log or expose plaintext passwords, private keys, or passphrases. Keep all secrets encrypted at rest with AES-256-GCM and zeroized in memory.
- **Internationalization:** Add any new user-facing strings to all locale files in `src/i18n/locales/` (`en.json`, `es.json`, `it.json`, `fr.json`, `de.json`).
