import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Server,
  X,
  FolderOpen,
  Upload,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import {
  defaultPortForProtocol,
  extractErrorMessage,
  type AuthType,
  type Protocol,
  type Session,
} from "../types";

interface SessionModalProps {
  mode: "create" | "edit" | "quick";
  initialFolderId?: string | null;
  session?: Session | null;
  onClose: () => void;
}

type SessionAuthMode = "manual" | "reusable" | "none";

export function SessionModal({
  mode,
  initialFolderId = null,
  session = null,
  onClose,
}: SessionModalProps) {
  const { t } = useTranslation();
  const { folders, credentials, refreshVaultData, openSessionTab } = useAppStore();

  const reusableCredentials = credentials.filter((c) => c.reusable);
  const existingLinkedCred = session?.credential_id
    ? credentials.find((c) => c.id === session.credential_id) ?? null
    : null;
  const editingPrivateCred =
    existingLinkedCred && !existingLinkedCred.reusable ? existingLinkedCred : null;

  const initialAuthMode: SessionAuthMode = existingLinkedCred
    ? existingLinkedCred.reusable
      ? "reusable"
      : "manual"
    : mode === "create" || mode === "quick"
    ? "manual"
    : "none";

  const [name, setName] = useState(session?.name ?? "");
  const [folderId, setFolderId] = useState<string>(
    session?.folder_id ?? initialFolderId ?? ""
  );
  const [protocol, setProtocol] = useState<Protocol>(session?.protocol ?? "sftp");
  const [host, setHost] = useState(session?.host ?? "");
  const [port, setPort] = useState<number>(
    session?.port ?? defaultPortForProtocol(session?.protocol ?? "sftp")
  );

  // Auth state
  const [authMode, setAuthMode] = useState<SessionAuthMode>(initialAuthMode);
  const [credentialId, setCredentialId] = useState<string>(
    existingLinkedCred?.reusable ? existingLinkedCred.id : ""
  );
  const [manualUsername, setManualUsername] = useState(
    editingPrivateCred ? editingPrivateCred.username : ""
  );
  const [manualAuthType, setManualAuthType] = useState<AuthType>(
    editingPrivateCred ? editingPrivateCred.auth_type : "password"
  );
  const [manualPassword, setManualPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState<boolean>(
    editingPrivateCred ? editingPrivateCred.has_secret : true
  );
  const [manualPrivateKey, setManualPrivateKey] = useState("");
  const [manualPassphrase, setManualPassphrase] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [promotedNotice, setPromotedNotice] = useState<string | null>(null);

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

  const handleLoadKeyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setManualPrivateKey(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handlePromoteToReusable = async () => {
    setError(null);
    setPromotedNotice(null);
    setPromoting(true);
    try {
      const alias =
        name.trim() ||
        (manualUsername.trim() && host.trim()
          ? `${manualUsername.trim()}@${host.trim()}`
          : manualUsername.trim() || host.trim() || "Credential");

      const keepExisting =
        !!editingPrivateCred &&
        editingPrivateCred.auth_type === manualAuthType &&
        ((manualAuthType === "password" && rememberPassword && !manualPassword) ||
          (manualAuthType === "ssh_key" && !manualPrivateKey && !manualPassphrase));

      const credPayload = {
        name: alias,
        username: manualUsername.trim(),
        auth_type: manualAuthType,
        password:
          manualAuthType === "password" && rememberPassword
            ? manualPassword
            : undefined,
        private_key: manualAuthType === "ssh_key" ? manualPrivateKey : undefined,
        passphrase: manualAuthType === "ssh_key" ? manualPassphrase : undefined,
        keep_existing_secret: keepExisting,
        reusable: true,
      };

      const savedCred = editingPrivateCred
        ? await api.updateCredential(editingPrivateCred.id, credPayload)
        : await api.createCredential(credPayload);

      await refreshVaultData();
      setCredentialId(savedCred.id);
      setAuthMode("reusable");
      setPromotedNotice(t("session.promoted_success"));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setPromoting(false);
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
        credential_id: authMode === "reusable" ? credentialId || null : null,
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
      openSessionTab(
        tempSession,
        authMode === "manual" && manualUsername.trim()
          ? { username: manualUsername.trim(), password: manualPassword }
          : undefined
      );
      onClose();
      return;
    }

    setSaving(true);
    try {
      let finalCredentialId: string | null = null;
      const oldPrivateCredId = editingPrivateCred ? editingPrivateCred.id : null;

      if (authMode === "reusable") {
        finalCredentialId = credentialId || null;
      } else if (authMode === "manual") {
        const keepExisting =
          !!editingPrivateCred &&
          editingPrivateCred.auth_type === manualAuthType &&
          ((manualAuthType === "password" &&
            rememberPassword &&
            !manualPassword) ||
            (manualAuthType === "ssh_key" &&
              !manualPrivateKey &&
              !manualPassphrase));

        const credPayload = {
          name: `[session] ${name.trim() || host.trim()}`,
          username: manualUsername.trim(),
          auth_type: manualAuthType,
          password:
            manualAuthType === "password" && rememberPassword
              ? manualPassword
              : undefined,
          private_key: manualAuthType === "ssh_key" ? manualPrivateKey : undefined,
          passphrase: manualAuthType === "ssh_key" ? manualPassphrase : undefined,
          keep_existing_secret: keepExisting,
          reusable: false,
        };

        if (oldPrivateCredId) {
          const updated = await api.updateCredential(oldPrivateCredId, credPayload);
          finalCredentialId = updated.id;
        } else {
          const created = await api.createCredential(credPayload);
          finalCredentialId = created.id;
        }
      }

      const input = {
        folder_id: folderId || null,
        credential_id: finalCredentialId,
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

      // Clean up replaced private credential if user switched away from it
      if (oldPrivateCredId && oldPrivateCredId !== finalCredentialId) {
        await api.deleteCredential(oldPrivateCredId).catch(() => {});
      }

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
      <div className="w-full max-w-xl max-h-[90vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
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

        <form
          onSubmit={(e) => handleSubmit(e, mode === "quick")}
          className="p-6 space-y-4 overflow-y-auto"
        >
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

          {/* Authentication Section */}
          <div className="space-y-3 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {t("session.credential")}
              </label>
              <div className="flex items-center gap-1.5">
                <div className="inline-flex rounded-lg bg-zinc-200/70 dark:bg-zinc-800 p-0.5 text-[11px]">
                  {(["manual", "reusable", "none"] as SessionAuthMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setAuthMode(m);
                        setPromotedNotice(null);
                      }}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                        authMode === m
                          ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                          : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      }`}
                    >
                      {t(`session.auth_mode_${m}`)}
                    </button>
                  ))}
                </div>

                {/* Icon-only button with hover tooltip to promote manual -> reusable */}
                {authMode === "manual" && mode !== "quick" && (
                  <div className="relative group">
                    <button
                      type="button"
                      disabled={promoting}
                      onClick={handlePromoteToReusable}
                      aria-label={t("session.promote_to_reusable_tooltip")}
                      className="p-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 text-zinc-600 dark:text-zinc-300 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                    <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute right-0 top-full mt-1.5 z-20 whitespace-nowrap rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-[11px] font-medium px-2 py-1 shadow-lg">
                      {t("session.promote_to_reusable_tooltip")}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {promotedNotice && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                {promotedNotice}
              </div>
            )}

            {authMode === "reusable" && (
              <select
                value={credentialId}
                onChange={(e) => setCredentialId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t("session.credential_select_placeholder")}</option>
                {reusableCredentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.username || "—"})
                  </option>
                ))}
              </select>
            )}

            {authMode === "none" && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("session.credential_none")}
              </p>
            )}

            {authMode === "manual" && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {t("credentials.username")}
                    </label>
                    <input
                      type="text"
                      value={manualUsername}
                      onChange={(e) => setManualUsername(e.target.value)}
                      placeholder={t("credentials.username_placeholder")}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {t("credentials.auth_type")}
                    </label>
                    <select
                      value={manualAuthType}
                      onChange={(e) => setManualAuthType(e.target.value as AuthType)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="password">{t("credentials.type_password")}</option>
                      <option value="ssh_key">{t("credentials.type_ssh_key")}</option>
                      <option value="ssh_agent">{t("credentials.type_ssh_agent")}</option>
                    </select>
                  </div>
                </div>

                {manualAuthType === "password" && (
                  <div className="space-y-2">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {t("credentials.password")}
                        </label>
                        {editingPrivateCred?.has_secret && rememberPassword && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            {t("session.password_saved_badge")}
                          </span>
                        )}
                      </div>
                      <input
                        type="password"
                        disabled={mode !== "quick" && !rememberPassword}
                        value={manualPassword}
                        onChange={(e) => setManualPassword(e.target.value)}
                        placeholder={
                          editingPrivateCred?.has_secret && rememberPassword
                            ? `•••••••• (${t("credentials.keep_secret_hint")})`
                            : ""
                        }
                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    {mode !== "quick" && (
                      <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rememberPassword}
                          onChange={(e) => {
                            setRememberPassword(e.target.checked);
                            if (!e.target.checked) setManualPassword("");
                          }}
                          className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        {t("session.remember_password")}
                      </label>
                    )}
                  </div>
                )}

                {manualAuthType === "ssh_key" && (
                  <div className="space-y-2.5">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {t("credentials.private_key")}
                        </label>
                        <label className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          {t("credentials.load_key_file")}
                          <input
                            type="file"
                            onChange={handleLoadKeyFile}
                            className="hidden"
                          />
                        </label>
                      </div>
                      <textarea
                        rows={3}
                        value={manualPrivateKey}
                        onChange={(e) => setManualPrivateKey(e.target.value)}
                        placeholder={
                          editingPrivateCred?.has_secret
                            ? t("credentials.keep_secret_hint")
                            : "-----BEGIN OPENSSH PRIVATE KEY-----"
                        }
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        {t("credentials.passphrase")}
                      </label>
                      <input
                        type="password"
                        value={manualPassphrase}
                        onChange={(e) => setManualPassphrase(e.target.value)}
                        placeholder={
                          editingPrivateCred?.has_passphrase
                            ? t("credentials.keep_secret_hint")
                            : ""
                        }
                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
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
