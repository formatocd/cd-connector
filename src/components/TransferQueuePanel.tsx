import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpFromLine,
  ArrowDownToLine,
  Pause,
  Play,
  RotateCcw,
  X,
  Trash2,
  Square,
} from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import { formatBytes } from "../utils/format";
import type { TransferStatus } from "../types";

type QueueFilter = "all" | "active" | "completed" | "failed";

function formatSpeed(bps: number): string {
  if (bps <= 0) return "—";
  return `${formatBytes(bps)}/s`;
}

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

const STATUS_BADGE: Record<TransferStatus, string> = {
  queued: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  waiting_conflict: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function TransferQueuePanel() {
  const { t } = useTranslation();
  const transfers = useAppStore((s) => s.transfers);
  const [filter, setFilter] = useState<QueueFilter>("all");

  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let failed = 0;
    let totalSpeed = 0;
    for (const item of transfers) {
      if (
        item.status === "queued" ||
        item.status === "in_progress" ||
        item.status === "paused" ||
        item.status === "waiting_conflict"
      ) {
        active++;
        if (item.status === "in_progress") totalSpeed += item.speed_bps;
      } else if (item.status === "completed") {
        completed++;
      } else {
        failed++;
      }
    }
    return { active, completed, failed, totalSpeed };
  }, [transfers]);

  const filtered = useMemo(() => {
    return transfers.filter((item) => {
      if (filter === "all") return true;
      if (filter === "active") {
        return (
          item.status === "queued" ||
          item.status === "in_progress" ||
          item.status === "paused" ||
          item.status === "waiting_conflict"
        );
      }
      if (filter === "completed") return item.status === "completed";
      return item.status === "failed" || item.status === "cancelled";
    });
  }, [transfers, filter]);

  return (
    <section className="h-full w-full bg-white dark:bg-zinc-950 flex flex-col">
      {/* Header & Controls */}
      <div className="px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {t("workspace.panel_queue")}
          </span>

          <div className="inline-flex rounded-md bg-zinc-200/70 dark:bg-zinc-800 p-0.5 text-[11px]">
            {(
              [
                ["all", transfers.length],
                ["active", counts.active],
                ["completed", counts.completed],
                ["failed", counts.failed],
              ] as [QueueFilter, number][]
            ).map(([key, cnt]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-2 py-0.5 rounded font-medium cursor-pointer transition-colors ${
                  filter === key
                    ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                {t(`queue.filter_${key}`)} ({cnt})
              </button>
            ))}
          </div>

          {counts.totalSpeed > 0 && (
            <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
              {formatSpeed(counts.totalSpeed)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title={t("queue.pause_all")}
            onClick={() => api.pauseAllTransfers()}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t("queue.resume_all")}
            onClick={() => api.resumeAllTransfers()}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t("queue.cancel_all")}
            onClick={() => api.cancelAllTransfers()}
            className="p-1 rounded hover:bg-red-500/15 text-red-600 dark:text-red-400 cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={t("queue.clear_done")}
            onClick={() => api.clearCompletedTransfers()}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Queue List */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-zinc-400 px-4 text-center">
            {t("queue.empty")}
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500">
              <tr>
                <th className="text-left font-medium px-3 py-1">{t("queue.col_file")}</th>
                <th className="text-left font-medium px-2 py-1 w-44">{t("queue.col_progress")}</th>
                <th className="text-right font-medium px-2 py-1 w-24">{t("queue.col_speed")}</th>
                <th className="text-right font-medium px-2 py-1 w-20">{t("queue.col_eta")}</th>
                <th className="text-left font-medium px-2 py-1 w-28">{t("queue.col_status")}</th>
                <th className="w-20 px-2 py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {filtered.map((item) => {
                const pct =
                  item.total_bytes > 0
                    ? Math.min(100, Math.round((item.transferred_bytes / item.total_bytes) * 100))
                    : item.status === "completed"
                    ? 100
                    : 0;

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                    title={item.error ?? `${item.local_path} ↔ ${item.remote_path}`}
                  >
                    <td className="px-3 py-1 flex items-center gap-2 min-w-0">
                      {item.direction === "upload" ? (
                        <ArrowUpFromLine className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                      ) : (
                        <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      )}
                      <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                        {item.file_name}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                          <div
                            style={{ width: `${pct}%` }}
                            className={`h-full transition-all ${
                              item.status === "completed"
                                ? "bg-emerald-500"
                                : item.status === "failed"
                                ? "bg-red-500"
                                : item.status === "paused"
                                ? "bg-amber-500"
                                : "bg-indigo-500"
                            }`}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-zinc-500 w-9 text-right">
                          {pct}%
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-zinc-400">
                        {formatBytes(item.transferred_bytes)} / {formatBytes(item.total_bytes)}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[11px] text-zinc-500">
                      {item.status === "in_progress" ? formatSpeed(item.speed_bps) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[11px] text-zinc-500">
                      {item.status === "in_progress" ? formatEta(item.eta_seconds) : "—"}
                    </td>
                    <td className="px-2 py-1">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          STATUS_BADGE[item.status]
                        }`}
                      >
                        {t(`queue.status_${item.status}`)}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <div className="inline-flex items-center gap-0.5">
                        {(item.status === "in_progress" || item.status === "queued") && (
                          <button
                            type="button"
                            title={t("queue.pause")}
                            onClick={() => api.pauseTransfer(item.id)}
                            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                          >
                            <Pause className="w-3 h-3" />
                          </button>
                        )}
                        {item.status === "paused" && (
                          <button
                            type="button"
                            title={t("queue.resume")}
                            onClick={() => api.resumeTransfer(item.id)}
                            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-indigo-600 dark:text-indigo-400 cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                        {(item.status === "failed" || item.status === "cancelled") && (
                          <button
                            type="button"
                            title={t("queue.retry")}
                            onClick={() => api.retryTransfer(item.id)}
                            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-indigo-600 dark:text-indigo-400 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                        {(item.status === "in_progress" ||
                          item.status === "queued" ||
                          item.status === "paused" ||
                          item.status === "waiting_conflict") && (
                          <button
                            type="button"
                            title={t("queue.cancel")}
                            onClick={() => api.cancelTransfer(item.id)}
                            className="p-1 rounded hover:bg-red-500/15 text-red-600 dark:text-red-400 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
