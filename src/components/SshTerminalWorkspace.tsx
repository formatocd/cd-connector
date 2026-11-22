import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Plug, Unplug, Trash2 } from "lucide-react";
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
  const { config, credentials } = useAppStore();
  const { session, tabId, transientAuth } = tab;

  const [connState, setConnState] = useState<ConnectionState>("idle");
  const [connError, setConnError] = useState<string | null>(null);
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptInfo | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [runtimeAuth, setRuntimeAuth] = useState<{ username: string; password?: string } | null>(
    transientAuth ?? null
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const linkedCred = session.credential_id
    ? credentials.find((c) => c.id === session.credential_id) ?? null
    : null;

  const isDarkTheme = () =>
    config.theme === "dark" ||
    (config.theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const connect = useCallback(
    async (opts?: {
      trustHostKey?: boolean;
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
          trust_host_key: opts?.trustHostKey ?? false,
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
      }
    },
    [tabId, session, runtimeAuth]
  );

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
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, "Liberation Mono", Menlo, monospace',
      theme: isDarkTheme() ? DARK_THEME : LIGHT_THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
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
              if (text) api.sshWrite(tabId, text).catch(() => {});
            })
            .catch(() => {});
          return false;
        }
      }
      return true;
    });

    const dataDisposable = term.onData((data) => {
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

    term.writeln(
      `\x1b[90mConnecting to ssh://${session.host}:${session.port}...\x1b[0m`
    );
    connect();

    return () => {
      resizeObserver.disconnect();
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

  // Sync terminal colors when theme changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = isDarkTheme() ? DARK_THEME : LIGHT_THEME;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.theme]);

  // Listen to backend SSH output & close events
  useEffect(() => {
    const unlistenData = listen<SshDataEvent>("ssh-data", (event) => {
      if (event.payload.tab_id !== tabId) return;
      const bytes = base64ToBytes(event.payload.data_b64);
      termRef.current?.write(bytes);
    });
    const unlistenClosed = listen<SshClosedEvent>("ssh-closed", (event) => {
      if (event.payload.tab_id !== tabId) return;
      setConnState("disconnected");
      termRef.current?.writeln(
        `\r\n\x1b[33m[${event.payload.reason}]\x1b[0m`
      );
    });
    return () => {
      unlistenData.then((fn) => fn());
      unlistenClosed.then((fn) => fn());
    };
  }, [tabId]);

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
          onTrust={() => connect({ trustHostKey: true })}
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
    </div>
  );
}
