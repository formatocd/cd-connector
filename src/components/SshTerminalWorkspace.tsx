import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Plug, Unplug, Trash2, FileText, Square, AlertTriangle } from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import { HostKeyModal } from "./HostKeyModal";
import { AuthPromptModal } from "./AuthPromptModal";
import {
  extractErrorMessage,
  type HostKeyPromptInfo,
  type OpenTab,
  type SshClosedEvent,
  type SshDataEvent,
} from "../types";

interface SshTerminalWorkspaceProps {
  tab: OpenTab;
  isActive: boolean;
}

type ConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "error";

const DARK_THEME = {
  background: "#09090b",
  foreground: "#e4e4e7",
  cursor: "#818cf8",
  selectionBackground: "rgba(99, 102, 241, 0.35)",
  black: "#18181b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e4e4e7",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#18181b",
  cursor: "#4f46e5",
  selectionBackground: "rgba(79, 70, 229, 0.22)",
  black: "#18181b",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#f4f4f5",
};

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function SshTerminalWorkspace({ tab, isActive }: SshTerminalWorkspaceProps) {
  const { t } = useTranslation();
  const { config, credentials, closeTab } = useAppStore(
    useShallow((s) => ({
      config: s.config,
      credentials: s.credentials,
      closeTab: s.closeTab,
    }))
  );
  const { session, tabId, transientAuth } = tab;

  const [connState, setConnState] = useState<ConnectionState>("idle");
  const [connError, setConnError] = useState<string | null>(null);
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptInfo | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [runtimeAuth, setRuntimeAuth] = useState<{ username: string; password?: string } | null>(
    transientAuth ?? null
  );
  const [logFilePath, setLogFilePath] = useState<string | null>(null);
  const [pendingPaste, setPendingPaste] = useState<{ text: string; lineCount: number } | null>(
    null
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const connStateRef = useRef<ConnectionState>("idle");
  const connectRef = useRef<() => void>(() => {});
  const closeTabRef = useRef<() => void>(() => {});
  const copyOnSelectRef = useRef<boolean>(config.terminal_copy_on_select);
  const handlePasteTextRef = useRef<(text: string) => void>(() => {});

  const handlePasteText = useCallback(
    (text: string) => {
      if (!text) return;
      const lines = text.split(/\r\n|\r|\n/);
      if (lines.length > 1) {
        setPendingPaste({ text, lineCount: lines.length });
      } else {
        api.sshWrite(tabId, text).catch(() => {});
      }
    },
    [tabId]
  );

  useEffect(() => {
    handlePasteTextRef.current = handlePasteText;
  }, [handlePasteText]);

  const handleToggleLog = async () => {
    if (logFilePath) {
      await api.sshStopLog(tabId).catch(() => {});
      setLogFilePath(null);
      return;
    }
    const safeName = session.name.replace(/[^a-zA-Z0-9._-]+/g, "_") || "terminal";
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
      now.getHours()
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    try {
      const selected = await save({
        defaultPath: `${safeName}_${stamp}.log`,
        filters: [
          { name: "Log files", extensions: ["log", "txt"] },
        ],
      });
      if (typeof selected === "string" && selected.trim()) {
        await api.sshStartLog(tabId, selected);
        setLogFilePath(selected);
      }
    } catch {
      // ignore if cancelled or dialog error
    }
  };

  useEffect(() => {
    return () => {
      api.sshStopLog(tabId).catch(() => {});
    };
  }, [tabId]);

  useEffect(() => {
    connStateRef.current = connState;
  }, [connState]);

  useEffect(() => {
    closeTabRef.current = () => closeTab(tabId);
  }, [closeTab, tabId]);

  useEffect(() => {
    copyOnSelectRef.current = config.terminal_copy_on_select;
  }, [config.terminal_copy_on_select]);

  const linkedCred = session.credential_id
    ? credentials.find((c) => c.id === session.credential_id) ?? null
    : null;

  const isDarkTheme = () =>
    config.theme === "dark" ||
    (config.theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const connect = useCallback(
    async (opts?: {
      expectedHostKeyFingerprint?: string;
      overrideAuth?: { username: string; password?: string };
    }) => {
      setConnState("connecting");
      setConnError(null);
      setHostKeyPrompt(null);
      setShowAuthPrompt(false);

      const term = termRef.current;
      const fit = fitRef.current;
      if (fit) {
        try {
          fit.fit();
        } catch {
          // ignore if hidden
        }
      }

      const authToUse = opts?.overrideAuth ?? runtimeAuth;
      try {
        const res = await api.sshConnect({
          tab_id: tabId,
          host: session.host,
          port: session.port,
          credential_id: session.credential_id,
          username: authToUse?.username ?? null,
          password: authToUse?.password ?? null,
          initial_dir: session.remote_initial_path || null,
          cols: term?.cols ?? 100,
          rows: term?.rows ?? 30,
          expected_host_key_fingerprint: opts?.expectedHostKeyFingerprint ?? null,
        });

        if (res.status === "host_key_prompt" && res.host_key_info) {
          setConnState("disconnected");
          setHostKeyPrompt(res.host_key_info);
          return;
        }
        if (res.status === "auth_required") {
          setConnState("disconnected");
          setShowAuthPrompt(true);
          return;
        }

        setConnState("connected");
        term?.focus();
      } catch (err) {
        const msg = extractErrorMessage(err);
        setConnState("error");
        setConnError(msg);
        term?.writeln(`\r\n\x1b[31m[Error] ${msg}\x1b[0m`);
        term?.writeln(`\x1b[90m${t("workspace.ssh_disconnected_hint")}\x1b[0m`);
      }
    },
    [tabId, session, runtimeAuth, t]
  );

  useEffect(() => {
    connectRef.current = () => connect();
  }, [connect]);

  const handleDisconnect = async () => {
    await api.sshDisconnect(tabId).catch(() => {});
    setConnState("disconnected");
  };

  // Initialize xterm.js once on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: config.terminal_font_size || 13,
      fontFamily:
        config.terminal_font_family ||
        'Cascadia Code, Consolas, ui-monospace, monospace',
      theme: isDarkTheme() ? DARK_THEME : LIGHT_THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        try {
          const parsed = new URL(uri);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            window.open(parsed.href, "_blank", "noopener,noreferrer");
          }
        } catch {
          // Ignore malformed URLs
        }
      })
    );
    term.open(container);
    fit.fit();

    // Ctrl+Shift+C / Ctrl+Shift+V copy & paste
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey) {
        if (ev.key.toLowerCase() === "c" && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          return false;
        }
        if (ev.key.toLowerCase() === "v") {
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) handlePasteTextRef.current(text);
            })
            .catch(() => {});
          return false;
        }
      }
      return true;
    });

    // Intercept DOM paste events (e.g. right-click paste or browser paste) before xterm consumes them
    const onDomPaste = (ev: ClipboardEvent) => {
      const text = ev.clipboardData?.getData("text");
      if (!text) return;
      if (/[\r\n]/.test(text)) {
        ev.preventDefault();
        ev.stopPropagation();
        handlePasteTextRef.current(text);
      }
    };
    container.addEventListener("paste", onDomPaste, true);

    const selectionDisposable = term.onSelectionChange(() => {
      if (copyOnSelectRef.current && term.hasSelection()) {
        const text = term.getSelection();
        if (text) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
      }
    });

    const dataDisposable = term.onData((data) => {
      if (connStateRef.current === "disconnected" || connStateRef.current === "error") {
        if (data === "r" || data === "R") {
          term.writeln("");
          connectRef.current();
        } else if (data === "\r" || data === "\n") {
          closeTabRef.current();
        }
        return;
      }
      api.sshWrite(tabId, data).catch(() => {});
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!container.offsetWidth || !container.offsetHeight) return;
      try {
        fit.fit();
        api.sshResize(tabId, term.cols, term.rows).catch(() => {});
      } catch {
        // ignore transient resize
      }
    });
    resizeObserver.observe(container);

    termRef.current = term;
    fitRef.current = fit;

    const connectTimer = window.setTimeout(() => {
      term.writeln(
        `\x1b[90mConnecting to ssh://${session.host}:${session.port}...\x1b[0m`
      );
      connect();
    }, 0);

    return () => {
      window.clearTimeout(connectTimer);
      container.removeEventListener("paste", onDomPaste, true);
      resizeObserver.disconnect();
      selectionDisposable.dispose();
      dataDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit and focus whenever tab becomes active
  useEffect(() => {
    if (!isActive) return;
    const fit = fitRef.current;
    const term = termRef.current;
    if (fit && term) {
      requestAnimationFrame(() => {
        try {
          fit.fit();
          api.sshResize(tabId, term.cols, term.rows).catch(() => {});
          term.focus();
        } catch {
          // ignore
        }
      });
    }
  }, [isActive, tabId]);

  // Sync terminal colors & font when settings or OS theme change
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term) return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark =
        config.theme === "dark" || (config.theme === "system" && media.matches);
      term.options.theme = dark ? DARK_THEME : LIGHT_THEME;
    };

    applyTheme();
    media.addEventListener("change", applyTheme);

    term.options.fontFamily =
      config.terminal_font_family ||
      "Cascadia Code, Consolas, ui-monospace, monospace";
    term.options.fontSize = config.terminal_font_size || 13;
    if (fit) {
      requestAnimationFrame(() => {
        try {
          fit.fit();
          api.sshResize(tabId, term.cols, term.rows).catch(() => {});
        } catch {
          // ignore
        }
      });
    }

    return () => {
      media.removeEventListener("change", applyTheme);
    };
  }, [config.theme, config.terminal_font_family, config.terminal_font_size, tabId]);

  // Listen to backend SSH output & close events
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    listen<SshDataEvent>("ssh-data", (event) => {
      if (cancelled || event.payload.tab_id !== tabId) return;
      const bytes = base64ToBytes(event.payload.data_b64);
      termRef.current?.write(bytes);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen<SshClosedEvent>("ssh-closed", (event) => {
      if (cancelled || event.payload.tab_id !== tabId) return;
      setConnState("disconnected");
      setLogFilePath(null);
      termRef.current?.writeln(
        `\r\n\x1b[33m[${event.payload.reason}]\x1b[0m`
      );
      termRef.current?.writeln(
        `\x1b[90m${t("workspace.ssh_disconnected_hint")}\x1b[0m`
      );
      termRef.current?.focus();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, [tabId, t]);

  return (
    <div className={`flex-1 min-h-0 flex flex-col ${isActive ? "" : "hidden"}`}>
      {/* Status Bar */}
      <div className="h-9 shrink-0 px-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              connState === "connected"
                ? "bg-emerald-500"
                : connState === "connecting"
                ? "bg-amber-500 animate-pulse"
                : connState === "error"
                ? "bg-red-500"
                : "bg-zinc-400"
            }`}
          />
          <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 truncate">
            ssh://{session.host}:{session.port}
          </span>
          <span className="text-[11px] text-zinc-500">
            •{" "}
            {connState === "connected"
              ? t("workspace.status_connected")
              : connState === "connecting"
              ? t("workspace.status_connecting")
              : connState === "error"
              ? connError ?? t("workspace.status_error")
              : t("workspace.status_disconnected")}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            title={
              logFilePath
                ? t("workspace.ssh_log_stop_tooltip", { path: logFilePath })
                : t("workspace.ssh_log_start_tooltip")
            }
            onClick={handleToggleLog}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors cursor-pointer ${
              logFilePath
                ? "border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950"
                : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            {logFilePath ? (
              <>
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <Square className="w-2.5 h-2.5 fill-current" />
                {t("workspace.ssh_log_recording")}
              </>
            ) : (
              <>
                <FileText className="w-3 h-3" />
                {t("workspace.ssh_log_start")}
              </>
            )}
          </button>
          <button
            type="button"
            title={t("workspace.console_clear")}
            onClick={() => termRef.current?.clear()}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            {t("workspace.console_clear")}
          </button>
          {connState === "connected" ? (
            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Unplug className="w-3 h-3" />
              {t("workspace.disconnect")}
            </button>
          ) : (
            <button
              type="button"
              disabled={connState === "connecting"}
              onClick={() => connect()}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer"
            >
              <Plug className="w-3 h-3" />
              {t("workspace.reconnect")}
            </button>
          )}
        </div>
      </div>

      {/* Terminal Canvas */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 w-full p-2 bg-white dark:bg-zinc-950 overflow-hidden"
      />

      {hostKeyPrompt && (
        <HostKeyModal
          info={hostKeyPrompt}
          onTrust={() =>
            connect({ expectedHostKeyFingerprint: hostKeyPrompt.fingerprint })
          }
          onCancel={() => setHostKeyPrompt(null)}
        />
      )}

      {showAuthPrompt && (
        <AuthPromptModal
          host={session.host}
          port={session.port}
          protocol="ssh"
          initialUsername={linkedCred?.username ?? ""}
          onSubmit={(username, password) => {
            const auth = { username, password };
            setRuntimeAuth(auth);
            connect({ overrideAuth: auth });
          }}
          onCancel={() => setShowAuthPrompt(false)}
        />
      )}

      {pendingPaste && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("workspace.multiline_paste_title")}
              </h3>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                {t("workspace.multiline_paste_message", {
                  count: pendingPaste.lineCount,
                })}
              </p>
              <pre className="p-3 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre overflow-auto max-h-64 select-text">
                {pendingPaste.text}
              </pre>
            </div>
            <div className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingPaste(null);
                  termRef.current?.focus();
                }}
                className="px-4 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {t("app.cancel")}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  const textToPaste = pendingPaste.text;
                  setPendingPaste(null);
                  api.sshWrite(tabId, textToPaste).catch(() => {});
                  termRef.current?.focus();
                }}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
              >
                {t("workspace.multiline_paste_confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
