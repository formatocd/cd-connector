import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Disc3, Zap, Search, FolderTree, Terminal, Clock, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { resolveIconColor } from "./IconColorPicker";
import type { Session } from "../types";

interface HomePageProps {
  onQuickConnect: () => void;
}

export function HomePage({ onQuickConnect }: HomePageProps) {
  const { t } = useTranslation();
  const { sessions, openSessionTab } = useAppStore();
  const [query, setQuery] = useState("");

  const trimmedQuery = query.trim().toLowerCase();

  const matchingSessions = useMemo(() => {
    if (!trimmedQuery) return [];
    return sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(trimmedQuery) ||
        s.host.toLowerCase().includes(trimmedQuery)
    );
  }, [sessions, trimmedQuery]);

  const recentSessions = useMemo(() => {
    return sessions
      .filter((s) => !!s.last_opened_at)
      .sort((a, b) =>
        (b.last_opened_at ?? "").localeCompare(a.last_opened_at ?? "")
      )
      .slice(0, 9);
  }, [sessions]);

  const displayList: Session[] = trimmedQuery ? matchingSessions : recentSessions;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl flex flex-col items-center space-y-6">
        {/* 1. App Icon & Title */}
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg mb-3">
            <Disc3 className="w-9 h-9" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {t("app.name")}
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {t("app.subtitle")}
          </p>
        </div>

        {/* 2. Quick Connect Button */}
        <button
          type="button"
          onClick={onQuickConnect}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors cursor-pointer"
        >
          <Zap className="w-4 h-4" />
          {t("toolbar.quick_connect")}
        </button>

        {/* 3. Search Box (by session name or host, excluding folders) */}
        <div className="w-full max-w-lg relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("home.search_placeholder")}
            className="w-full pl-10 pr-9 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 4. Recent / Matching Sessions Grid (3 equal-width buttons per row) */}
        <div className="w-full space-y-3 pt-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {!trimmedQuery && <Clock className="w-3.5 h-3.5" />}
            <span>
              {trimmedQuery ? t("home.results_title") : t("home.recent_title")}
            </span>
          </div>

          {displayList.length === 0 ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center py-6 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
              {trimmedQuery ? t("home.no_results") : t("home.no_recent")}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {displayList.map((session) => {
                const isSsh = session.protocol === "ssh";
                const color = resolveIconColor(
                  session.icon_color,
                  isSsh ? "#a855f7" : "#38bdf8"
                );
                return (
                  <button
                    key={session.id}
                    type="button"
                    title={`${session.name} (${session.protocol}://${session.host}:${session.port})`}
                    onClick={() => openSessionTab(session)}
                    className="w-full min-w-0 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/70 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 hover:border-indigo-400 dark:hover:border-indigo-700 text-left transition-colors cursor-pointer"
                  >
                    {isSsh ? (
                      <Terminal
                        className="w-4 h-4 shrink-0"
                        style={{ color }}
                      />
                    ) : (
                      <FolderTree
                        className="w-4 h-4 shrink-0"
                        style={{ color }}
                      />
                    )}
                    <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {session.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
