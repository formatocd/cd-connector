import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Send, Info } from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import type { LogLevel, Protocol, SessionLogEvent } from "../types";

const EMPTY_LOGS: SessionLogEvent[] = [];

interface ConsolePanelProps {
  tabId: string;
  protocol: Protocol;
  connected: boolean;
}

const LEVEL_STYLES: Record<LogLevel, string> = {
  command: "text-sky-600 dark:text-sky-400",
  response: "text-emerald-600 dark:text-emerald-400",
  info: "text-zinc-500 dark:text-zinc-400",
  error: "text-red-600 dark:text-red-400",
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  command: "→",
  response: "←",
  info: "•",
  error: "✖",
};

export function ConsolePanel({ tabId, protocol, connected }: ConsolePanelProps) {
  const { t } = useTranslation();
  const logs = useAppStore((s) => s.sessionLogs[tabId] ?? EMPTY_LOGS);
  const clearSessionLogs = useAppStore((s) => s.clearSessionLogs);

  const [cmdInput, setCmdInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isFtpLike =
    protocol === "ftp" ||
    protocol === "ftps_explicit" ||
    protocol === "ftps_implicit";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cmdInput.trim();
    if (!trimmed || !connected || !isFtpLike) return;

    setSending(true);
    setCmdInput("");
    setHistory((prev) => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIdx(-1);
    try {
      await api.sendRawCommand(tabId, trimmed);
    } catch {
      // Backend already emits error log event
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" && history.length > 0) {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(next);
      setCmdInput(history[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setCmdInput("");
      } else {
        const next = historyIdx - 1;
        setHistoryIdx(next);
        setCmdInput(history[next]);
      }
    }
  };

  return (
    <section className="h-44 shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 flex flex-col">
      <div className="px-3 py-1.5 border-b border-zinc-200/70 dark:border-zinc-800/70 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {t("workspace.panel_console")}
        </span>
        <button
          type="button"
          onClick={() => clearSessionLogs(tabId)}
          title={t("workspace.console_clear")}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 cursor-pointer"
        >
          <Trash2 className="w-3 h-3" />
          {t("workspace.console_clear")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[11px] space-y-0.5 select-text">
        {logs.length === 0 ? (
          <div className="text-zinc-400 italic">{t("workspace.console_empty")}</div>
        ) : (
          logs.map((entry, idx) => (
            <div key={idx} className="flex gap-2 leading-relaxed">
              <span className="text-zinc-400 shrink-0">{entry.timestamp}</span>
              <span className={`shrink-0 font-bold ${LEVEL_STYLES[entry.level]}`}>
                {LEVEL_PREFIX[entry.level]}
              </span>
              <span className={`break-all ${LEVEL_STYLES[entry.level]}`}>
                {entry.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Raw FTP Command Prompt (RF-15) */}
      <div className="px-3 py-1.5 border-t border-zinc-200/70 dark:border-zinc-800/70 bg-white dark:bg-zinc-950">
        {isFtpLike ? (
          <form onSubmit={handleSend} className="flex items-center gap-2">
            <span className="font-mono text-xs text-indigo-500 font-bold">&gt;</span>
            <input
              type="text"
              value={cmdInput}
              onChange={(e) => setCmdInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!connected || sending}
              placeholder={t("workspace.console_ftp_placeholder")}
              className="flex-1 bg-transparent font-mono text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!connected || sending || !cmdInput.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white cursor-pointer"
            >
              <Send className="w-3 h-3" />
              {t("workspace.console_send")}
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Info className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span>{t("workspace.console_sftp_notice")}</span>
          </div>
        )}
      </div>
    </section>
  );
}
