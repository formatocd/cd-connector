import { useTranslation } from "react-i18next";
import { ShieldAlert, ShieldQuestion, X } from "lucide-react";
import type { HostKeyPromptInfo } from "../types";

interface HostKeyModalProps {
  info: HostKeyPromptInfo;
  onTrust: () => void;
  onCancel: () => void;
}

export function HostKeyModal({ info, onTrust, onCancel }: HostKeyModalProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {info.mismatch ? (
              <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400" />
            ) : (
              <ShieldQuestion className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            )}
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {info.mismatch ? t("host_key.title_mismatch") : t("host_key.title_new")}
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

        <div className="p-6 space-y-4">
          <p
            className={`text-xs leading-relaxed ${
              info.mismatch
                ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3 rounded-lg"
                : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {info.mismatch
              ? t("host_key.desc_mismatch", { host: info.host, port: info.port })
              : t("host_key.desc_new", { host: info.host, port: info.port })}
          </p>

          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs">
            <div>
              <span className="text-zinc-500">{t("host_key.algorithm")}: </span>
              <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                {info.key_type}
              </span>
            </div>
            <div>
              <div className="text-zinc-500 mb-0.5">{t("host_key.fingerprint")}:</div>
              <div className="font-mono text-[11px] break-all p-2 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100">
                {info.fingerprint}
              </div>
            </div>
            {info.previous_fingerprint && (
              <div>
                <div className="text-zinc-500 mb-0.5">
                  {t("host_key.previous_fingerprint")}:
                </div>
                <div className="font-mono text-[11px] break-all p-2 rounded bg-red-50/50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300">
                  {info.previous_fingerprint}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {t("app.cancel")}
            </button>
            <button
              type="button"
              onClick={onTrust}
              className={`px-4 py-2 text-xs font-medium rounded-lg text-white cursor-pointer ${
                info.mismatch
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              {t("host_key.trust_button")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
