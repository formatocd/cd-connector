import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Pencil } from "lucide-react";
import { parseBreadcrumbs } from "../utils/paths";

interface BreadcrumbBarProps {
  path: string;
  isLocal: boolean;
  disabled?: boolean;
  onNavigate: (targetPath: string) => void;
}

export function BreadcrumbBar({
  path,
  isLocal,
  disabled = false,
  onNavigate,
}: BreadcrumbBarProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);

  useEffect(() => {
    setDraft(path);
  }, [path]);

  const crumbs = parseBreadcrumbs(path, isLocal);

  if (editing && !disabled) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setEditing(false);
          if (draft.trim()) onNavigate(draft.trim());
        }}
        className="flex-1 min-w-0"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(path);
              setEditing(false);
            }
          }}
          autoFocus
          className="w-full px-2 py-1 text-xs font-mono rounded border border-indigo-500 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </form>
    );
  }

  return (
    <div
      onClick={() => {
        if (!disabled) setEditing(true);
      }}
      className={`flex-1 min-w-0 h-7 px-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex items-center gap-0.5 overflow-x-auto ${
        disabled ? "opacity-50" : "cursor-text"
      }`}
    >
      <div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto">
        {crumbs.map((crumb, idx) => (
          <div key={crumb.path} className="flex items-center shrink-0">
            {idx > 0 && (
              <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0 mx-0.5" />
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(crumb.path);
              }}
              className="px-1.5 py-0.5 text-xs font-mono rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer"
            >
              {crumb.label}
            </button>
          </div>
        ))}
      </div>
      {!disabled && (
        <button
          type="button"
          title={t("workspace.edit_path_tooltip")}
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 shrink-0 cursor-pointer"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
