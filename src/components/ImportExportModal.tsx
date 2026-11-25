import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeftRight,
  Download,
  Upload,
  X,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import {
  extractErrorMessage,
  type BackendError,
  type ImportAction,
  type ImportPreview,
  type ImportResult,
} from "../types";

interface ImportExportModalProps {
  onClose: () => void;
}

export function ImportExportModal({ onClose }: ImportExportModalProps) {
  const { t } = useTranslation();
  const refreshVaultData = useAppStore((s) => s.refreshVaultData);

  const [tab, setTab] = useState<"export" | "import">("export");
  const [includeUsernames, setIncludeUsernames] = useState(true);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Import state
  const [rawJson, setRawJson] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [importPassword, setImportPassword] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setExportMessage(null);

    if (includeSecrets) {
      if (exportPassword.length < 4) {
        setError(t("setup.password_short"));
        return;
      }
      if (exportPassword !== exportPasswordConfirm) {
        setError(t("setup.password_mismatch"));
        return;
      }
    }

    setBusy(true);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const selectedPath = await save({
        defaultPath: `cd-remote-backup-${dateStr}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!selectedPath) {
        return;
      }

      const json = await api.exportData({
        include_usernames: includeUsernames,
        include_secrets: includeSecrets,
        export_password: includeSecrets ? exportPassword : undefined,
      });
      await api.writeBackupFile(selectedPath, json);
      setExportMessage(`${t("portability.export_success")} (${selectedPath})`);
      setExportPassword("");
      setExportPasswordConfirm("");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const analyzeImport = async (jsonText: string, pwd?: string) => {
    setError(null);
    setImportResult(null);
    setBusy(true);
    try {
      const result = await api.previewImport(jsonText, pwd);
      setPreview(result);
      setNeedsPassword(false);
    } catch (err) {
      const be = err as BackendError;
      if (be?.message?.includes("IMPORT_PASSWORD_REQUIRED")) {
        setNeedsPassword(true);
        setPreview(null);
      } else {
        setError(extractErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSelectImportFile = async () => {
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!selected || typeof selected !== "string") return;

      setFileName(selected);
      setPreview(null);
      setNeedsPassword(false);
      setImportPassword("");
      setImportResult(null);

      const content = await api.readBackupFile(selected);
      setRawJson(content);
      await analyzeImport(content);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleCommitImport = async () => {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.commitImport({
        raw_json: rawJson,
        import_password: importPassword || null,
        folders: preview.folders,
        credentials: preview.credentials,
        sessions: preview.sessions,
      });
      setImportResult(res);
      setPreview(null);
      await refreshVaultData();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[88vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ArrowLeftRight className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("portability.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-3 border-b border-zinc-200 dark:border-zinc-800 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setTab("export");
              setError(null);
            }}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              tab === "export"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {t("portability.export_tab")}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("import");
              setError(null);
            }}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              tab === "import"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {t("portability.import_tab")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tab === "export" ? (
            <form onSubmit={handleExport} className="space-y-4">
              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t("portability.export_desc")}
              </div>

              <div className="space-y-2.5 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <label className="flex items-center gap-2.5 text-xs text-zinc-800 dark:text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeUsernames}
                    onChange={(e) => setIncludeUsernames(e.target.checked)}
                    className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {t("portability.export_include_usernames")}
                </label>

                <label className="flex items-center gap-2.5 text-xs text-zinc-800 dark:text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeSecrets}
                    onChange={(e) => {
                      setIncludeSecrets(e.target.checked);
                      setError(null);
                    }}
                    className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {t("portability.export_include_secrets")}
                </label>

                {includeSecrets && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        {t("portability.export_password_label")} *
                      </label>
                      <input
                        type="password"
                        required
                        value={exportPassword}
                        onChange={(e) => setExportPassword(e.target.value)}
                        placeholder={t("portability.export_password_placeholder")}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        {t("portability.export_password_confirm")} *
                      </label>
                      <input
                        type="password"
                        required
                        value={exportPasswordConfirm}
                        onChange={(e) => setExportPasswordConfirm(e.target.value)}
                        placeholder={t("portability.export_password_placeholder")}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {exportMessage && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {exportMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {t("portability.export_button")}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSelectImportFile}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  <Upload className="w-4 h-4" />
                  {t("portability.import_select_file")}
                </button>
                {fileName && (
                  <span
                    title={fileName}
                    className="text-xs font-mono text-zinc-500 dark:text-zinc-400 truncate"
                  >
                    {fileName}
                  </span>
                )}
              </div>

              {needsPassword && (
                <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-300">
                    <Lock className="w-4 h-4" />
                    {t("portability.import_password_needed")}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      disabled={busy || !importPassword}
                      onClick={() => analyzeImport(rawJson, importPassword)}
                      className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer"
                    >
                      {t("portability.import_analyze")}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {importResult && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {t("portability.import_done", {
                    folders: importResult.folders_imported,
                    credentials: importResult.credentials_imported,
                    sessions: importResult.sessions_imported,
                  })}
                </div>
              )}

              {preview && (
                <div className="space-y-5">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {t("portability.import_preview_title")}
                  </p>

                  {preview.folders.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        {t("portability.folders_section")} ({preview.folders.length})
                      </h4>
                      <div className="space-y-1.5">
                        {preview.folders.map((f, idx) => (
                          <div
                            key={f.id}
                            className="flex items-center gap-2 p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50"
                          >
                            <input
                              type="text"
                              value={f.name}
                              onChange={(e) => {
                                const next = [...preview.folders];
                                next[idx] = { ...f, name: e.target.value };
                                setPreview({ ...preview, folders: next });
                              }}
                              className="flex-1 px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            />
                            {f.conflict_id && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 shrink-0">
                                <AlertTriangle className="w-3 h-3" />
                                {t("portability.import_conflicts_badge")}
                              </span>
                            )}
                            <select
                              value={f.action}
                              onChange={(e) => {
                                const next = [...preview.folders];
                                next[idx] = {
                                  ...f,
                                  action: e.target.value as ImportAction,
                                };
                                setPreview({ ...preview, folders: next });
                              }}
                              className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            >
                              <option value="import">{t("portability.action_import")}</option>
                              {f.conflict_id && (
                                <option value="overwrite">
                                  {t("portability.action_overwrite")}
                                </option>
                              )}
                              <option value="skip">{t("portability.action_skip")}</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.credentials.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        {t("portability.credentials_section")} ({preview.credentials.length})
                      </h4>
                      <div className="space-y-1.5">
                        {preview.credentials.map((c, idx) => (
                          <div
                            key={c.id}
                            className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50"
                          >
                            <input
                              type="text"
                              value={c.name}
                              onChange={(e) => {
                                const next = [...preview.credentials];
                                next[idx] = { ...c, name: e.target.value };
                                setPreview({ ...preview, credentials: next });
                              }}
                              className="flex-1 min-w-36 px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            />
                            <input
                              type="text"
                              value={c.username}
                              onChange={(e) => {
                                const next = [...preview.credentials];
                                next[idx] = { ...c, username: e.target.value };
                                setPreview({ ...preview, credentials: next });
                              }}
                              className="w-32 px-2 py-1 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            />
                            {c.conflict_id && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="w-3 h-3" />
                                {t("portability.import_conflicts_badge")}
                              </span>
                            )}
                            <select
                              value={c.action}
                              onChange={(e) => {
                                const next = [...preview.credentials];
                                next[idx] = {
                                  ...c,
                                  action: e.target.value as ImportAction,
                                };
                                setPreview({ ...preview, credentials: next });
                              }}
                              className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            >
                              <option value="import">{t("portability.action_import")}</option>
                              {c.conflict_id && (
                                <option value="overwrite">
                                  {t("portability.action_overwrite")}
                                </option>
                              )}
                              <option value="skip">{t("portability.action_skip")}</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.sessions.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        {t("portability.sessions_section")} ({preview.sessions.length})
                      </h4>
                      <div className="space-y-1.5">
                        {preview.sessions.map((s, idx) => (
                          <div
                            key={s.id}
                            className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50"
                          >
                            <input
                              type="text"
                              value={s.name}
                              onChange={(e) => {
                                const next = [...preview.sessions];
                                next[idx] = { ...s, name: e.target.value };
                                setPreview({ ...preview, sessions: next });
                              }}
                              className="flex-1 min-w-36 px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            />
                            <input
                              type="text"
                              value={s.host}
                              onChange={(e) => {
                                const next = [...preview.sessions];
                                next[idx] = { ...s, host: e.target.value };
                                setPreview({ ...preview, sessions: next });
                              }}
                              className="w-40 px-2 py-1 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            />
                            <input
                              type="number"
                              value={s.port}
                              onChange={(e) => {
                                const next = [...preview.sessions];
                                next[idx] = {
                                  ...s,
                                  port: Number(e.target.value) || s.port,
                                };
                                setPreview({ ...preview, sessions: next });
                              }}
                              className="w-18 px-2 py-1 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            />
                            {s.conflict_id && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="w-3 h-3" />
                                {t("portability.import_conflicts_badge")}
                              </span>
                            )}
                            <select
                              value={s.action}
                              onChange={(e) => {
                                const next = [...preview.sessions];
                                next[idx] = {
                                  ...s,
                                  action: e.target.value as ImportAction,
                                };
                                setPreview({ ...preview, sessions: next });
                              }}
                              className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                            >
                              <option value="import">{t("portability.action_import")}</option>
                              {s.conflict_id && (
                                <option value="overwrite">
                                  {t("portability.action_overwrite")}
                                </option>
                              )}
                              <option value="skip">{t("portability.action_skip")}</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleCommitImport}
                      className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer"
                    >
                      {t("portability.import_commit")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
