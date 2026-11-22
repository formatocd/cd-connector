import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Plug, Unplug, Terminal } from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import { ConsolePanel } from "./ConsolePanel";
import { HostKeyModal } from "./HostKeyModal";
import { AuthPromptModal } from "./AuthPromptModal";
import { FileExplorerPanel } from "./FileExplorerPanel";
import { TransferQueuePanel } from "./TransferQueuePanel";
import {
  ConfirmDeleteModal,
  PropertiesModal,
  TextPromptModal,
} from "./FileActionModals";
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

type ModalState =
  | { kind: "mkdir"; isRemote: boolean }
  | { kind: "rename"; isRemote: boolean; entry: FileEntry }
  | { kind: "delete"; isRemote: boolean; entries: FileEntry[] }
  | { kind: "properties"; isRemote: boolean; entry: FileEntry }
  | null;

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
  const { config, credentials, openSessionTab } = useAppStore();
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
  const [localEntries, setLocalEntries] = useState<FileEntry[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Remote explorer state
  const [remotePath, setRemotePath] = useState(session.remote_initial_path || "/");
  const [remoteEntries, setRemoteEntries] = useState<FileEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  // In-app file action modal state
  const [modal, setModal] = useState<ModalState>(null);
  const [osDragOver, setOsDragOver] = useState(false);

  const linkedCred = session.credential_id
    ? credentials.find((c) => c.id === session.credential_id) ?? null
    : null;

  const loadLocalDir = useCallback(async (targetPath: string) => {
    setLocalLoading(true);
    setLocalError(null);
    try {
      const entries = await api.localListDir(targetPath);
      setLocalPath(targetPath);
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

  useEffect(() => {
    let active = true;
    const connectTimer = window.setTimeout(() => {
      if (!active) return;
      (async () => {
        const startLocal =
          session.local_initial_path || (await api.getDefaultLocalDir().catch(() => "/"));
        if (active && startLocal) {
          loadLocalDir(startLocal);
        }
      })();
      connect();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(connectTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Execute modal actions
  const executeMkdir = async (isRemote: boolean, name: string) => {
    setModal(null);
    try {
      if (isRemote) {
        await api.remoteMkdir(tabId, joinPath(remotePath, name, false));
        await loadRemoteDir(remotePath);
      } else {
        await api.localMkdir(joinPath(localPath, name, true));
        await loadLocalDir(localPath);
      }
    } catch (err) {
      if (isRemote) setRemoteError(extractErrorMessage(err));
      else setLocalError(extractErrorMessage(err));
    }
  };

  const executeRename = async (isRemote: boolean, entry: FileEntry, nextName: string) => {
    setModal(null);
    if (nextName === entry.name) return;
    try {
      if (isRemote) {
        await api.remoteRename(tabId, entry.path, joinPath(remotePath, nextName, false));
        await loadRemoteDir(remotePath);
      } else {
        await api.localRename(entry.path, joinPath(localPath, nextName, true));
        await loadLocalDir(localPath);
      }
    } catch (err) {
      if (isRemote) setRemoteError(extractErrorMessage(err));
      else setLocalError(extractErrorMessage(err));
    }
  };

  const executeDelete = async (isRemote: boolean, entries: FileEntry[]) => {
    setModal(null);
    try {
      for (const entry of entries) {
        if (isRemote) {
          await api.remoteDelete(tabId, entry.path, entry.is_dir);
        } else {
          await api.localDelete(entry.path, entry.is_dir);
        }
      }
      if (isRemote) await loadRemoteDir(remotePath);
      else await loadLocalDir(localPath);
    } catch (err) {
      if (isRemote) setRemoteError(extractErrorMessage(err));
      else setLocalError(extractErrorMessage(err));
    }
  };

  const executeChmod = async (entry: FileEntry, mode: number) => {
    try {
      await api.remoteChmod(tabId, entry.path, mode);
      await loadRemoteDir(remotePath);
    } catch (err) {
      setRemoteError(extractErrorMessage(err));
    }
  };

  // Enqueue uploads (Local -> Remote)
  const handleUploadEntries = useCallback(
    async (entries: FileEntry[]) => {
      if (connState !== "connected" || entries.length === 0) return;
      try {
        await api.enqueueTransfers({
          tab_id: tabId,
          direction: "upload",
          items: entries.map((e) => ({
            local_path: e.path,
            remote_path: joinPath(remotePath, e.name, false),
            is_dir: e.is_dir,
          })),
        });
      } catch (err) {
        setRemoteError(extractErrorMessage(err));
      }
    },
    [connState, tabId, remotePath]
  );

  // Enqueue downloads (Remote -> Local)
  const handleDownloadEntries = useCallback(
    async (entries: FileEntry[]) => {
      if (connState !== "connected" || entries.length === 0 || !localPath) return;
      try {
        await api.enqueueTransfers({
          tab_id: tabId,
          direction: "download",
          items: entries.map((e) => ({
            local_path: joinPath(localPath, e.name, true),
            remote_path: e.path,
            is_dir: e.is_dir,
          })),
        });
      } catch (err) {
        setLocalError(extractErrorMessage(err));
      }
    },
    [connState, tabId, localPath]
  );

  // Auto-refresh destination panel when a transfer finishes for this tab
  useEffect(() => {
    const unlistenPromise = listen<{ tab_id: string; direction: "upload" | "download" }>(
      "transfer-completed",
      (event) => {
        if (event.payload.tab_id !== tabId) return;
        if (event.payload.direction === "upload") {
          loadRemoteDir(remotePath);
        } else {
          loadLocalDir(localPath);
        }
      }
    );
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [tabId, remotePath, localPath, loadRemoteDir, loadLocalDir]);

  // Native OS-to-App Drag & Drop upload (RF-13)
  useEffect(() => {
    if (!isActive) return;
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (connState !== "connected") return;
      if (event.payload.type === "over" || event.payload.type === "enter") {
        setOsDragOver(true);
      } else if (event.payload.type === "leave") {
        setOsDragOver(false);
      } else if (event.payload.type === "drop") {
        setOsDragOver(false);
        const paths = event.payload.paths;
        if (paths.length === 0) return;
        const items = paths.map((p) => {
          const name = p.split(/[\\/]/).filter(Boolean).pop() ?? p;
          return {
            local_path: p,
            remote_path: joinPath(remotePath, name, false),
            is_dir: false, // Backend checks Path::is_dir() automatically
          };
        });
        api
          .enqueueTransfers({
            tab_id: tabId,
            direction: "upload",
            items,
          })
          .catch((err) => setRemoteError(extractErrorMessage(err)));
      }
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [isActive, connState, tabId, remotePath]);

  const vHandleClass =
    "h-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-indigo-500/70 active:bg-indigo-500 transition-colors cursor-row-resize";
  const hHandleClass =
    "w-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-indigo-500/70 active:bg-indigo-500 transition-colors cursor-col-resize";

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
          {session.protocol === "sftp" && connState === "connected" && (
            <button
              type="button"
              onClick={() =>
                openSessionTab(
                  {
                    ...session,
                    id: `ssh-from-${session.id}`,
                    name: `${session.name} (SSH)`,
                    protocol: "ssh",
                    remote_initial_path: remotePath,
                  },
                  runtimeAuth ?? undefined
                )
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-950/70 cursor-pointer"
            >
              <Terminal className="w-3 h-3" />
              {t("workspace.open_ssh_here")}
            </button>
          )}
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

      {/* Resizable Modular Panels */}
      <div className="flex-1 min-h-0">
        <PanelGroup direction="vertical">
          <Panel id="explorers" order={1} defaultSize={65} minSize={25}>
            <PanelGroup direction="horizontal">
              {config.ui_show_local_panel && (
                <>
                  <Panel id="local" order={1} defaultSize={50} minSize={20}>
                    <FileExplorerPanel
                      title={t("workspace.panel_local")}
                      path={localPath}
                      entries={localEntries}
                      loading={localLoading}
                      error={localError}
                      isRemote={false}
                      onNavigate={loadLocalDir}
                      onFetchSubdirs={(p) => api.localListDir(p)}
                      onParentDir={() => loadLocalDir(parentLocalPath(localPath))}
                      onRefresh={() => loadLocalDir(localPath)}
                      onNewFolder={() => setModal({ kind: "mkdir", isRemote: false })}
                      onRename={(entry) =>
                        setModal({ kind: "rename", isRemote: false, entry })
                      }
                      onDelete={(entries) =>
                        setModal({ kind: "delete", isRemote: false, entries })
                      }
                      onProperties={(entry) =>
                        setModal({ kind: "properties", isRemote: false, entry })
                      }
                      onTransfer={
                        connState === "connected" ? handleUploadEntries : undefined
                      }
                      onDropFromOpposite={
                        connState === "connected" ? handleDownloadEntries : undefined
                      }
                    />
                  </Panel>
                  <PanelResizeHandle className={hHandleClass} />
                </>
              )}

              <Panel id="remote" order={2} defaultSize={50} minSize={20}>
                <FileExplorerPanel
                  title={t("workspace.panel_remote")}
                  path={remotePath}
                  entries={remoteEntries}
                  loading={remoteLoading || connState === "connecting"}
                  error={connError ?? remoteError}
                  isRemote={true}
                  disabled={connState !== "connected"}
                  onNavigate={loadRemoteDir}
                  onFetchSubdirs={(p) => api.remoteListDir(tabId, p)}
                  onParentDir={() => loadRemoteDir(parentRemotePath(remotePath))}
                  onRefresh={() => loadRemoteDir(remotePath)}
                  onNewFolder={() => setModal({ kind: "mkdir", isRemote: true })}
                  onRename={(entry) =>
                    setModal({ kind: "rename", isRemote: true, entry })
                  }
                  onDelete={(entries) =>
                    setModal({ kind: "delete", isRemote: true, entries })
                  }
                  onProperties={(entry) =>
                    setModal({ kind: "properties", isRemote: true, entry })
                  }
                  onTransfer={handleDownloadEntries}
                  onDropFromOpposite={handleUploadEntries}
                />
              </Panel>
            </PanelGroup>
          </Panel>

          {config.ui_show_command_panel && (
            <>
              <PanelResizeHandle className={vHandleClass} />
              <Panel id="console" order={2} defaultSize={20} minSize={12}>
                <ConsolePanel
                  tabId={tabId}
                  protocol={session.protocol}
                  connected={connState === "connected"}
                />
              </Panel>
            </>
          )}

          {config.ui_show_queue_panel && (
            <>
              <PanelResizeHandle className={vHandleClass} />
              <Panel id="queue" order={3} defaultSize={18} minSize={12}>
                <TransferQueuePanel />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      {/* Native OS Drag & Drop Upload Overlay */}
      {osDragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-indigo-500/10 ring-4 ring-inset ring-indigo-500 flex items-center justify-center">
          <div className="px-5 py-3 rounded-2xl bg-indigo-600 text-white text-sm font-medium shadow-2xl">
            {t("workspace.drop_to_upload")} ({remotePath})
          </div>
        </div>
      )}

      {/* File Action Modals */}
      {modal?.kind === "mkdir" && (
        <TextPromptModal
          title={t("workspace.new_folder")}
          label={t("workspace.new_folder_prompt")}
          confirmLabel={t("app.create")}
          onConfirm={(name) => executeMkdir(modal.isRemote, name)}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "rename" && (
        <TextPromptModal
          title={t("workspace.rename")}
          label={t("workspace.rename_prompt")}
          initialValue={modal.entry.name}
          confirmLabel={t("app.save")}
          selectStem={!modal.entry.is_dir}
          onConfirm={(nextName) => executeRename(modal.isRemote, modal.entry, nextName)}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "delete" && (
        <ConfirmDeleteModal
          entries={modal.entries}
          onConfirm={() => executeDelete(modal.isRemote, modal.entries)}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "properties" && (
        <PropertiesModal
          entry={modal.entry}
          isRemote={modal.isRemote}
          onApplyChmod={
            modal.isRemote ? (mode) => executeChmod(modal.entry, mode) : undefined
          }
          onClose={() => setModal(null)}
        />
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
