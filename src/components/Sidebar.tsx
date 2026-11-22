import { useEffect, useRef, useState } from "react";
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
  FolderTree,
  Terminal,
  Search,
  Play,
  X,
} from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import { ConfirmActionModal } from "./FileActionModals";
import { IconColorPicker, resolveIconColor } from "./IconColorPicker";
import type { Folder, Protocol, Session } from "../types";

interface SidebarProps {
  onNewSession: (folderId: string | null) => void;
  onEditSession: (session: Session) => void;
}

type SidebarContextMenu =
  | { x: number; y: number; kind: "session"; session: Session }
  | { x: number; y: number; kind: "folder"; folder: Folder }
  | { x: number; y: number; kind: "empty" };

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
  const [folderColorInput, setFolderColorInput] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "folder"; item: Folder } | { kind: "session"; item: Session } | null
  >(null);
  const [deleteFolderChildren, setDeleteFolderChildren] = useState(false);
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const toggleFolder = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderNameInput.trim()) return;
    await api.createFolder({
      parent_id: creatingFolderParent ?? null,
      name: folderNameInput.trim(),
      icon_color: folderColorInput,
    });
    setCreatingFolderParent(undefined);
    setFolderNameInput("");
    setFolderColorInput(null);
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
      icon_color: folder.icon_color ?? null,
    });
    setEditingFolderId(null);
    await refreshVaultData();
  };

  const handleChangeFolderColor = async (folder: Folder, hex: string | null) => {
    await api.updateFolder(folder.id, {
      parent_id: folder.parent_id,
      name: folder.name,
      sort_order: folder.sort_order,
      icon_color: hex,
    });
    setContextMenu(null);
    await refreshVaultData();
  };

  const handleChangeSessionColor = async (session: Session, hex: string | null) => {
    await api.updateSession(session.id, {
      folder_id: session.folder_id,
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
      icon_color: hex,
    });
    setContextMenu(null);
    await refreshVaultData();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    const cascade = deleteFolderChildren;
    setPendingDelete(null);
    setDeleteFolderChildren(false);
    if (target.kind === "folder") {
      await api.deleteFolder(target.item.id, cascade);
    } else {
      await api.deleteSession(target.item.id);
    }
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
          icon_color: session.icon_color ?? null,
        });
        await refreshVaultData();
      } else if (kind === "folder") {
        const folder = folders.find((f) => f.id === id);
        if (!folder || folder.id === targetFolderId || folder.parent_id === targetFolderId) return;
        await api.updateFolder(folder.id, {
          parent_id: targetFolderId,
          name: folder.name,
          sort_order: folder.sort_order,
          icon_color: folder.icon_color ?? null,
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
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, kind: "session", session });
      }}
      style={{ paddingLeft: `${depth * 16 + 6}px` }}
      className="flex items-center gap-1.5 pr-2 py-1 text-xs rounded-md hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80 cursor-default select-none transition-colors"
    >
      <span className="w-4 shrink-0" />
      {session.protocol === "ssh" ? (
        <Terminal
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: resolveIconColor(session.icon_color, "#a855f7") }}
        />
      ) : (
        <FolderTree
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: resolveIconColor(session.icon_color, "#38bdf8") }}
        />
      )}
      <span className="truncate flex-1 font-medium text-zinc-800 dark:text-zinc-200">
        {session.name}
      </span>
      <span
        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
          PROTOCOL_BADGE[session.protocol]
        }`}
      >
        {PROTOCOL_LABEL[session.protocol]}
      </span>
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
          const hasChildren =
            folders.some((f) => f.parent_id === folder.id) ||
            filteredSessions.some((s) => s.folder_id === folder.id);

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
                onClick={() => hasChildren && toggleFolder(folder.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ x: e.clientX, y: e.clientY, kind: "folder", folder });
                }}
                style={{ paddingLeft: `${depth * 16 + 6}px` }}
                className={`flex items-center gap-1.5 pr-2 py-1 text-xs rounded-md cursor-default select-none transition-colors ${
                  isDragOver
                    ? "bg-indigo-100 dark:bg-indigo-950/60 ring-1 ring-indigo-500"
                    : "hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80"
                }`}
              >
                <span className="w-4 h-4 flex items-center justify-center shrink-0">
                  {hasChildren ? (
                    isOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                    )
                  ) : null}
                </span>
                {isOpen && hasChildren ? (
                  <FolderOpen
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: resolveIconColor(folder.icon_color, "#f59e0b") }}
                  />
                ) : (
                  <FolderIcon
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: resolveIconColor(folder.icon_color, "#f59e0b") }}
                  />
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
              </div>

              {isOpen && renderFolderTree(folder.id, depth + 1)}
            </div>
          );
        })}

        {childSessions.map((s) => renderSessionItem(s, depth))}
      </>
    );
  };

  const menuItemClass =
    "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-zinc-800 dark:text-zinc-200 transition-colors cursor-default";
  const menuDangerClass =
    "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-red-50 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 transition-colors cursor-default";

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
            className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="p-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {creatingFolderParent !== undefined && (
        <form
          onSubmit={handleCreateFolder}
          className="p-2 border-b border-zinc-200 dark:border-zinc-800 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-2"
        >
          <div className="flex items-center gap-1.5">
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
              onClick={() => {
                setCreatingFolderParent(undefined);
                setFolderColorInput(null);
              }}
              className="px-1.5 py-1 text-xs rounded hover:bg-zinc-200 dark:hover:bg-zinc-800"
            >
              ✕
            </button>
          </div>
          <IconColorPicker
            value={folderColorInput}
            defaultHex="#f59e0b"
            onChange={setFolderColorInput}
            compact
          />
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
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, kind: "empty" });
        }}
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

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 196)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 170)),
            width: 188,
          }}
          className="fixed z-50 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl select-none"
          onContextMenu={(e) => e.preventDefault()}
        >
          {contextMenu.kind === "session" && (
            <>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  openSessionTab(contextMenu.session);
                  setContextMenu(null);
                }}
              >
                <Play className="w-3.5 h-3.5 text-indigo-500" />
                {t("sidebar.connect")}
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  onEditSession(contextMenu.session);
                  setContextMenu(null);
                }}
              >
                <Pencil className="w-3.5 h-3.5 text-zinc-500" />
                {t("app.edit")}
              </button>
              <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
              <div className="px-3 py-1.5 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {t("sidebar.icon_color")}
                </div>
                <IconColorPicker
                  value={contextMenu.session.icon_color}
                  defaultHex={contextMenu.session.protocol === "ssh" ? "#a855f7" : "#38bdf8"}
                  onChange={(hex) => handleChangeSessionColor(contextMenu.session, hex)}
                  compact
                />
              </div>
              <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
              <button
                type="button"
                className={menuDangerClass}
                onClick={() => {
                  setPendingDelete({ kind: "session", item: contextMenu.session });
                  setContextMenu(null);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("app.delete")}
              </button>
            </>
          )}

          {contextMenu.kind === "folder" && (
            <>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  onNewSession(contextMenu.folder.id);
                  setContextMenu(null);
                }}
              >
                <Plus className="w-3.5 h-3.5 text-indigo-500" />
                {t("sidebar.new_session")}
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  setCreatingFolderParent(contextMenu.folder.id);
                  setFolderNameInput("");
                  setContextMenu(null);
                }}
              >
                <FolderPlus className="w-3.5 h-3.5 text-zinc-500" />
                {t("sidebar.new_folder")}
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  setEditingFolderId(contextMenu.folder.id);
                  setEditingFolderName(contextMenu.folder.name);
                  setContextMenu(null);
                }}
              >
                <Pencil className="w-3.5 h-3.5 text-zinc-500" />
                {t("workspace.rename")}
              </button>
              <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
              <div className="px-3 py-1.5 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {t("sidebar.icon_color")}
                </div>
                <IconColorPicker
                  value={contextMenu.folder.icon_color}
                  defaultHex="#f59e0b"
                  onChange={(hex) => handleChangeFolderColor(contextMenu.folder, hex)}
                  compact
                />
              </div>
              <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
              <button
                type="button"
                className={menuDangerClass}
                onClick={() => {
                  setDeleteFolderChildren(false);
                  setPendingDelete({ kind: "folder", item: contextMenu.folder });
                  setContextMenu(null);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("app.delete")}
              </button>
            </>
          )}

          {contextMenu.kind === "empty" && (
            <>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  onNewSession(null);
                  setContextMenu(null);
                }}
              >
                <Plus className="w-3.5 h-3.5 text-indigo-500" />
                {t("sidebar.new_session")}
              </button>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  setCreatingFolderParent(null);
                  setFolderNameInput("");
                  setContextMenu(null);
                }}
              >
                <FolderPlus className="w-3.5 h-3.5 text-zinc-500" />
                {t("sidebar.new_folder")}
              </button>
            </>
          )}
        </div>
      )}

      {pendingDelete && (
        <ConfirmActionModal
          title={t("workspace.confirm_delete_title")}
          message={
            pendingDelete.kind === "folder"
              ? t("sidebar.confirm_delete_folder", { name: pendingDelete.item.name })
              : t("sidebar.confirm_delete_session", { name: pendingDelete.item.name })
          }
          checkboxLabel={
            pendingDelete.kind === "folder"
              ? t("sidebar.delete_folder_children")
              : undefined
          }
          checkboxChecked={deleteFolderChildren}
          onCheckboxChange={setDeleteFolderChildren}
          onConfirm={confirmDelete}
          onCancel={() => {
            setPendingDelete(null);
            setDeleteFolderChildren(false);
          }}
        />
      )}
    </aside>
  );
}
