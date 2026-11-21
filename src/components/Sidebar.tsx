import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Plus,
  Pencil,
  Trash2,
  Server,
  Terminal,
  Search,
  Play,
} from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import type { Folder, Protocol, Session } from "../types";

interface SidebarProps {
  onNewSession: (folderId: string | null) => void;
  onEditSession: (session: Session) => void;
}

const PROTOCOL_BADGE: Record<Protocol, string> = {
  ftp: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  ftps_explicit: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  ftps_implicit: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  sftp: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  ssh: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
};

const PROTOCOL_LABEL: Record<Protocol, string> = {
  ftp: "FTP",
  ftps_explicit: "FTPS",
  ftps_implicit: "FTPS-I",
  sftp: "SFTP",
  ssh: "SSH",
};

export function Sidebar({ onNewSession, onEditSession }: SidebarProps) {
  const { t } = useTranslation();
  const { folders, sessions, refreshVaultData, openSessionTab } = useAppStore();

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [creatingFolderParent, setCreatingFolderParent] = useState<string | null | undefined>(
    undefined
  );
  const [folderNameInput, setFolderNameInput] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const toggleFolder = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderNameInput.trim()) return;
    await api.createFolder({
      parent_id: creatingFolderParent ?? null,
      name: folderNameInput.trim(),
    });
    setCreatingFolderParent(undefined);
    setFolderNameInput("");
    await refreshVaultData();
  };

  const handleRenameFolder = async (folder: Folder) => {
    if (!editingFolderName.trim()) {
      setEditingFolderId(null);
      return;
    }
    await api.updateFolder(folder.id, {
      parent_id: folder.parent_id,
      name: editingFolderName.trim(),
      sort_order: folder.sort_order,
    });
    setEditingFolderId(null);
    await refreshVaultData();
  };

  const handleDeleteFolder = async (folder: Folder) => {
    if (!window.confirm(t("sidebar.confirm_delete_folder", { name: folder.name }))) {
      return;
    }
    await api.deleteFolder(folder.id);
    await refreshVaultData();
  };

  const handleDeleteSession = async (session: Session) => {
    if (!window.confirm(t("sidebar.confirm_delete_session", { name: session.name }))) {
      return;
    }
    await api.deleteSession(session.id);
    await refreshVaultData();
  };

  const handleDropOnFolder = async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    const kind = e.dataTransfer.getData("application/x-cd-kind");
    const id = e.dataTransfer.getData("application/x-cd-id");
    if (!kind || !id) return;

    try {
      if (kind === "session") {
        const session = sessions.find((s) => s.id === id);
        if (!session || session.folder_id === targetFolderId) return;
        await api.updateSession(session.id, {
          folder_id: targetFolderId,
          credential_id: session.credential_id,
          name: session.name,
          protocol: session.protocol,
          host: session.host,
          port: session.port,
          remote_initial_path: session.remote_initial_path,
          local_initial_path: session.local_initial_path,
          passive_mode: session.passive_mode,
          accept_invalid_certs: session.accept_invalid_certs,
          sort_order: session.sort_order,
        });
        await refreshVaultData();
      } else if (kind === "folder") {
        const folder = folders.find((f) => f.id === id);
        if (!folder || folder.id === targetFolderId || folder.parent_id === targetFolderId) return;
        await api.updateFolder(folder.id, {
          parent_id: targetFolderId,
          name: folder.name,
          sort_order: folder.sort_order,
        });
        await refreshVaultData();
      }
    } catch (err) {
      console.error("Drop failed:", err);
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredSessions = normalizedSearch
    ? sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(normalizedSearch) ||
          s.host.toLowerCase().includes(normalizedSearch)
      )
    : sessions;

  const renderSessionItem = (session: Session, depth: number) => (
    <div
      key={session.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-cd-kind", "session");
        e.dataTransfer.setData("application/x-cd-id", session.id);
      }}
      onDoubleClick={() => openSessionTab(session)}
      style={{ paddingLeft: `${depth * 14 + 10}px` }}
      className="group flex items-center gap-1.5 pr-2 py-1.5 text-xs rounded-md hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80 cursor-pointer transition-colors"
    >
      {session.protocol === "ssh" ? (
        <Terminal className="w-3.5 h-3.5 text-purple-500 shrink-0" />
      ) : (
        <Server className="w-3.5 h-3.5 text-sky-500 shrink-0" />
      )}
      <span className="truncate flex-1 font-medium text-zinc-800 dark:text-zinc-200">
        {session.name}
      </span>
      <span
        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
          PROTOCOL_BADGE[session.protocol]
        }`}
      >
        {PROTOCOL_LABEL[session.protocol]}
      </span>
      <div className="hidden group-hover:flex items-center gap-0.5">
        <button
          type="button"
          title={t("sidebar.connect")}
          onClick={(e) => {
            e.stopPropagation();
            openSessionTab(session);
          }}
          className="p-1 rounded hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400"
        >
          <Play className="w-3 h-3" />
        </button>
        <button
          type="button"
          title={t("app.edit")}
          onClick={(e) => {
            e.stopPropagation();
            onEditSession(session);
          }}
          className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          type="button"
          title={t("app.delete")}
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteSession(session);
          }}
          className="p-1 rounded hover:bg-red-500/20 text-red-600 dark:text-red-400"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  const renderFolderTree = (parentId: string | null, depth: number) => {
    const childFolders = folders.filter((f) => f.parent_id === parentId);
    const childSessions = filteredSessions.filter((s) => s.folder_id === parentId);

    return (
      <>
        {childFolders.map((folder) => {
          const isOpen = expanded[folder.id] ?? true;
          const isDragOver = dragOverTarget === folder.id;

          return (
            <div key={folder.id}>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-cd-kind", "folder");
                  e.dataTransfer.setData("application/x-cd-id", folder.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverTarget(folder.id);
                }}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={(e) => handleDropOnFolder(e, folder.id)}
                style={{ paddingLeft: `${depth * 14 + 6}px` }}
                className={`group flex items-center gap-1 pr-2 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
                  isDragOver
                    ? "bg-indigo-100 dark:bg-indigo-950/60 ring-1 ring-indigo-500"
                    : "hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80"
                }`}
                onClick={() => toggleFolder(folder.id)}
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                )}
                {isOpen ? (
                  <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                ) : (
                  <FolderIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                )}

                {editingFolderId === folder.id ? (
                  <input
                    value={editingFolderName}
                    onChange={(e) => setEditingFolderName(e.target.value)}
                    onBlur={() => handleRenameFolder(folder)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameFolder(folder);
                      if (e.key === "Escape") setEditingFolderId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="flex-1 min-w-0 px-1.5 py-0.5 text-xs rounded bg-white dark:bg-zinc-950 border border-indigo-500 focus:outline-none"
                  />
                ) : (
                  <span className="truncate flex-1 font-medium text-zinc-700 dark:text-zinc-300">
                    {folder.name}
                  </span>
                )}

                <div className="hidden group-hover:flex items-center gap-0.5">
                  <button
                    type="button"
                    title={t("sidebar.new_session")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewSession(folder.id);
                    }}
                    className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title={t("sidebar.new_folder")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCreatingFolderParent(folder.id);
                      setFolderNameInput("");
                    }}
                    className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700"
                  >
                    <FolderPlus className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title={t("app.edit")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingFolderId(folder.id);
                      setEditingFolderName(folder.name);
                    }}
                    className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title={t("app.delete")}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFolder(folder);
                    }}
                    className="p-1 rounded hover:bg-red-500/20 text-red-600 dark:text-red-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {isOpen && renderFolderTree(folder.id, depth + 1)}
            </div>
          );
        })}

        {childSessions.map((s) => renderSessionItem(s, depth))}
      </>
    );
  };

  return (
    <aside className="w-68 shrink-0 h-full flex flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60">
      <div className="px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {t("sidebar.title")}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={t("sidebar.new_folder")}
            onClick={() => {
              setCreatingFolderParent(null);
              setFolderNameInput("");
            }}
            className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t("sidebar.new_session")}
            onClick={() => onNewSession(null)}
            className="p-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-2 border-b border-zinc-200/70 dark:border-zinc-800/70">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("app.search")}
            className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {creatingFolderParent !== undefined && (
        <form
          onSubmit={handleCreateFolder}
          className="p-2 border-b border-zinc-200 dark:border-zinc-800 bg-indigo-50/50 dark:bg-indigo-950/20 flex items-center gap-1.5"
        >
          <input
            type="text"
            value={folderNameInput}
            onChange={(e) => setFolderNameInput(e.target.value)}
            placeholder={t("sidebar.folder_name_placeholder")}
            autoFocus
            className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-indigo-400 bg-white dark:bg-zinc-950 focus:outline-none"
          />
          <button
            type="submit"
            className="px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {t("app.create")}
          </button>
          <button
            type="button"
            onClick={() => setCreatingFolderParent(undefined)}
            className="px-1.5 py-1 text-xs rounded hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </form>
      )}

      <div
        className={`flex-1 overflow-y-auto p-1.5 space-y-0.5 ${
          dragOverTarget === "__root__" ? "bg-indigo-50/40 dark:bg-indigo-950/20" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverTarget("__root__");
        }}
        onDragLeave={() => setDragOverTarget(null)}
        onDrop={(e) => handleDropOnFolder(e, null)}
      >
        {folders.length === 0 && sessions.length === 0 ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center px-4 py-8 leading-relaxed">
            {t("sidebar.empty")}
          </p>
        ) : normalizedSearch ? (
          filteredSessions.map((s) => renderSessionItem(s, 0))
        ) : (
          renderFolderTree(null, 0)
        )}
      </div>
    </aside>
  );
}
