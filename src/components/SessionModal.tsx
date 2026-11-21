import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { Server, X, FolderOpen } from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import {
  defaultPortForProtocol,
  extractErrorMessage,
  type Protocol,
  type Session,
} from "../types";

interface SessionModalProps {
  mode: "create" | "edit" | "quick";
  initialFolderId?: string | null;
  session?: Session | null;
  onClose: () => void;
}

export function SessionModal({
  mode,
  initialFolderId = null,
  session = null,
  onClose,
}: SessionModalProps) {
  const { t } = useTranslation();
  const { folders, credentials, refreshVaultData, openSessionTab } = useAppStore();

  const [name, setName] = useState(session?.name ?? "");
  const [folderId, setFolderId] = useState<string>(
    session?.folder_id ?? initialFolderId ?? ""
  );
  const [protocol, setProtocol] = useState<Protocol>(session?.protocol ?? "sftp");
  const [host, setHost] = useState(session?.host ?? "");
  const [port, setPort] = useState<number>(
    session?.port ?? defaultPortForProtocol(session?.protocol ?? "sftp")
  );
  const [credentialId, setCredentialId] = useState<string>(
    session?.credential_id ?? ""
  );
  const [remotePath, setRemotePath] = useState(session?.remote_initial_path ?? "");
  const [localPath, setLocalPath] = useState(session?.local_initial_path ?? "");
  const [passiveMode, setPassiveMode] = useState(session?.passive_mode ?? true);
  const [acceptInvalidCerts, setAcceptInvalidCerts] = useState(
    session?.accept_invalid_certs ?? false
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleProtocolChange = (next: Protocol) => {
    const oldDefault = defaultPortForProtocol(protocol);
    setProtocol(next);
    if (port === oldDefault) {
      setPort(defaultPortForProtocol(next));
    }
  };

  const handleBrowseLocal = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setLocalPath(selected);
      }
    } catch {
      // ignore if cancelled
    }
  };

  const handleSubmit = async (e: React.FormEvent, connectAfter = false) => {
    e.preventDefault();
    setError(null);

    if (!host.trim()) return;

    if (mode === "quick") {
      const tempSession: Session = {
        id: `quick-${crypto.randomUUID()}`,
        folder_id: null,
        credential_id: credentialId || null,
        name: name.trim() || host.trim(),
        protocol,
        host: host.trim(),
        port,
        remote_initial_path: remotePath,
        local_initial_path: localPath,
        passive_mode: passiveMode,
        accept_invalid_certs: acceptInvalidCerts,
        sort_order: 0,
      };
      openSessionTab(tempSession);
      onClose();
      return;
    }

    setSaving(true);
    try {
      const input = {
        folder_id: folderId || null,
        credential_id: credentialId || null,
        name: name.trim() || host.trim(),
        protocol,
        host: host.trim(),
        port,
        remote_initial_path: remotePath,
        local_initial_path: localPath,
        passive_mode: passiveMode,
        accept_invalid_certs: acceptInvalidCerts,
      };

      const saved =
        mode === "edit" && session
          ? await api.updateSession(session.id, input)
          : await api.createSession(input);

      await refreshVaultData();
      if (connectAfter) {
        openSessionTab(saved);
      }
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const isFtpLike =
    protocol === "ftp" ||
    protocol === "ftps_explicit" ||
    protocol === "ftps_implicit";
  const isFtps = protocol === "ftps_explicit" || protocol === "ftps_implicit";

  const title =
    mode === "quick"
      ? t("session.quick_title")
      : mode === "edit"
      ? t("session.edit_title")
      : t("session.new_title");

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
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

        <form onSubmit={(e) => handleSubmit(e, mode === "quick")} className="p-6 space-y-4">
          {mode !== "quick" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("session.name")} *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("session.name_placeholder")}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("session.folder")}
                </label>
                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t("session.folder_root")}</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t("session.protocol")}
              </label>
              <select
                value={protocol}
                onChange={(e) => handleProtocolChange(e.target.value as Protocol)}
                className="w-full px-2.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="sftp">SFTP (SSH)</option>
                <option value="ftps_explicit">FTPS (Explicit)</option>
                <option value="ftps_implicit">FTPS (Implicit)</option>
                <option value="ftp">FTP</option>
                <option value="ssh">SSH Terminal</option>
              </select>
            </div>

            <div className="col-span-6">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t("session.host")} *
              </label>
              <input
                type="text"
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder={t("session.host_placeholder")}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t("session.port")}
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || 22)}
                className="w-full px-2.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t("session.credential")}
            </label>
            <select
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t("session.credential_none")}</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.username || "—"})
                </option>
              ))}
            </select>
          </div>

          {protocol !== "ssh" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("session.remote_path")}
                </label>
                <input
                  type="text"
                  value={remotePath}
                  onChange={(e) => setRemotePath(e.target.value)}
                  placeholder="/var/www"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("session.local_path")}
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                    placeholder="C:\Users\..."
                    className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseLocal}
                    title={t("session.browse")}
                    className="px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {isFtpLike && (
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={passiveMode}
                  onChange={(e) => setPassiveMode(e.target.checked)}
                  className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                {t("session.passive_mode")}
              </label>
              {isFtps && (
                <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptInvalidCerts}
                    onChange={(e) => setAcceptInvalidCerts(e.target.checked)}
                    className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {t("session.accept_invalid_certs")}
                </label>
              )}
            </div>
          )}

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {t("app.cancel")}
            </button>
            {mode === "quick" ? (
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
              >
                {t("session.connect_now")}
              </button>
            ) : (
              <>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-indigo-600 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer"
                >
                  {t("app.save")}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={(e) => handleSubmit(e, true)}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer"
                >
                  {t("session.save_and_connect")}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
