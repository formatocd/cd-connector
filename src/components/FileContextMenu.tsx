import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  Shield,
  Copy,
  RefreshCw,
  CheckSquare,
  ArrowUpFromLine,
  ArrowDownToLine,
} from "lucide-react";
import type { FileEntry } from "../types";

export interface ContextMenuState {
  x: number;
  y: number;
  target: FileEntry | null; // null = right-clicked empty space
}

interface FileContextMenuProps {
  menu: ContextMenuState;
  selectedEntries: FileEntry[];
  isRemote: boolean;
  currentPath: string;
  onClose: () => void;
  onOpenFolder: (entry: FileEntry) => void;
  onNewFolder: () => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entries: FileEntry[]) => void;
  onProperties: (entry: FileEntry) => void;
  onCopyPath: (path: string) => void;
  onRefresh: () => void;
  onSelectAll: () => void;
  onTransfer?: (entries: FileEntry[]) => void;
}

export function FileContextMenu({
  menu,
  selectedEntries,
  isRemote,
  currentPath,
  onClose,
  onOpenFolder,
  onNewFolder,
  onRename,
  onDelete,
  onProperties,
  onCopyPath,
  onRefresh,
  onSelectAll,
  onTransfer,
}: FileContextMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Clamp position inside viewport
  const menuWidth = 220;
  const menuHeight = menu.target ? 260 : 150;
  const left = Math.min(menu.x, window.innerWidth - menuWidth - 8);
  const top = Math.min(menu.y, window.innerHeight - menuHeight - 8);

  const single = selectedEntries.length === 1 ? selectedEntries[0] : null;

  const itemClass =
    "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-zinc-800 dark:text-zinc-200 transition-colors cursor-default";
  const dangerClass =
    "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-left hover:bg-red-50 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 transition-colors cursor-default";

  return (
    <div
      ref={ref}
      style={{ left: Math.max(8, left), top: Math.max(8, top), width: menuWidth }}
      className="fixed z-50 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.target && selectedEntries.length > 0 ? (
        <>
          {onTransfer && (
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                onTransfer(selectedEntries);
                onClose();
              }}
            >
              <span className="flex items-center gap-2 font-medium">
                {isRemote ? (
                  <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <ArrowUpFromLine className="w-3.5 h-3.5 text-sky-500" />
                )}
                {isRemote ? t("workspace.ctx_download") : t("workspace.ctx_upload")}
                {selectedEntries.length > 1 ? ` (${selectedEntries.length})` : ""}
              </span>
            </button>
          )}

          {single && single.is_dir && (
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                onOpenFolder(single);
                onClose();
              }}
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                {t("workspace.ctx_open")}
              </span>
              <span className="text-[10px] text-zinc-400">Enter</span>
            </button>
          )}

          {single && (
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                onRename(single);
                onClose();
              }}
            >
              <span className="flex items-center gap-2">
                <Pencil className="w-3.5 h-3.5 text-zinc-500" />
                {t("workspace.rename")}
              </span>
              <span className="text-[10px] text-zinc-400">F2</span>
            </button>
          )}

          {single && (
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                onProperties(single);
                onClose();
              }}
            >
              <span className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-zinc-500" />
                {isRemote ? t("workspace.ctx_properties") : t("workspace.props_title")}
              </span>
            </button>
          )}

          {single && (
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                onCopyPath(single.path);
                onClose();
              }}
            >
              <span className="flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 text-zinc-500" />
                {t("workspace.ctx_copy_path")}
              </span>
            </button>
          )}

          <button
            type="button"
            className={dangerClass}
            onClick={() => {
              onDelete(selectedEntries);
              onClose();
            }}
          >
            <span className="flex items-center gap-2">
              <Trash2 className="w-3.5 h-3.5" />
              {selectedEntries.length > 1
                ? `${t("app.delete")} (${selectedEntries.length})`
                : t("app.delete")}
            </span>
            <span className="text-[10px] opacity-60">Del</span>
          </button>

          <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />

          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onNewFolder();
              onClose();
            }}
          >
            <span className="flex items-center gap-2">
              <FolderPlus className="w-3.5 h-3.5 text-zinc-500" />
              {t("workspace.new_folder")}
            </span>
          </button>

          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onRefresh();
              onClose();
            }}
          >
            <span className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
              {t("workspace.refresh")}
            </span>
            <span className="text-[10px] text-zinc-400">F5</span>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onNewFolder();
              onClose();
            }}
          >
            <span className="flex items-center gap-2">
              <FolderPlus className="w-3.5 h-3.5 text-zinc-500" />
              {t("workspace.new_folder")}
            </span>
          </button>

          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onSelectAll();
              onClose();
            }}
          >
            <span className="flex items-center gap-2">
              <CheckSquare className="w-3.5 h-3.5 text-zinc-500" />
              {t("workspace.ctx_select_all")}
            </span>
            <span className="text-[10px] text-zinc-400">Ctrl+A</span>
          </button>

          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onCopyPath(currentPath);
              onClose();
            }}
          >
            <span className="flex items-center gap-2">
              <Copy className="w-3.5 h-3.5 text-zinc-500" />
              {t("workspace.ctx_copy_path")}
            </span>
          </button>

          <button
            type="button"
            className={itemClass}
            onClick={() => {
              onRefresh();
              onClose();
            }}
          >
            <span className="flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
              {t("workspace.refresh")}
            </span>
            <span className="text-[10px] text-zinc-400">F5</span>
          </button>
        </>
      )}
    </div>
  );
}
