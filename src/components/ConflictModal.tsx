import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import type { ConflictAction, ConflictPromptEvent } from "../types";

interface ConflictModalProps {
  conflict: ConflictPromptEvent;
  onResolve: (action: ConflictAction, applyToAll: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatEpoch(secs: number | null): string {
  if (!secs) return "—";
  return new Date(secs * 1000).toLocaleString();
}

export function ConflictModal({ conflict, onResolve }: ConflictModalProps) {
  const { t } = useTranslation();
  const [action, setAction] = useState<ConflictAction>("overwrite");
  const [applyToAll, setApplyToAll] = useState(false);

  const options: { value: ConflictAction; label: string }[] = [
    { value: "overwrite", label: t("conflict.overwrite") },
    {
      value: "overwrite_if_newer_or_diff_size",
      label: t("conflict.overwrite_if_newer"),
    },
    { value: "skip", label: t("conflict.skip") },
    { value: "auto_rename", label: t("conflict.auto_rename") },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {t("conflict.title")}
          </h2>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {t("conflict.subtitle", { name: conflict.file_name })}
          </p>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="font-semibold text-zinc-500 uppercase text-[10px]">
                {t("conflict.source")}
              </div>
              <div className="font-mono text-zinc-900 dark:text-zinc-100">
                {formatBytes(conflict.source_size)}
              </div>
              <div className="text-[11px] text-zinc-500">
                {formatEpoch(conflict.source_modified)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="font-semibold text-zinc-500 uppercase text-[10px]">
                {t("conflict.destination")}
              </div>
              <div className="font-mono text-zinc-900 dark:text-zinc-100">
                {formatBytes(conflict.dest_size)}
              </div>
              <div className="text-[11px] text-zinc-500">
                {formatEpoch(conflict.dest_modified)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {options.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                  action === opt.value
                    ? "border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-zinc-900 dark:text-zinc-100 font-medium"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <input
                  type="radio"
                  name="conflict-action"
                  checked={action === opt.value}
                  onChange={() => setAction(opt.value)}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            />
            {t("conflict.apply_all")}
          </label>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => onResolve(action, applyToAll)}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
            >
              {t("app.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
