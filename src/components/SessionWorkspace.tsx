import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  File,
  ArrowUp,
  RefreshCw,
  FolderPlus,
  Pencil,
  Trash2,
  Shield,
  Plug,
  Unplug,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import { ConsolePanel } from "./ConsolePanel";
import { HostKeyModal } from "./HostKeyModal";
import { AuthPromptModal } from "./AuthPromptModal";
import {
  extractErrorMessage,
  type FileEntry,
  type HostKeyPromptInfo,
  type OpenTab,
} from "../types";

interface SessionWorkspaceProps {
  tab: OpenTab;
  isActive: boolean;
}

type ConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "error";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function parentRemotePath(path: string): string {
  const cleaned = path.replace(/\/+$/, "");
  if (!cleaned || cleaned === "/") return "/";
  const idx = cleaned.lastIndexOf("/");
  if (idx <= 0) return "/";
  return cleaned.slice(0, idx);
}

function parentLocalPath(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const cleaned = path.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  if (idx < 0) return path;
  if (idx === 0) return "/";
  // Windows drive root e.g. C:\
  if (sep === "\\" && idx === 2 && cleaned[1] === ":") {
    return `${cleaned.slice(0, 2)}\\`;
  }
  return cleaned.slice(0, idx);
}

function joinPath(base: string, name: string, isLocal: boolean): string {
  if (isLocal) {
    const sep = base.includes("\\") ? "\\" : "/";
    return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
  }
  return base === "/" || !base ? `/${name}` : `${base.replace(/\/+$/, "")}/${name}`;
}

