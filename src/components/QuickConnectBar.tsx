import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Clock, Play, Trash2, X, Zap } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import type { Protocol, Session } from "../types";

export interface QuickConnectHistoryItem {
  id: string;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  lastUsedAt: string;
}

const HISTORY_STORAGE_KEY = "cd-remote-quick-connect-history";
const MAX_HISTORY_ITEMS = 15;

function defaultPortForProtocol(protocol: Protocol): number {
  switch (protocol) {
    case "ftp":
    case "ftps_explicit":
      return 21;
    case "ftps_implicit":
      return 990;
    case "sftp":
    case "ssh":
    default:
      return 22;
  }
}

function protocolLabel(protocol: Protocol): string {
  switch (protocol) {
    case "sftp":
      return "SFTP";
    case "ftp":
      return "FTP";
    case "ftps_explicit":
      return "FTPS";
    case "ftps_implicit":
      return "FTPS (Imp)";
    case "ssh":
      return "SSH";
  }
}

function loadHistory(): QuickConnectHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QuickConnectHistoryItem =>
        item &&
        typeof item.id === "string" &&
        typeof item.protocol === "string" &&
        typeof item.host === "string" &&
        typeof item.port === "number" &&
        typeof item.username === "string"
    );
  } catch {
    return [];
  }
}

