import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Shield, X, CheckCircle2 } from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import { extractErrorMessage, type AppConfig, type SecurityMode } from "../types";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { t } = useTranslation();
  const { config, security, updateConfig, setSecurity } = useAppStore();

  const [theme, setTheme] = useState<AppConfig["theme"]>(config.theme);
  const [language, setLanguage] = useState<AppConfig["language"]>(config.language);
  const [maxConcurrent, setMaxConcurrent] = useState(config.max_concurrent_transfers);
  const [uploadLimit, setUploadLimit] = useState(config.upload_limit_kbps);
  const [downloadLimit, setDownloadLimit] = useState(config.download_limit_kbps);
  const [terminalFontFamily, setTerminalFontFamily] = useState(
    config.terminal_font_family
  );
  const [terminalFontSize, setTerminalFontSize] = useState(
    config.terminal_font_size
  );
  const [terminalCopyOnSelect, setTerminalCopyOnSelect] = useState(
    config.terminal_copy_on_select
  );
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Security migration state
  const [targetMode, setTargetMode] = useState<SecurityMode>(
    security.mode === "master_password" ? "transparent" : "master_password"
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [secMsg, setSecMsg] = useState<string | null>(null);
  const [secErr, setSecErr] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedMsg(null);
    await updateConfig({
      theme,
      language,
      max_concurrent_transfers: Math.max(1, Number(maxConcurrent) || 1),
      upload_limit_kbps: Math.max(0, Number(uploadLimit) || 0),
      download_limit_kbps: Math.max(0, Number(downloadLimit) || 0),
      terminal_font_family:
        terminalFontFamily.trim() ||
        "Cascadia Code, Consolas, ui-monospace, monospace",
      terminal_font_size: Math.min(28, Math.max(10, Number(terminalFontSize) || 13)),
      terminal_copy_on_select: terminalCopyOnSelect,
    });
    setSavedMsg(t("settings.saved"));
  };

  const handleSecurityChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecErr(null);
    setSecMsg(null);
    setMigrating(true);
    try {
      const nextStatus = await api.changeSecurityMode(
        targetMode,
        security.mode === "master_password" ? currentPassword : undefined,
        targetMode === "master_password" ? newPassword : undefined
      );
      setSecurity(nextStatus);
      setCurrentPassword("");
      setNewPassword("");
      setSecMsg(t("settings.migrate_success"));
    } catch (err) {
      setSecErr(extractErrorMessage(err));
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[88vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("settings.title")}
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

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <form onSubmit={handleSaveGeneral} className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {t("settings.appearance")}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("settings.theme")}
                </label>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as AppConfig["theme"])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="system">{t("settings.theme_system")}</option>
                  <option value="light">{t("settings.theme_light")}</option>
                  <option value="dark">{t("settings.theme_dark")}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("settings.language")}
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as AppConfig["language"])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 pt-2">
              {t("settings.transfers")}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("settings.max_concurrent")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("settings.upload_limit")}
                </label>
                <input
                  type="number"
                  min={0}
                  value={uploadLimit}
                  onChange={(e) => setUploadLimit(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("settings.download_limit")}
                </label>
                <input
                  type="number"
                  min={0}
                  value={downloadLimit}
                  onChange={(e) => setDownloadLimit(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>

            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 pt-2">
              {t("settings.terminal")}
            </h3>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-9">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("settings.terminal_font_family")}
                </label>
                <input
                  type="text"
                  list="terminal-font-presets"
                  value={terminalFontFamily}
                  onChange={(e) => setTerminalFontFamily(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
                <datalist id="terminal-font-presets">
                  <option value="Cascadia Code, Consolas, monospace" />
                  <option value="JetBrains Mono, Consolas, monospace" />
                  <option value="Fira Code, Consolas, monospace" />
                  <option value="Consolas, monospace" />
                  <option value="CaskaydiaCove Nerd Font, Cascadia Code, monospace" />
                  <option value="MesloLGS NF, Menlo, monospace" />
                  <option value="DejaVu Sans Mono, monospace" />
                  <option value="Menlo, Monaco, monospace" />
                </datalist>
              </div>
              <div className="col-span-3">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("settings.terminal_font_size")}
                </label>
                <input
                  type="number"
                  min={10}
                  max={28}
                  value={terminalFontSize}
                  onChange={(e) => setTerminalFontSize(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>
            <div
              style={{
                fontFamily: terminalFontFamily,
                fontSize: `${Math.min(28, Math.max(10, Number(terminalFontSize) || 13))}px`,
              }}
              className="px-3 py-2 rounded-lg bg-zinc-950 text-emerald-400 border border-zinc-800 truncate"
            >
              carlos@cd-connector:~$ ls -la /var/www/html
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={terminalCopyOnSelect}
                onChange={(e) => setTerminalCopyOnSelect(e.target.checked)}
                className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
              />
              {t("settings.terminal_copy_on_select")}
            </label>

            <div className="flex items-center justify-between pt-1">
              {savedMsg ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  {savedMsg}
                </span>
              ) : (
                <span />
              )}
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
              >
                {t("app.save")}
              </button>
            </div>
          </form>

          <hr className="border-zinc-200 dark:border-zinc-800" />

          <form onSubmit={handleSecurityChange} className="space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {t("settings.security")}
              </h3>
            </div>

            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {t("settings.current_mode")}:{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {security.mode === "master_password"
                  ? t("setup.modeA_title")
                  : t("setup.modeB_title")}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTargetMode("master_password")}
                className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer ${
                  targetMode === "master_password"
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {security.mode === "master_password"
                  ? t("settings.change_master_pwd")
                  : t("settings.migrate_to_a")}
              </button>
              {security.mode === "master_password" && (
                <button
                  type="button"
                  onClick={() => setTargetMode("transparent")}
                  className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer ${
                    targetMode === "transparent"
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {t("settings.migrate_to_b")}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {security.mode === "master_password" && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t("settings.current_password")}
                  </label>
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                </div>
              )}
              {targetMode === "master_password" && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t("settings.new_password")}
                  </label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                </div>
              )}
            </div>

            {secErr && (
              <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
                {secErr}
              </div>
            )}
            {secMsg && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4" />
                {secMsg}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={migrating}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {t("settings.migrate_button")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
