import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
} from "lucide-react";
import { api } from "../services/tauri";
import type { FileEntry } from "../types";

interface DirectoryTreePaneProps {
  currentPath: string;
  currentEntries: FileEntry[];
  isRemote: boolean;
  disabled?: boolean;
  onNavigate: (path: string) => void;
  onFetchSubdirs: (path: string) => Promise<FileEntry[]>;
}

function normalizePath(p: string, isRemote: boolean): string {
  if (!p) return isRemote ? "/" : "";
  if (isRemote) {
    const cleaned = p.replace(/\/+$/, "");
    return cleaned || "/";
  }
  // Windows drive root e.g. C:\
  if (/^[a-zA-Z]:[\\/]?$/.test(p)) {
    return `${p[0].toUpperCase()}:\\`;
  }
  return p.replace(/[\\/]+$/, "");
}

function getAncestors(path: string, isRemote: boolean): string[] {
  const norm = normalizePath(path, isRemote);
  if (!norm) return [];

  if (!isRemote && /^[a-zA-Z]:/.test(norm)) {
    const parts = norm.split("\\").filter(Boolean);
    const result: string[] = [];
    parts.forEach((_, idx) => {
      if (idx === 0) result.push(`${parts[0]}\\`);
      else result.push(`${parts[0]}\\${parts.slice(1, idx + 1).join("\\")}`);
    });
    return result;
  }

  const parts = norm.split("/").filter(Boolean);
  const result = ["/"];
  parts.forEach((_, idx) => {
    result.push(`/${parts.slice(0, idx + 1).join("/")}`);
  });
  return result;
}

function displayName(path: string, isRemote: boolean): string {
  if (isRemote) {
    if (path === "/") return "/";
    return path.split("/").filter(Boolean).pop() ?? path;
  }
  if (/^[a-zA-Z]:\\?$/.test(path)) return path;
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function DirectoryTreePane({
  currentPath,
  currentEntries,
  isRemote,
  disabled = false,
  onNavigate,
  onFetchSubdirs,
}: DirectoryTreePaneProps) {
  const [roots, setRoots] = useState<string[]>(isRemote ? ["/"] : []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Record<string, FileEntry[]>>({});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());

  // Load roots once
  useEffect(() => {
    if (isRemote) {
      setRoots(["/"]);
      return;
    }
    api
      .localListRoots()
      .then((list) => setRoots(list.map((r) => normalizePath(r, false))))
      .catch(() => setRoots(["/"]));
  }, [isRemote]);

  // Sync current directory's subdirectories from already-loaded entries & expand ancestors
  useEffect(() => {
    if (!currentPath || disabled) return;
    const normCurrent = normalizePath(currentPath, isRemote);
    const subdirs = currentEntries
      .filter((e) => e.is_dir)
      .map((e) => ({ ...e, path: normalizePath(e.path, isRemote) }));

    setChildrenMap((prev) => ({
      ...prev,
      [normCurrent]: subdirs,
    }));

    const ancestors = getAncestors(normCurrent, isRemote);
    setExpanded((prev) => {
      const next = new Set(prev);
      ancestors.forEach((a) => next.add(a));
      return next;
    });

    // Ensure intermediate ancestor nodes know about their child along the path
    if (ancestors.length > 1) {
      setChildrenMap((prev) => {
        const next = { ...prev };
        for (let i = 0; i < ancestors.length - 1; i++) {
          const parent = ancestors[i];
          const child = ancestors[i + 1];
          const existing = next[parent];
          if (!existing) {
            next[parent] = [
              {
                name: displayName(child, isRemote),
                path: child,
                is_dir: true,
                is_symlink: false,
                size: 0,
                modified: null,
                permissions: null,
                mode: null,
                owner: null,
              },
            ];
          } else if (!existing.some((c) => c.path === child)) {
            next[parent] = [
              ...existing,
              {
                name: displayName(child, isRemote),
                path: child,
                is_dir: true,
                is_symlink: false,
                size: 0,
                modified: null,
                permissions: null,
                mode: null,
                owner: null,
              },
            ].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
          }
        }
        return next;
      });
    }
  }, [currentPath, currentEntries, isRemote, disabled]);

  const loadChildren = useCallback(
    async (targetPath: string) => {
      if (disabled) return;
      setLoadingPaths((prev) => new Set(prev).add(targetPath));
      try {
        const list = await onFetchSubdirs(targetPath);
        const dirs = list
          .filter((e) => e.is_dir)
          .map((e) => ({ ...e, path: normalizePath(e.path, isRemote) }))
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        setChildrenMap((prev) => ({ ...prev, [targetPath]: dirs }));
      } catch {
        // ignore inaccessible folders in tree
      } finally {
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(targetPath);
          return next;
        });
      }
    },
    [disabled, isRemote, onFetchSubdirs]
  );

  const toggleExpand = async (e: React.MouseEvent, nodePath: string) => {
    e.stopPropagation();
    const isOpen = expanded.has(nodePath);
    if (isOpen) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(nodePath);
        return next;
      });
    } else {
      setExpanded((prev) => new Set(prev).add(nodePath));
      await loadChildren(nodePath);
    }
  };

  const normCurrent = normalizePath(currentPath, isRemote);

  const renderNode = (nodePath: string, label: string, depth: number, isRoot = false) => {
    const isOpen = expanded.has(nodePath);
    const isSelected = normCurrent === nodePath;
    const isLoading = loadingPaths.has(nodePath);
    const children = childrenMap[nodePath];
    const knownEmpty = children !== undefined && children.length === 0;

    return (
      <div key={nodePath}>
        <div
          onClick={() => {
            if (!disabled) onNavigate(nodePath);
          }}
          style={{ paddingLeft: `${depth * 16 + 6}px` }}
          className={`flex items-center gap-1.5 pr-2 py-0.5 text-xs cursor-default select-none transition-colors ${
            isSelected
              ? "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-950 dark:text-indigo-50 font-medium"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
          }`}
        >
          <span
            onClick={(e) => {
              if (!knownEmpty && !disabled) toggleExpand(e, nodePath);
            }}
            className="w-4 h-4 flex items-center justify-center shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : !knownEmpty ? (
              isOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )
            ) : null}
          </span>

          {isRoot && !isRemote ? (
            <HardDrive className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          ) : isOpen ? (
            <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          )}

          <span className="truncate">{label}</span>
        </div>

        {isOpen &&
          children &&
          children.map((child) => renderNode(child.path, child.name, depth + 1, false))}
      </div>
    );
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-zinc-50/40 dark:bg-zinc-950/60 py-1">
      {roots.map((root) => renderNode(root, displayName(root, isRemote), 0, true))}
    </div>
  );
}