function saveHistory(items: QuickConnectHistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

export interface QuickConnectPreset {
  protocol: Protocol;
  nonce: number;
}

interface QuickConnectBarProps {
  preset?: QuickConnectPreset | null;
}

export function QuickConnectBar({ preset }: QuickConnectBarProps) {
  const { t } = useTranslation();
  const { openSessionTab } = useAppStore();

  const [protocol, setProtocol] = useState<Protocol>("sftp");
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [port, setPort] = useState("22");
  const [history, setHistory] = useState<QuickConnectHistoryItem[]>(() => loadHistory());
  const [historyOpen, setHistoryOpen] = useState(false);

  const hostInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!preset) return;
    setProtocol(preset.protocol);
    setPort(String(defaultPortForProtocol(preset.protocol)));
    requestAnimationFrame(() => {
      hostInputRef.current?.focus();
      hostInputRef.current?.select();
    });
  }, [preset]);

  useEffect(() => {
    if (!historyOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [historyOpen]);

  const handleProtocolChange = (nextProtocol: Protocol) => {
    const prevDefault = String(defaultPortForProtocol(protocol));
    setProtocol(nextProtocol);
    if (!port.trim() || port.trim() === prevDefault) {
      setPort(String(defaultPortForProtocol(nextProtocol)));
    }
  };

  const launchConnection = (params: {
    protocol: Protocol;
    host: string;
    port: number;
    username: string;
    password?: string;
  }) => {
    const cleanHost = params.host.trim();
    if (!cleanHost) {
      hostInputRef.current?.focus();
      return;
    }

    const cleanUser = params.username.trim();
    const resolvedPort =
      Number.isFinite(params.port) && params.port >= 1 && params.port <= 65535
        ? Math.floor(params.port)
        : defaultPortForProtocol(params.protocol);

    const tempSession: Session = {
      id: `quick-${crypto.randomUUID()}`,
      folder_id: null,
      credential_id: null,
      name: cleanUser ? `${cleanUser}@${cleanHost}` : cleanHost,
      protocol: params.protocol,
      host: cleanHost,
      port: resolvedPort,
      remote_initial_path: "/",
      local_initial_path: "",
      passive_mode: true,
      accept_invalid_certs: false,
      sort_order: 0,
      icon_color: null,
    };

    openSessionTab(
      tempSession,
      cleanUser ? { username: cleanUser, password: params.password || undefined } : undefined
    );

    const keyMatch = (item: QuickConnectHistoryItem) =>
      item.protocol === params.protocol &&
      item.host.toLowerCase() === cleanHost.toLowerCase() &&
      item.port === resolvedPort &&
      item.username === cleanUser;

    const nextEntry: QuickConnectHistoryItem = {
      id: crypto.randomUUID(),
      protocol: params.protocol,
      host: cleanHost,
      port: resolvedPort,
      username: cleanUser,
      lastUsedAt: new Date().toISOString(),
    };

    const nextHistory = [nextEntry, ...history.filter((item) => !keyMatch(item))].slice(
      0,
      MAX_HISTORY_ITEMS
    );
    setHistory(nextHistory);
    saveHistory(nextHistory);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPort = port.trim() ? Number(port.trim()) : defaultPortForProtocol(protocol);
    launchConnection({
      protocol,
      host,
      port: parsedPort,
      username,
      password,
    });
  };

  const handleFillFromHistory = (item: QuickConnectHistoryItem) => {
    setProtocol(item.protocol);
    setHost(item.host);
    setUsername(item.username);
    setPort(String(item.port));
    setPassword("");
    setHistoryOpen(false);
    requestAnimationFrame(() => {
      if (item.username) {
        passwordInputRef.current?.focus();
      } else {
        hostInputRef.current?.focus();
      }
    });
  };

  const handleDirectConnectFromHistory = (
    e: React.MouseEvent,
    item: QuickConnectHistoryItem
  ) => {
    e.stopPropagation();
    setProtocol(item.protocol);
    setHost(item.host);
    setUsername(item.username);
    setPort(String(item.port));
    setPassword("");
    setHistoryOpen(false);
    launchConnection({
      protocol: item.protocol,
      host: item.host,
      port: item.port,
      username: item.username,
    });
  };

  const handleRemoveHistoryItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const next = history.filter((item) => item.id !== id);
    setHistory(next);
    saveHistory(next);
  };

  const handleClearHistory = () => {
    setHistory([]);
    saveHistory([]);
    setHistoryOpen(false);
  };

  return (
    <div className="shrink-0 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/90">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs"
      >
        <div className="flex items-center gap-1.5">
          <label
            htmlFor="qc-protocol"
            className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 shrink-0"
          >
            {t("quick_bar.protocol")}
          </label>
          <select
            id="qc-protocol"
            value={protocol}
            onChange={(e) => handleProtocolChange(e.target.value as Protocol)}
            className="h-7 px-2 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="sftp">SFTP</option>
            <option value="ftp">FTP</option>
            <option value="ftps_explicit">FTPS (Explicit)</option>
            <option value="ftps_implicit">FTPS (Implicit)</option>
            <option value="ssh">SSH</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
          <label
            htmlFor="qc-host"
            className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 shrink-0"
          >
            {t("quick_bar.host")}
          </label>
          <input
            ref={hostInputRef}
            id="qc-host"
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="host / IP"
            className="h-7 flex-1 min-w-0 px-2 text-xs font-mono rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-[130px] max-w-[220px]">
          <label
            htmlFor="qc-user"
            className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 shrink-0"
          >
            {t("quick_bar.username")}
          </label>
          <input
            id="qc-user"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("quick_bar.username_placeholder")}
            className="h-7 flex-1 min-w-0 px-2 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-[120px] max-w-[200px]">
          <label
            htmlFor="qc-pass"
            className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 shrink-0"
          >
            {t("quick_bar.password")}
          </label>
          <input
            ref={passwordInputRef}
            id="qc-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-7 flex-1 min-w-0 px-2 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <label
            htmlFor="qc-port"
            className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400 shrink-0"
          >
            {t("quick_bar.port")}
          </label>
          <input
            id="qc-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={String(defaultPortForProtocol(protocol))}
            className="h-7 w-16 px-2 text-xs font-mono rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Split Connect + History Button */}
        <div ref={dropdownRef} className="relative flex items-center shrink-0">
          <button
            type="submit"
            disabled={!host.trim()}
            className="h-7 inline-flex items-center gap-1.5 px-2.5 text-xs font-medium rounded-l-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            {t("toolbar.quick_connect")}
          </button>
          <button
            type="button"
            title={t("quick_bar.history_title")}
            onClick={() => setHistoryOpen((prev) => !prev)}
            className="h-7 px-1.5 rounded-r-md border-l border-indigo-500/60 bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer flex items-center justify-center"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {historyOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-80 max-w-[90vw] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl z-40 overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  <Clock className="w-3 h-3" />
                  {t("quick_bar.history_title")}
                </span>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    {t("quick_bar.clear_history")}
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="px-3 py-5 text-center text-xs text-zinc-400 dark:text-zinc-500">
                  {t("quick_bar.history_empty")}
                </div>
              ) : (
                <ul className="max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                  {history.map((item) => (
                    <li
                      key={item.id}
                      onClick={() => handleFillFromHistory(item)}
                      title={t("quick_bar.fill_hint")}
                      className="group px-3 py-2 flex items-center justify-between gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/70 cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase shrink-0 ${
                              item.protocol === "ssh"
                                ? "bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300"
                                : "bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300"
                            }`}
                          >
                            {protocolLabel(item.protocol)}
                          </span>
                          <span className="font-mono text-xs text-zinc-800 dark:text-zinc-100 truncate">
                            {item.username ? `${item.username}@` : ""}
                            {item.host}:{item.port}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          title={t("sidebar.connect")}
                          onClick={(e) => handleDirectConnectFromHistory(e, item)}
                          className="p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 cursor-pointer"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          title={t("app.delete")}
                          onClick={(e) => handleRemoveHistoryItem(e, item.id)}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
