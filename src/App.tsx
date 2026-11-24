import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import {
  PanelLeft,
  Columns2,
  Rows2,
  ListChecks,
  KeyRound,
  ArrowLeftRight,
  Settings,
  Lock,
  Copy,
  X,
  FolderTree,
  HelpCircle,
  Square,
} from "lucide-react";
import { api } from "./services/tauri";
import { useAppStore } from "./store/useAppStore";
import { SetupWizard } from "./components/SetupWizard";
import { UnlockModal } from "./components/UnlockModal";
import { Sidebar } from "./components/Sidebar";
import { CredentialsModal } from "./components/CredentialsModal";
import { SessionModal } from "./components/SessionModal";
import { ImportExportModal } from "./components/ImportExportModal";
import { SettingsModal } from "./components/SettingsModal";
import { SessionWorkspace } from "./components/SessionWorkspace";
import { SshTerminalWorkspace } from "./components/SshTerminalWorkspace";
import { ConflictModal } from "./components/ConflictModal";
import { HomePage } from "./components/HomePage";
import { AboutModal } from "./components/AboutModal";
import { resolveIconColor } from "./components/IconColorPicker";
import { TerminalSolidIcon } from "./components/TerminalSolidIcon";
import type {
  ConflictPromptEvent,
  Session,
  SessionKind,
  SessionLogEvent,
  TransferItem,
} from "./types";

