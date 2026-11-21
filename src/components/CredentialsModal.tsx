import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Plus, Pencil, Trash2, Upload, X, ShieldCheck } from "lucide-react";
import { api } from "../services/tauri";
import { useAppStore } from "../store/useAppStore";
import { extractErrorMessage, type AuthType, type CredentialSummary } from "../types";

interface CredentialsModalProps {
  onClose: () => void;
}

export function CredentialsModal({ onClose }: CredentialsModalProps) {
  const { t } = useTranslation();
  const { credentials: allCredentials, refreshVaultData } = useAppStore();
  const credentials = allCredentials.filter((c) => c.reusable);

  const [editing, setEditing] = useState<CredentialSummary | null>(null);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<AuthType>("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startCreate = () => {
    setEditing(null);
    setCreating(true);
    setName("");
    setUsername("");
    setAuthType("password");
    setPassword("");
    setPrivateKey("");
    setPassphrase("");
    setError(null);
  };

  const startEdit = (cred: CredentialSummary) => {
    setCreating(false);
    setEditing(cred);
    setName(cred.name);
    setUsername(cred.username);
    setAuthType(cred.auth_type);
    setPassword("");
    setPrivateKey("");
    setPassphrase("");
    setError(null);
  };

  const handleLoadKeyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPrivateKey(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const keepExisting =
        !!editing &&
        editing.auth_type === authType &&
        ((authType === "password" && !password) ||
          (authType === "ssh_key" && !privateKey && !passphrase));

      const payload = {
        name,
        username,
        auth_type: authType,
        password: authType === "password" ? password : undefined,
        private_key: authType === "ssh_key" ? privateKey : undefined,
        passphrase: authType === "ssh_key" ? passphrase : undefined,
        keep_existing_secret: keepExisting,
      };

      if (editing) {
        await api.updateCredential(editing.id, payload);
      } else {
        await api.createCredential(payload);
      }
      await refreshVaultData();
      setEditing(null);
      setCreating(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cred: CredentialSummary) => {
    if (!window.confirm(t("credentials.confirm_delete", { name: cred.name }))) return;
    await api.deleteCredential(cred.id);
    if (editing?.id === cred.id) {
      setEditing(null);
    }
    await refreshVaultData();
  };

  const showForm = creating || !!editing;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[85vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {t("credentials.title")}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("credentials.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!showForm ? (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={startCreate}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t("credentials.new")}
                </button>
              </div>

              {credentials.length === 0 ? (
                <div className="text-center py-12 text-sm text-zinc-500 dark:text-zinc-400">
                  {t("credentials.empty")}
                </div>
              ) : (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  {credentials.map((cred) => (
                    <div
                      key={cred.id}
                      className="px-4 py-3 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                            {cred.name}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                            {t(`credentials.type_${cred.auth_type}`)}
                          </span>
                          {cred.has_secret && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                              <ShieldCheck className="w-3 h-3" />
                              {t("credentials.has_secret")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {t("credentials.username")}:{" "}
                          <span className="font-mono">{cred.username || "—"}</span>
                          {cred.has_passphrase && ` • ${t("credentials.has_passphrase")}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(cred)}
                          className="p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                          title={t("app.edit")}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(cred)}
                          className="p-2 rounded-lg hover:bg-red-500/15 text-red-600 dark:text-red-400 cursor-pointer"
                          title={t("app.delete")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {editing ? t("credentials.edit") : t("credentials.new")}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t("credentials.name")} *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("credentials.name_placeholder")}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t("credentials.username")}
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t("credentials.username_placeholder")}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("credentials.auth_type")}
                </label>
                <select
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as AuthType)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="password">{t("credentials.type_password")}</option>
                  <option value="ssh_key">{t("credentials.type_ssh_key")}</option>
                  <option value="ssh_agent">{t("credentials.type_ssh_agent")}</option>
                </select>
              </div>

              {authType === "password" && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t("credentials.password")}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editing ? t("credentials.keep_secret_hint") : ""}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              {authType === "ssh_key" && (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {t("credentials.private_key")}
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
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
                      rows={5}
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      placeholder={
                        editing
                          ? t("credentials.keep_secret_hint")
                          : "-----BEGIN OPENSSH PRIVATE KEY-----"
                      }
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      {t("credentials.passphrase")}
                    </label>
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder={editing ? t("credentials.keep_secret_hint") : ""}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
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
                  onClick={() => {
                    setEditing(null);
                    setCreating(false);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  {t("app.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer"
                >
                  {t("app.save")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
