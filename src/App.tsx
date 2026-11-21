import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Disc3,
  PanelLeft,
  Columns2,
  Terminal,
  ListChecks,
  Zap,
  KeyRound,
  ArrowLeftRight,
  Settings,
  Lock,
  Copy,
  X,
  Server,
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
import type { Session } from "./types";

export function App() {
  const { t } = useTranslation();
  const {
    loading,
    security,
    config,
    tabs,
    activeTabId,
    initialize,
    setSecurity,
    updateConfig,
    setActiveTab,
    closeTab,
    duplicateTab,
  } = useAppStore();

  const [showCredentials, setShowCredentials] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionModal, setSessionModal] = useState<{
    mode: "create" | "edit" | "quick";
    folderId?: string | null;
    session?: Session | null;
  } | null>(null);

  useEffect(() => {
    initialize();
  }, [initialize]);

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

  const activeTab = tabs.find((tab) => tab.tabId === activeTabId) ?? null;

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

          <div className="flex items-center gap-1.5 pr-2">
            <Disc3 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-semibold tracking-tight">
              {t("app.name")}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setSessionModal({ mode: "quick" })}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            {t("toolbar.quick_connect")}
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
            <Terminal className="w-3.5 h-3.5" />
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
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex">
        {config.ui_show_sidebar && (
          <Sidebar
            onNewSession={(folderId) =>
              setSessionModal({ mode: "create", folderId })
            }
            onEditSession={(session) =>
              setSessionModal({ mode: "edit", session })
            }
          />
        )}

        <main className="flex-1 min-w-0 flex flex-col">
          {/* Tabs Bar */}
          {tabs.length > 0 && (
            <div className="h-9 shrink-0 px-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/50 flex items-center gap-1 overflow-x-auto">
              {tabs.map((tab) => {
                const isActive = tab.tabId === activeTabId;
                return (
                  <div
                    key={tab.tabId}
                    onClick={() => setActiveTab(tab.tabId)}
                    className={`group flex items-center gap-1.5 px-3 py-1 rounded-t-md text-xs cursor-pointer transition-colors shrink-0 ${
                      isActive
                        ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-medium border-t border-x border-zinc-200 dark:border-zinc-800"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    <Server className="w-3 h-3 text-indigo-500" />
                    <span className="max-w-36 truncate">{tab.session.name}</span>
                    <button
                      type="button"
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
          )}

          {/* Workspace Body */}
          {!activeTab ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-4">
                <Disc3 className="w-8 h-8" />
              </div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {t("workspace.welcome_title")}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mt-1.5 leading-relaxed">
                {t("workspace.welcome_desc")}
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Dual File Panels */}
              <div className="flex-1 min-h-0 flex divide-x divide-zinc-200 dark:divide-zinc-800">
                {config.ui_show_local_panel && (
                  <section className="flex-1 p-4 flex flex-col">
                    <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                      {t("workspace.panel_local")}
                    </div>
                    <div className="flex-1 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 flex items-center justify-center text-xs text-zinc-400">
                      {t("workspace.phase2_hint")}
                    </div>
                  </section>
                )}
                <section className="flex-1 p-4 flex flex-col">
                  <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                    {t("workspace.panel_remote")} —{" "}
                    <span className="font-mono normal-case text-indigo-600 dark:text-indigo-400">
                      {activeTab.session.protocol}://{activeTab.session.host}:
                      {activeTab.session.port}
                    </span>
                  </div>
                  <div className="flex-1 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 flex items-center justify-center text-xs text-zinc-400">
                    {t("workspace.tab_placeholder", {
                      protocol: activeTab.session.protocol,
                      host: activeTab.session.host,
                      port: activeTab.session.port,
                    })}
                  </div>
                </section>
              </div>

              {/* Console Panel (RF-11 / RF-14) */}
              {config.ui_show_command_panel && (
                <section className="h-32 shrink-0 border-t border-zinc-200 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-900/60 flex flex-col">
                  <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                    {t("workspace.panel_console")}
                  </div>
                  <div className="flex-1 font-mono text-xs text-zinc-400">
                    {t("workspace.phase2_hint")}
                  </div>
                </section>
              )}

              {/* Transfer Queue Panel (RF-11 / RF-16) */}
              {config.ui_show_queue_panel && (
                <section className="h-32 shrink-0 border-t border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-950 flex flex-col">
                  <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                    {t("workspace.panel_queue")}
                  </div>
                  <div className="flex-1 text-xs text-zinc-400">
                    {t("workspace.phase2_hint")}
                  </div>
                </section>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      {showCredentials && (
        <CredentialsModal onClose={() => setShowCredentials(false)} />
      )}
      {showImportExport && (
        <ImportExportModal onClose={() => setShowImportExport(false)} />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {sessionModal && (
        <SessionModal
          mode={sessionModal.mode}
          initialFolderId={sessionModal.folderId}
          session={sessionModal.session}
          onClose={() => setSessionModal(null)}
        />
      )}
    </div>
  );
}

export default App;
