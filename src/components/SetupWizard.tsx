import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  ShieldCheck,
  KeyRound,
  Lock,
  Upload,
  FileJson,
  Database,
} from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import { AppLogo } from "./AppLogo";
import {
  extractErrorMessage,
  type ExportSummary,
  type SecurityMode,
} from "../types";

export function SetupWizard() {
  const { t } = useTranslation();
  const { config, setSecurity, refreshVaultData, updateConfig } = useAppStore(
    useShallow((s) => ({
      config: s.config,
      setSecurity: s.setSecurity,
      refreshVaultData: s.refreshVaultData,
      updateConfig: s.updateConfig,
    }))
  );

  const [tab, setTab] = useState<"new" | "from_json">("new");
  const [mode, setMode] = useState<SecurityMode>("master_password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(
    config.theme === "light" ? "light" : "dark"
  );
  const [copyOnSelect, setCopyOnSelect] = useState<boolean>(
    config.terminal_copy_on_select
  );

  // Restore from JSON state
  const [rawJson, setRawJson] = useState("");
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [reusePassword, setReusePassword] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSummary(null);
    setFileName(file.name);
    setImportPassword("");

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== "string") return;
      const text = reader.result;
      setRawJson(text);
      try {
        const info = await api.inspectExportBundle(text);
        setSummary(info);
      } catch (err) {
        setError(extractErrorMessage(err));
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (tab === "new") {
      if (mode === "master_password") {
        if (password.length < 4) {
          setError(t("setup.password_short"));
          return;
        }
        if (password !== confirm) {
          setError(t("setup.password_mismatch"));
          return;
        }
      }

      setSubmitting(true);
      try {
        await updateConfig({ theme, terminal_copy_on_select: copyOnSelect });
        const status = await api.setupSecurityMode(
          mode,
          mode === "master_password" ? password : undefined
        );
        setSecurity(status);
        await refreshVaultData();
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // tab === "from_json"
    if (!summary || !rawJson) return;

    if (summary.encrypted && !importPassword) {
      setError(t("setup.import_password_required"));
      return;
    }

    let finalMasterPassword: string | undefined;
    if (mode === "master_password") {
      if (summary.encrypted && reusePassword) {
        finalMasterPassword = importPassword;
      } else {
        if (password.length < 4) {
          setError(t("setup.password_short"));
          return;
        }
        if (password !== confirm) {
          setError(t("setup.password_mismatch"));
          return;
        }
        finalMasterPassword = password;
      }
    }

    setSubmitting(true);
    try {
      await updateConfig({ theme, terminal_copy_on_select: copyOnSelect });
      const status = await api.setupFromJson(
        rawJson,
        mode,
        summary.encrypted ? importPassword : undefined,
        finalMasterPassword
      );
      setSecurity(status);
      await refreshVaultData();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const showNewMasterPasswordFields =
    mode === "master_password" &&
    (tab === "new" || !summary?.encrypted || !reusePassword);

  return (
    <div className="h-full w-full flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6 overflow-y-auto">
      <div className="w-full max-w-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-8">
        <div className="flex items-center gap-3 mb-3">
          <AppLogo className="w-11 h-11 rounded-xl shadow shrink-0" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              {t("setup.title")}
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              formatocd • CD Remote
            </p>
          </div>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-5">
          {t("setup.subtitle")}
        </p>

        {/* Source Selector Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 mb-5">
          <button
            type="button"
            onClick={() => {
              setTab("new");
              setError(null);
            }}
            className={`inline-flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              tab === "new"
                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            {t("setup.tab_new")}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("from_json");
              setError(null);
            }}
            className={`inline-flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              tab === "from_json"
                ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            <FileJson className="w-3.5 h-3.5" />
            {t("setup.tab_from_json")}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === "from_json" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  {t("setup.select_json")}
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                {fileName && (
                  <span className="text-xs font-mono text-zinc-500 truncate">
                    {fileName}
                  </span>
                )}
              </div>

              {summary && (
                <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {t("setup.json_summary", {
                        folders: summary.folders_count,
                        credentials: summary.credentials_count,
                        sessions: summary.sessions_count,
                      })}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        summary.encrypted
                          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {summary.encrypted
                        ? t("setup.json_encrypted_badge")
                        : t("setup.json_plain_badge")}
                    </span>
                  </div>

                  {summary.encrypted && (
                    <div className="pt-1">
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        {t("setup.import_password_label")}
                      </label>
                      <input
                        type="password"
                        value={importPassword}
                        onChange={(e) => setImportPassword(e.target.value)}
                        autoFocus
                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  )}
                </div>
              )}

              {summary && (
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 pt-1">
                  {t("setup.new_vault_mode")}
                </div>
              )}
            </div>
          )}

          {(tab === "new" || summary) && (
            <>
              <button
                type="button"
                onClick={() => setMode("master_password")}
                className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer ${
                  mode === "master_password"
                    ? "border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 ring-1 ring-indigo-500"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Lock className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                      {t("setup.modeA_title")}
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed">
                      {t("setup.modeA_desc")}
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode("transparent")}
                className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer ${
                  mode === "transparent"
                    ? "border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 ring-1 ring-indigo-500"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                }`}
              >
                <div className="flex items-start gap-3">
                  <KeyRound className="w-5 h-5 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                      {t("setup.modeB_title")}
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed">
                      {t("setup.modeB_desc")}
                    </p>
                  </div>
                </div>
              </button>

              {tab === "from_json" &&
                summary?.encrypted &&
                mode === "master_password" && (
                  <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={reusePassword}
                      onChange={(e) => setReusePassword(e.target.checked)}
                      className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {t("setup.reuse_password")}
                  </label>
                )}

              {showNewMasterPasswordFields && (
                <div className="pt-1 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {t("setup.password_label")}
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("setup.password_placeholder")}
                      autoFocus={tab === "new"}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {t("setup.password_confirm")}
                    </label>
                    <input
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder={t("setup.password_placeholder")}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Default Preferences: Theme & Terminal Copy-on-Select */}
          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {t("setup.preferences_title")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  {t("settings.theme")}
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                  {(["light", "dark"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        setTheme(opt);
                        updateConfig({ theme: opt });
                      }}
                      className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        theme === opt
                          ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                          : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      }`}
                    >
                      {t(`settings.theme_${opt}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  {t("settings.terminal_copy_on_select")}
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setCopyOnSelect(true)}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      copyOnSelect
                        ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                    }`}
                  >
                    {t("setup.yes")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopyOnSelect(false)}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      !copyOnSelect
                        ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                    }`}
                  >
                    {t("setup.no")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={submitting || (tab === "from_json" && !summary)}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              {tab === "from_json"
                ? t("setup.restore_button")
                : t("setup.start_button")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
