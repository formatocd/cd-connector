import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, X } from "lucide-react";
import { isFtpLike } from "../utils/protocols";
import type { Protocol } from "../types";

interface AuthPromptModalProps {
  host: string;
  port: number;
  protocol: Protocol;
  initialUsername?: string;
  onSubmit: (username: string, password: string) => void;
  onCancel: () => void;
}

export function AuthPromptModal({
  host,
  port,
  protocol,
  initialUsername = "",
  onSubmit,
  onCancel,
}: AuthPromptModalProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");

  const ftpLike = isFtpLike(protocol);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(username.trim(), password);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("auth_prompt.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {t("auth_prompt.subtitle", { host, port })}
          </p>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t("credentials.username")}
            </label>
            <input
              type="text"
              required
              autoFocus={!initialUsername}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t("credentials.password")}
            </label>
            <input
              type="password"
              autoFocus={!!initialUsername}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            {ftpLike ? (
              <button
                type="button"
                onClick={() => onSubmit("anonymous", "anonymous@cd-remote")}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                {t("auth_prompt.anonymous_button")}
              </button>
            ) : (
              <span />
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {t("app.cancel")}
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
              >
                {t("sidebar.connect")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
