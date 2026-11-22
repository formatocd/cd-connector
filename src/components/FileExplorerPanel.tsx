import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  ArrowUp,
  FolderPlus,
  FolderTree,
  RefreshCw,
  Loader2,
  AlertCircle,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { DirectoryTreePane } from "./DirectoryTreePane";
import { FileIcon } from "./FileIcon";
import { FileContextMenu, type ContextMenuState } from "./FileContextMenu";
import type { FileEntry } from "../types";

type SortKey = "name" | "size" | "permissions" | "modified";
type SortDir = "asc" | "desc";

interface FileExplorerPanelProps {
  title: string;
  path: string;
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  isRemote: boolean;
  disabled?: boolean;
  onNavigate: (path: string) => void;
  onFetchSubdirs: (path: string) => Promise<FileEntry[]>;
  onParentDir: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entries: FileEntry[]) => void;
  onProperties: (entry: FileEntry) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatModified(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FileExplorerPanel({
  title,
  path,
  entries,
  loading,
  error,
  isRemote,
  disabled = false,
  onNavigate,
  onFetchSubdirs,
  onParentDir,
  onRefresh,
  onNewFolder,
  onRename,
  onDelete,
  onProperties,
}: FileExplorerPanelProps) {
  const { t } = useTranslation();

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showTree, setShowTree] = useState(true);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset selection when directory changes
  useEffect(() => {
    setSelectedPaths(new Set());
    setAnchorIndex(null);
    setContextMenu(null);
  }, [path]);

  const sortedEntries = useMemo(() => {
    const copy = [...entries];
    copy.sort((a, b) => {
      // Keep directories grouped first
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case "size":
          cmp = a.size - b.size;
          break;
        case "permissions":
          cmp = (a.permissions ?? "").localeCompare(b.permissions ?? "");
          break;
        case "modified":
          cmp = (a.modified ?? "").localeCompare(b.modified ?? "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [entries, sortKey, sortDir]);

  const rowVirtualizer = useVirtualizer({
    count: sortedEntries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 20,
  });

  const selectedEntries = useMemo(
    () => sortedEntries.filter((e) => selectedPaths.has(e.path)),
    [sortedEntries, selectedPaths]
  );

  const selectedTotalBytes = useMemo(
    () => selectedEntries.reduce((acc, e) => acc + (e.is_dir ? 0 : e.size), 0),
    [selectedEntries]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleRowClick = (e: React.MouseEvent, index: number, entry: FileEntry) => {
    if (e.shiftKey && anchorIndex !== null) {
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      const next = new Set(e.ctrlKey || e.metaKey ? selectedPaths : []);
      for (let i = start; i <= end; i++) {
        next.add(sortedEntries[i].path);
      }
      setSelectedPaths(next);
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedPaths);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      setSelectedPaths(next);
      setAnchorIndex(index);
    } else {
      setSelectedPaths(new Set([entry.path]));
      setAnchorIndex(index);
    }
  };

  const handleRowContextMenu = (
    e: React.MouseEvent,
    index: number,
    entry: FileEntry
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
      setAnchorIndex(index);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, target: entry });
  };

  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, target: null });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelectedPaths(new Set(sortedEntries.map((item) => item.path)));
      return;
    }
    if (e.key === "F5") {
      e.preventDefault();
      onRefresh();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      onParentDir();
      return;
    }
    if (e.key === "F2" && selectedEntries.length === 1) {
      e.preventDefault();
      onRename(selectedEntries[0]);
      return;
    }
    if (e.key === "Delete" && selectedEntries.length > 0) {
      e.preventDefault();
      onDelete(selectedEntries);
      return;
    }
    if (e.key === "Enter" && selectedEntries.length === 1 && selectedEntries[0].is_dir) {
      e.preventDefault();
      onNavigate(selectedEntries[0].path);
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && sortedEntries.length > 0) {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const baseIdx = anchorIndex ?? (delta > 0 ? -1 : sortedEntries.length);
      const nextIdx = Math.max(0, Math.min(sortedEntries.length - 1, baseIdx + delta));
      const nextEntry = sortedEntries[nextIdx];
      setSelectedPaths(new Set([nextEntry.path]));
      setAnchorIndex(nextIdx);
      rowVirtualizer.scrollToIndex(nextIdx);
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 text-indigo-500" />
    ) : (
      <ChevronDown className="w-3 h-3 text-indigo-500" />
    );
  };

  return (
    <section
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full w-full min-w-0 flex flex-col bg-white dark:bg-zinc-950 focus:outline-none"
    >
      {/* Header & Breadcrumb Bar */}
      <div className="px-2.5 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
          {title}
        </span>

        <BreadcrumbBar
          path={path}
          isLocal={!isRemote}
          disabled={disabled}
          onNavigate={onNavigate}
        />

        <button
          type="button"
          title={t("workspace.toggle_tree")}
          onClick={() => setShowTree((v) => !v)}
          className={`p-1 rounded cursor-pointer shrink-0 transition-colors ${
            showTree
              ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400"
              : "hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500"
          }`}
        >
          <FolderTree className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={disabled}
          title={t("workspace.parent_dir")}
          onClick={onParentDir}
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer shrink-0"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={disabled}
          title={t("workspace.new_folder")}
          onClick={onNewFolder}
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer shrink-0"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={disabled}
          title={t("workspace.refresh")}
          onClick={onRefresh}
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tree + File List Area */}
      <div className="flex-1 min-h-0 flex flex-col">
        <PanelGroup direction="vertical">
          {showTree && (
            <>
              <Panel id={isRemote ? "remote-tree" : "local-tree"} order={1} defaultSize={30} minSize={12}>
                <DirectoryTreePane
                  currentPath={path}
                  currentEntries={entries}
                  isRemote={isRemote}
                  disabled={disabled}
                  onNavigate={onNavigate}
                  onFetchSubdirs={onFetchSubdirs}
                />
              </Panel>
              <PanelResizeHandle className="h-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-indigo-500/70 active:bg-indigo-500 transition-colors cursor-row-resize" />
            </>
          )}

          <Panel id={isRemote ? "remote-list" : "local-list"} order={2} defaultSize={70} minSize={25}>
            <div className="h-full w-full flex flex-col">
              {/* Column Headers */}
              <div className="grid grid-cols-[1fr_76px_88px_116px] items-center px-3 py-1 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 text-[11px] font-medium text-zinc-500 shrink-0 select-none">
                <button
                  type="button"
                  onClick={() => toggleSort("name")}
                  className="flex items-center gap-1 text-left hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  {t("workspace.col_name")}
                  {renderSortIcon("name")}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSort("size")}
                  className="flex items-center justify-end gap-1 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  {t("workspace.col_size")}
                  {renderSortIcon("size")}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSort("permissions")}
                  className="flex items-center gap-1 pl-2 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  {t("workspace.col_perms")}
                  {renderSortIcon("permissions")}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSort("modified")}
                  className="flex items-center justify-end gap-1 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  {t("workspace.col_modified")}
                  {renderSortIcon("modified")}
                </button>
              </div>

              {/* Virtualized File List */}
              <div
                ref={scrollRef}
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setSelectedPaths(new Set());
                    setAnchorIndex(null);
                  }
                }}
                onContextMenu={handleEmptyContextMenu}
                className="flex-1 min-h-0 overflow-y-auto relative"
              >
                {error && (
                  <div className="m-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="break-all">{error}</span>
                  </div>
                )}

                {loading ? (
                  <div className="h-full flex items-center justify-center text-xs text-zinc-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                ) : sortedEntries.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-zinc-400">
                    {t("workspace.empty_dir")}
                  </div>
                ) : (
                  <div
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((vRow) => {
                      const entry = sortedEntries[vRow.index];
                      const isSelected = selectedPaths.has(entry.path);

                      return (
                        <div
                          key={entry.path}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: `${vRow.size}px`,
                            transform: `translateY(${vRow.start}px)`,
                          }}
                          onClick={(e) => handleRowClick(e, vRow.index, entry)}
                          onDoubleClick={() => {
                            if (entry.is_dir) onNavigate(entry.path);
                          }}
                          onContextMenu={(e) => handleRowContextMenu(e, vRow.index, entry)}
                          className={`grid grid-cols-[1fr_76px_88px_116px] items-center px-3 text-xs cursor-default select-none border-b border-zinc-100/70 dark:border-zinc-900/70 ${
                            isSelected
                              ? "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-950 dark:text-indigo-50"
                              : "hover:bg-zinc-100/80 dark:hover:bg-zinc-900/70 text-zinc-800 dark:text-zinc-200"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <FileIcon entry={entry} />
                            <span className="truncate">{entry.name}</span>
                          </div>
                          <div className="text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                            {entry.is_dir ? "—" : formatBytes(entry.size)}
                          </div>
                          <div className="pl-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                            {entry.permissions ?? "—"}
                          </div>
                          <div className="text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                            {formatModified(entry.modified)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>

      {/* Panel Footer Status */}
      <div className="h-6 px-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 flex items-center justify-between text-[11px] text-zinc-500 shrink-0 select-none">
        <span>{t("workspace.items_count", { count: sortedEntries.length })}</span>
        {selectedEntries.length > 0 && (
          <span className="font-medium text-indigo-600 dark:text-indigo-400">
            {t("workspace.selected_count", { count: selectedEntries.length })}
            {selectedTotalBytes > 0 ? ` (${formatBytes(selectedTotalBytes)})` : ""}
          </span>
        )}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <FileContextMenu
          menu={contextMenu}
          selectedEntries={selectedEntries}
          isRemote={isRemote}
          currentPath={path}
          onClose={() => setContextMenu(null)}
          onOpenFolder={(entry) => onNavigate(entry.path)}
          onNewFolder={onNewFolder}
          onRename={onRename}
          onDelete={onDelete}
          onProperties={onProperties}
          onCopyPath={(p) => navigator.clipboard.writeText(p).catch(() => {})}
          onRefresh={onRefresh}
          onSelectAll={() =>
            setSelectedPaths(new Set(sortedEntries.map((item) => item.path)))
          }
        />
      )}
    </section>
  );
}