export function SessionWorkspace({ tab, isActive }: SessionWorkspaceProps) {
  const { t } = useTranslation();
  const { config, credentials } = useAppStore();
  const { session, tabId, transientAuth } = tab;

  // Connection state
  const [connState, setConnState] = useState<ConnectionState>("idle");
  const [connError, setConnError] = useState<string | null>(null);
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptInfo | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [runtimeAuth, setRuntimeAuth] = useState<{ username: string; password?: string } | null>(
    transientAuth ?? null
  );

  // Local explorer state
  const [localPath, setLocalPath] = useState(session.local_initial_path || "");
  const [localPathInput, setLocalPathInput] = useState(session.local_initial_path || "");
  const [localEntries, setLocalEntries] = useState<FileEntry[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Remote explorer state
  const [remotePath, setRemotePath] = useState(session.remote_initial_path || "/");
  const [remotePathInput, setRemotePathInput] = useState(session.remote_initial_path || "/");
  const [remoteEntries, setRemoteEntries] = useState<FileEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const linkedCred = session.credential_id
    ? credentials.find((c) => c.id === session.credential_id) ?? null
    : null;

  const loadLocalDir = useCallback(async (targetPath: string) => {
    setLocalLoading(true);
    setLocalError(null);
    try {
      const entries = await api.localListDir(targetPath);
      setLocalPath(targetPath);
      setLocalPathInput(targetPath);
      setLocalEntries(entries);
    } catch (err) {
      setLocalError(extractErrorMessage(err));
    } finally {
      setLocalLoading(false);
    }
  }, []);

  const loadRemoteDir = useCallback(
    async (targetPath: string) => {
      setRemoteLoading(true);
      setRemoteError(null);
      try {
        const entries = await api.remoteListDir(tabId, targetPath);
        setRemotePath(targetPath);
        setRemotePathInput(targetPath);
        setRemoteEntries(entries);
      } catch (err) {
        setRemoteError(extractErrorMessage(err));
      } finally {
        setRemoteLoading(false);
      }
    },
    [tabId]
  );

  const connect = useCallback(
    async (opts?: {
      trustHostKey?: boolean;
      overrideAuth?: { username: string; password?: string };
    }) => {
      setConnState("connecting");
      setConnError(null);
      setHostKeyPrompt(null);
      setShowAuthPrompt(false);

      const authToUse = opts?.overrideAuth ?? runtimeAuth;
      try {
        const res = await api.connectSession({
          tab_id: tabId,
          protocol: session.protocol,
          host: session.host,
          port: session.port,
          credential_id: session.credential_id,
          username: authToUse?.username ?? null,
          password: authToUse?.password ?? null,
          remote_initial_path: session.remote_initial_path || null,
          passive_mode: session.passive_mode,
          accept_invalid_certs: session.accept_invalid_certs,
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
        const startDir = res.current_dir || "/";
        await loadRemoteDir(startDir);
      } catch (err) {
        setConnState("error");
        setConnError(extractErrorMessage(err));
      }
    },
    [tabId, session, runtimeAuth, loadRemoteDir]
  );

  const handleDisconnect = async () => {
    await api.disconnectSession(tabId).catch(() => {});
    setConnState("disconnected");
    setRemoteEntries([]);
  };

  // Init local directory & connect on mount
  useEffect(() => {
    let active = true;
    (async () => {
      const startLocal =
        session.local_initial_path || (await api.getDefaultLocalDir().catch(() => "/"));
      if (active && startLocal) {
        loadLocalDir(startLocal);
      }
    })();
    connect();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // File operations (Local)
  const handleLocalMkdir = async () => {
    const name = window.prompt(t("workspace.new_folder_prompt"));
    if (!name?.trim()) return;
    try {
      await api.localMkdir(joinPath(localPath, name.trim(), true));
      await loadLocalDir(localPath);
    } catch (err) {
      setLocalError(extractErrorMessage(err));
    }
  };

  const handleLocalRename = async (entry: FileEntry) => {
    const nextName = window.prompt(t("workspace.rename_prompt"), entry.name);
    if (!nextName?.trim() || nextName.trim() === entry.name) return;
    try {
      await api.localRename(entry.path, joinPath(localPath, nextName.trim(), true));
      await loadLocalDir(localPath);
    } catch (err) {
      setLocalError(extractErrorMessage(err));
    }
  };

  const handleLocalDelete = async (entry: FileEntry) => {
    if (!window.confirm(t("workspace.confirm_delete", { name: entry.name }))) return;
    try {
      await api.localDelete(entry.path, entry.is_dir);
      await loadLocalDir(localPath);
    } catch (err) {
      setLocalError(extractErrorMessage(err));
    }
  };

  // File operations (Remote)
  const handleRemoteMkdir = async () => {
    const name = window.prompt(t("workspace.new_folder_prompt"));
    if (!name?.trim()) return;
    try {
      await api.remoteMkdir(tabId, joinPath(remotePath, name.trim(), false));
      await loadRemoteDir(remotePath);
    } catch (err) {
      setRemoteError(extractErrorMessage(err));
    }
  };

  const handleRemoteRename = async (entry: FileEntry) => {
    const nextName = window.prompt(t("workspace.rename_prompt"), entry.name);
    if (!nextName?.trim() || nextName.trim() === entry.name) return;
    try {
      await api.remoteRename(
        tabId,
        entry.path,
        joinPath(remotePath, nextName.trim(), false)
      );
      await loadRemoteDir(remotePath);
    } catch (err) {
      setRemoteError(extractErrorMessage(err));
    }
  };

  const handleRemoteDelete = async (entry: FileEntry) => {
    if (!window.confirm(t("workspace.confirm_delete", { name: entry.name }))) return;
    try {
      await api.remoteDelete(tabId, entry.path, entry.is_dir);
      await loadRemoteDir(remotePath);
    } catch (err) {
      setRemoteError(extractErrorMessage(err));
    }
  };

  const handleRemoteChmod = async (entry: FileEntry) => {
    const currentOctal = entry.mode !== null ? entry.mode.toString(8) : "644";
    const input = window.prompt(t("workspace.chmod_prompt"), currentOctal);
    if (!input?.trim()) return;
    const parsed = parseInt(input.trim(), 8);
    if (Number.isNaN(parsed)) return;
    try {
      await api.remoteChmod(tabId, entry.path, parsed);
      await loadRemoteDir(remotePath);
    } catch (err) {
      setRemoteError(extractErrorMessage(err));
    }
  };

  const renderFileTable = (
    entries: FileEntry[],
    loading: boolean,
    error: string | null,
    isRemote: boolean
  ) => (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {error && (
        <div className="m-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}
      {loading ? (
        <div className="h-full flex items-center justify-center text-xs text-zinc-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="h-full flex items-center justify-center text-xs text-zinc-400">
          {t("workspace.empty_dir")}
        </div>
      ) : (
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500">
            <tr>
              <th className="text-left font-medium px-3 py-1.5">{t("workspace.col_name")}</th>
              <th className="text-right font-medium px-2 py-1.5 w-20">{t("workspace.col_size")}</th>
              <th className="text-left font-medium px-2 py-1.5 w-24 hidden lg:table-cell">
                {t("workspace.col_perms")}
              </th>
              <th className="w-20 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {entries.map((entry) => (
              <tr
                key={entry.path}
                onDoubleClick={() => {
                  if (entry.is_dir) {
                    if (isRemote) loadRemoteDir(entry.path);
                    else loadLocalDir(entry.path);
                  }
                }}
                className="group hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 cursor-pointer"
              >
                <td className="px-3 py-1.5 flex items-center gap-2 min-w-0">
                  {entry.is_dir ? (
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  )}
                  <span className="truncate text-zinc-800 dark:text-zinc-200">
                    {entry.name}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-[11px] text-zinc-500">
                  {entry.is_dir ? "—" : formatBytes(entry.size)}
                </td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-zinc-500 hidden lg:table-cell">
                  {entry.permissions ?? "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  <div className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      title={t("workspace.rename")}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isRemote) handleRemoteRename(entry);
                        else handleLocalRename(entry);
                      }}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {isRemote && (
                      <button
                        type="button"
                        title={t("workspace.chmod")}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoteChmod(entry);
                        }}
                        className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
                      >
                        <Shield className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      title={t("app.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isRemote) handleRemoteDelete(entry);
                        else handleLocalDelete(entry);
                      }}
                      className="p-1 rounded hover:bg-red-500/20 text-red-600 dark:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className={`flex-1 min-h-0 flex flex-col ${isActive ? "" : "hidden"}`}>
      {/* Session Status Bar */}
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
            {session.protocol}://{session.host}:{session.port}
          </span>
          <span className="text-[11px] text-zinc-500">
            •{" "}
            {connState === "connected"
              ? t("workspace.status_connected")
              : connState === "connecting"
              ? t("workspace.status_connecting")
              : connState === "error"
              ? t("workspace.status_error")
              : t("workspace.status_disconnected")}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
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

      {/* Dual File Explorer Panels */}
      <div className="flex-1 min-h-0 flex divide-x divide-zinc-200 dark:divide-zinc-800">
        {config.ui_show_local_panel && (
          <section className="flex-1 min-w-0 flex flex-col">
            <div className="px-2.5 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
                {t("workspace.panel_local")}
              </span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  loadLocalDir(localPathInput);
                }}
                className="flex-1 min-w-0"
              >
                <input
                  type="text"
                  value={localPathInput}
                  onChange={(e) => setLocalPathInput(e.target.value)}
                  className="w-full px-2 py-1 text-xs font-mono rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </form>
              <button
                type="button"
                title={t("workspace.parent_dir")}
                onClick={() => loadLocalDir(parentLocalPath(localPath))}
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title={t("workspace.new_folder")}
                onClick={handleLocalMkdir}
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title={t("workspace.refresh")}
                onClick={() => loadLocalDir(localPath)}
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            {renderFileTable(localEntries, localLoading, localError, false)}
          </section>
        )}

        <section className="flex-1 min-w-0 flex flex-col">
          <div className="px-2.5 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
              {t("workspace.panel_remote")}
            </span>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (connState === "connected") loadRemoteDir(remotePathInput);
              }}
              className="flex-1 min-w-0"
            >
              <input
                type="text"
                value={remotePathInput}
                onChange={(e) => setRemotePathInput(e.target.value)}
                disabled={connState !== "connected"}
                className="w-full px-2 py-1 text-xs font-mono rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </form>
            <button
              type="button"
              disabled={connState !== "connected"}
              title={t("workspace.parent_dir")}
              onClick={() => loadRemoteDir(parentRemotePath(remotePath))}
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={connState !== "connected"}
              title={t("workspace.new_folder")}
              onClick={handleRemoteMkdir}
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={connState !== "connected"}
              title={t("workspace.refresh")}
              onClick={() => loadRemoteDir(remotePath)}
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          {renderFileTable(
            remoteEntries,
            remoteLoading || connState === "connecting",
            connError ?? remoteError,
            true
          )}
        </section>
      </div>

      {/* Live Console / Command Panel (RF-14 & RF-15) */}
      {config.ui_show_command_panel && (
        <ConsolePanel
          tabId={tabId}
          protocol={session.protocol}
          connected={connState === "connected"}
        />
      )}

      {/* Transfer Queue Panel (Phase 4) */}
      {config.ui_show_queue_panel && (
        <section className="h-24 shrink-0 border-t border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-950 flex flex-col">
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            {t("workspace.panel_queue")}
          </div>
          <div className="flex-1 text-xs text-zinc-400">
            {t("workspace.queue_placeholder")}
          </div>
        </section>
      )}

      {/* SFTP TOFU Host Key Verification Modal */}
      {hostKeyPrompt && (
        <HostKeyModal
          info={hostKeyPrompt}
          onTrust={() => connect({ trustHostKey: true })}
          onCancel={() => setHostKeyPrompt(null)}
        />
      )}

      {/* On-the-fly Authentication Modal */}
      {showAuthPrompt && (
        <AuthPromptModal
          host={session.host}
          port={session.port}
          protocol={session.protocol}
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