export function App() {
  const { t } = useTranslation();
  const {
    loading,
    security,
    config,
    tabs,
    activeTabId,
    secondaryTabId,
    splitDirection,
    focusedPane,
    initialize,
    setSecurity,
    updateConfig,
    setActiveTab,
    closeTab,
    duplicateTab,
    reorderTabs,
    setSplitDirection,
    setFocusedPane,
    appendSessionLog,
    conflictQueue,
    setTransfers,
    pushConflict,
    removeConflict,
  } = useAppStore();

  const [showCredentials, setShowCredentials] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [sessionModal, setSessionModal] = useState<{
    mode: "create" | "edit" | "duplicate" | "quick";
    sessionKind: SessionKind;
    folderId?: string | null;
    session?: Session | null;
  } | null>(null);

  // Tab drag-to-reorder state (pointer-event based for WebView2 compatibility)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [tabDragGhost, setTabDragGhost] = useState<{ label: string; x: number; y: number } | null>(
    null
  );
  const [tabDropTarget, setTabDropTarget] = useState<{
    tabId: string;
    position: "before" | "after";
  } | null>(null);
  const suppressTabClickRef = useRef(false);

  const startTabPointerDrag = (e: React.PointerEvent, tabId: string, label: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest("button")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let latestTarget: { tabId: string; position: "before" | "after" } | null = null;

    const onMove = (moveEv: PointerEvent) => {
      if (!active) {
        if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) < 5) {
          return;
        }
        active = true;
        setDraggingTabId(tabId);
      }
      setTabDragGhost({ label, x: moveEv.clientX, y: moveEv.clientY });
      const el = document.elementFromPoint(moveEv.clientX, moveEv.clientY) as HTMLElement | null;
      const tabEl = el?.closest("[data-tab-id]") as HTMLElement | null;
      const targetId = tabEl?.dataset.tabId;
      if (tabEl && targetId && targetId !== tabId) {
        const rect = tabEl.getBoundingClientRect();
        const pos: "before" | "after" =
          moveEv.clientX - rect.left < rect.width / 2 ? "before" : "after";
        latestTarget = { tabId: targetId, position: pos };
      } else {
        latestTarget = null;
      }
      setTabDropTarget(latestTarget);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (active) {
        suppressTabClickRef.current = true;
        window.setTimeout(() => {
          suppressTabClickRef.current = false;
        }, 50);
        if (latestTarget && latestTarget.tabId !== tabId) {
          reorderTabs(tabId, latestTarget.tabId, latestTarget.position);
        }
        setDraggingTabId(null);
        setTabDragGhost(null);
        setTabDropTarget(null);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // Split view ratio state (percentage for Pane 1, 20..80)
  const [splitRatio, setSplitRatio] = useState(50);
  const workspaceContainerRef = useRef<HTMLDivElement>(null);

  const handleStartSplitResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const container = workspaceContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (moveEvent: PointerEvent) => {
      const ratio =
        splitDirection === "vertical"
          ? ((moveEvent.clientY - rect.top) / rect.height) * 100
          : ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(Math.min(80, Math.max(20, ratio)));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Subscribe to real-time backend session logs & transfer queue events
  useEffect(() => {
    const unlistenLog = listen<SessionLogEvent>("session-log", (event) => {
      appendSessionLog(event.payload);
    });
    const unlistenQueue = listen<TransferItem[]>("transfer-queue-updated", (event) => {
      setTransfers(event.payload);
    });
    const unlistenConflict = listen<ConflictPromptEvent>("transfer-conflict", (event) => {
      pushConflict(event.payload);
    });
    return () => {
      unlistenLog.then((fn) => fn());
      unlistenQueue.then((fn) => fn());
      unlistenConflict.then((fn) => fn());
    };
  }, [appendSessionLog, setTransfers, pushConflict]);

  // Global panel visibility shortcuts (RF-11)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        updateConfig({ ui_show_sidebar: !config.ui_show_sidebar });
      } else if (key === "1") {
        e.preventDefault();
        updateConfig({ ui_show_local_panel: !config.ui_show_local_panel });
      } else if (key === "2") {
        e.preventDefault();
        updateConfig({ ui_show_command_panel: !config.ui_show_command_panel });
      } else if (key === "3") {
        e.preventDefault();
        updateConfig({ ui_show_queue_panel: !config.ui_show_queue_panel });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    config.ui_show_sidebar,
    config.ui_show_local_panel,
    config.ui_show_command_panel,
    config.ui_show_queue_panel,
    updateConfig,
  ]);

  // Apply Light / Dark / System theme
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const isDark =
        config.theme === "dark" || (config.theme === "system" && media.matches);
      root.classList.toggle("dark", isDark);
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [config.theme]);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-500">
        {t("app.loading")}
      </div>
    );
  }

  if (!security.initialized) {
    return <SetupWizard />;
  }

  if (!security.unlocked) {
    return <UnlockModal />;
  }

  const handleLock = async () => {
    const status = await api.lockVault();
    setSecurity(status);
  };

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Top Toolbar */}
      <header className="h-11 shrink-0 px-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            title={t("toolbar.toggle_sidebar")}
            onClick={() => updateConfig({ ui_show_sidebar: !config.ui_show_sidebar })}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              config.ui_show_sidebar
                ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
                : "hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
            }`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setSessionModal({ mode: "quick", sessionKind: "ssh" })}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors cursor-pointer"
          >
            <TerminalSolidIcon className="w-3.5 h-3.5" />
            {t("toolbar.quick_ssh")}
          </button>

          <button
            type="button"
            onClick={() => setSessionModal({ mode: "quick", sessionKind: "transfer" })}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer"
          >
            <FolderTree className="w-3.5 h-3.5" />
            {t("toolbar.quick_transfer")}
          </button>
        </div>

        {/* Panel Visibility Toggles (RF-11) */}
        <div className="flex items-center gap-1 bg-zinc-200/70 dark:bg-zinc-800/70 p-0.5 rounded-lg">
          <button
            type="button"
            title={t("toolbar.toggle_local")}
            onClick={() =>
              updateConfig({ ui_show_local_panel: !config.ui_show_local_panel })
            }
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
              config.ui_show_local_panel
                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t("toolbar.toggle_local")}</span>
          </button>
          <button
            type="button"
            title={t("toolbar.toggle_console")}
            onClick={() =>
              updateConfig({ ui_show_command_panel: !config.ui_show_command_panel })
            }
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
              config.ui_show_command_panel
                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            <TerminalSolidIcon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t("toolbar.toggle_console")}</span>
          </button>
          <button
            type="button"
            title={t("toolbar.toggle_queue")}
            onClick={() =>
              updateConfig({ ui_show_queue_panel: !config.ui_show_queue_panel })
            }
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
              config.ui_show_queue_panel
                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            <ListChecks className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t("toolbar.toggle_queue")}</span>
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={t("toolbar.credentials")}
            onClick={() => setShowCredentials(true)}
            className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
          >
            <KeyRound className="w-4 h-4" />
          </button>
          <button
            type="button"
            title={t("toolbar.import_export")}
            onClick={() => setShowImportExport(true)}
            className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            title={t("toolbar.settings")}
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>
          {security.mode === "master_password" && (
            <button
              type="button"
              title={t("toolbar.lock_vault")}
              onClick={handleLock}
              className="p-1.5 rounded-lg hover:bg-amber-500/15 text-amber-600 dark:text-amber-400 cursor-pointer"
            >
              <Lock className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            title={t("toolbar.help")}
            onClick={() => setShowAbout(true)}
            className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex">
        {config.ui_show_sidebar && (
          <Sidebar
            onNewSession={(folderId, sessionKind) =>
              setSessionModal({ mode: "create", sessionKind, folderId })
            }
            onEditSession={(session) =>
              setSessionModal({
                mode: "edit",
                sessionKind: session.protocol === "ssh" ? "ssh" : "transfer",
                session,
              })
            }
            onDuplicateSession={(session) =>
              setSessionModal({
                mode: "duplicate",
                sessionKind: session.protocol === "ssh" ? "ssh" : "transfer",
                session,
              })
            }
          />
        )}

        <main className="flex-1 min-w-0 flex flex-col">
          {/* Tabs Bar */}
          {tabs.length > 0 && (
            <div className="h-9 shrink-0 px-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1">
                {tabs.map((tab) => {
                  const isPane1 = tab.tabId === activeTabId;
                  const isPane2 =
                    splitDirection !== "none" && tab.tabId === secondaryTabId;
                  const isVisible = isPane1 || isPane2;
                  const isBefore =
                    tabDropTarget?.tabId === tab.tabId &&
                    tabDropTarget.position === "before";
                  const isAfter =
                    tabDropTarget?.tabId === tab.tabId &&
                    tabDropTarget.position === "after";

                  return (
                    <div
                      key={tab.tabId}
                      data-tab-id={tab.tabId}
                      onPointerDown={(e) =>
                        startTabPointerDrag(e, tab.tabId, tab.session.name)
                      }
                      onClick={() => {
                        if (suppressTabClickRef.current) return;
                        setActiveTab(tab.tabId);
                      }}
                      className={`group flex items-center gap-1.5 px-3 py-1 rounded-t-md text-xs cursor-pointer transition-colors shrink-0 select-none ${
                        draggingTabId === tab.tabId ? "opacity-40" : ""
                      } ${
                        isVisible
                          ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-medium border-t border-x border-zinc-200 dark:border-zinc-800"
                          : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50"
                      } ${isBefore ? "border-l-2 border-l-indigo-500" : ""} ${
                        isAfter ? "border-r-2 border-r-indigo-500" : ""
                      }`}
                    >
                      {splitDirection !== "none" && (isPane1 || isPane2) && (
                        <span
                          className={`text-[9px] font-bold px-1 rounded leading-tight ${
                            (isPane1 && focusedPane === 1) ||
                            (isPane2 && focusedPane === 2)
                              ? "bg-indigo-600 text-white"
                              : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                          }`}
                        >
                          {isPane1 ? "1" : "2"}
                        </span>
                      )}
                      {tab.session.protocol === "ssh" ? (
                        <TerminalSolidIcon
                          className="w-3.5 h-3.5 shrink-0"
                          style={{
                            color: resolveIconColor(tab.session.icon_color, "#a855f7"),
                          }}
                        />
                      ) : (
                        <FolderTree
                          className="w-3 h-3 shrink-0"
                          style={{
                            color: resolveIconColor(tab.session.icon_color, "#38bdf8"),
                          }}
                        />
                      )}
                      <span className="max-w-36 truncate">{tab.session.name}</span>
                      <button
                        type="button"
                        title={t("tabs.duplicate")}
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateTab(tab.tabId);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        title={t("tabs.close")}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.tabId);
                        }}
                        className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Split Screen Controls */}
              <div className="flex items-center gap-0.5 shrink-0 bg-zinc-200/70 dark:bg-zinc-800/70 p-0.5 rounded-md">
                <button
                  type="button"
                  title={t("tabs.split_single")}
                  onClick={() => setSplitDirection("none")}
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    splitDirection === "none"
                      ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title={t("tabs.split_horizontal")}
                  onClick={() =>
                    setSplitDirection(
                      splitDirection === "horizontal" ? "none" : "horizontal"
                    )
                  }
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    splitDirection === "horizontal"
                      ? "bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  <Columns2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title={t("tabs.split_vertical")}
                  onClick={() =>
                    setSplitDirection(
                      splitDirection === "vertical" ? "none" : "vertical"
                    )
                  }
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    splitDirection === "vertical"
                      ? "bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
                >
                  <Rows2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Workspace Body */}
          {tabs.length === 0 ? (
            <HomePage
              onQuickConnect={(sessionKind) =>
                setSessionModal({ mode: "quick", sessionKind })
              }
            />
          ) : (
            <div
              ref={workspaceContainerRef}
              className={`flex-1 min-h-0 min-w-0 flex ${
                splitDirection === "vertical" ? "flex-col" : "flex-row"
              }`}
            >
              {tabs.map((tab) => {
                const isSplit = splitDirection !== "none";
                const isPane1 = tab.tabId === activeTabId;
                const isPane2 = isSplit && tab.tabId === secondaryTabId;
                const isVisible = isPane1 || isPane2;

                const paneStyle: React.CSSProperties | undefined = !isVisible
                  ? undefined
                  : !isSplit
                  ? { flex: "1 1 0%" }
                  : isPane1
                  ? { order: 1, flexBasis: `${splitRatio}%`, flexGrow: 0, flexShrink: 0 }
                  : { order: 3, flexBasis: `${100 - splitRatio}%`, flexGrow: 1, flexShrink: 1 };

                const isFocused =
                  isSplit &&
                  ((isPane1 && focusedPane === 1) || (isPane2 && focusedPane === 2));

                return (
                  <div
                    key={tab.tabId}
                    onMouseDown={() => {
                      if (!isSplit) return;
                      if (isPane1 && focusedPane !== 1) setFocusedPane(1);
                      else if (isPane2 && focusedPane !== 2) setFocusedPane(2);
                    }}
                    style={paneStyle}
                    className={`${
                      isVisible ? "flex flex-col min-h-0 min-w-0 overflow-hidden" : "hidden"
                    } ${
                      isFocused
                        ? "ring-1 ring-inset ring-indigo-500/70"
                        : ""
                    }`}
                  >
                    {tab.session.protocol === "ssh" ? (
                      <SshTerminalWorkspace tab={tab} isActive={isVisible} />
                    ) : (
                      <SessionWorkspace tab={tab} isActive={isVisible} />
                    )}
                  </div>
                );
              })}

              {/* Resizable Split Handle */}
              {splitDirection !== "none" && (
                <div
                  role="separator"
                  onPointerDown={handleStartSplitResize}
                  style={{ order: 2 }}
                  className={`shrink-0 bg-zinc-200 dark:bg-zinc-800 hover:bg-indigo-500 dark:hover:bg-indigo-500 transition-colors ${
                    splitDirection === "vertical"
                      ? "h-1.5 w-full cursor-row-resize"
                      : "w-1.5 h-full cursor-col-resize"
                  }`}
                />
              )}

              {/* Empty Secondary Pane Placeholder when Split is active with only 1 tab */}
              {splitDirection !== "none" && !secondaryTabId && (
                <div
                  onMouseDown={() => setFocusedPane(2)}
                  style={{
                    order: 3,
                    flexBasis: `${100 - splitRatio}%`,
                    flexGrow: 1,
                    flexShrink: 1,
                  }}
                  className={`flex flex-col items-center justify-center p-6 text-center bg-zinc-50/50 dark:bg-zinc-950/60 min-h-0 min-w-0 ${
                    focusedPane === 2 ? "ring-1 ring-inset ring-indigo-500/70" : ""
                  }`}
                >
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs mb-3">
                    {t("tabs.split_empty_hint")}
                  </p>
                  {activeTabId && (
                    <button
                      type="button"
                      onClick={() => duplicateTab(activeTabId)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {t("tabs.split_duplicate_current")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {tabDragGhost && (
        <div
          style={{
            left: tabDragGhost.x + 12,
            top: tabDragGhost.y + 12,
          }}
          className="fixed z-50 pointer-events-none px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-xs font-medium shadow-xl max-w-44 truncate"
        >
          {tabDragGhost.label}
        </div>
      )}

      {/* Modals */}
      {showCredentials && (
        <CredentialsModal onClose={() => setShowCredentials(false)} />
      )}
      {showImportExport && (
        <ImportExportModal onClose={() => setShowImportExport(false)} />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {sessionModal && (
        <SessionModal
          mode={sessionModal.mode}
          sessionKind={sessionModal.sessionKind}
          initialFolderId={sessionModal.folderId}
          session={sessionModal.session}
          onClose={() => setSessionModal(null)}
        />
      )}
      {conflictQueue.length > 0 && (
        <ConflictModal
          conflict={conflictQueue[0]}
          onResolve={async (action, applyToAll) => {
            const current = conflictQueue[0];
            if (applyToAll) {
              // Clear all queued conflicts locally as backend resolves them all
              conflictQueue.forEach((c) => removeConflict(c.transfer_id));
            } else {
              removeConflict(current.transfer_id);
            }
            await api.resolveTransferConflict(current.transfer_id, action, applyToAll);
          }}
        />
      )}
    </div>
  );
}

export default App;
