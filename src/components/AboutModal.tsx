import { useTranslation } from "react-i18next";
import { X, ExternalLink, Keyboard } from "lucide-react";
import { AppLogo } from "./AppLogo";

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  const { t } = useTranslation();

  const shortcuts = [
    { keys: "Ctrl + B", desc: t("about.sc_sidebar") },
    { keys: "Ctrl + 1", desc: t("about.sc_local") },
    { keys: "Ctrl + 2", desc: t("about.sc_console") },
    { keys: "Ctrl + 3", desc: t("about.sc_queue") },
    { keys: "Ctrl + Shift + C / V", desc: t("about.sc_terminal_cp") },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AppLogo className="w-9 h-9 rounded-xl shadow-xs shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("about.title")}
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {t("app.subtitle")}
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

        <div className="p-6 space-y-5 text-xs">
          <div className="space-y-2 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">{t("about.version")}</span>
              <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                v1.0.0
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">{t("about.author")}</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                Carlos Durán (formatocd)
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">{t("about.license")}</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                MIT License
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">{t("about.protocols")}</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                FTP, FTPS, SFTP, SSH
              </span>
            </div>
            <div className="flex justify-between items-center gap-3 pt-1 border-t border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-500">{t("about.repository")}</span>
              <a
                href="https://github.com/formatocd/cd-connector"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline font-mono"
              >
                formatocd/cd-connector
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              <Keyboard className="w-3.5 h-3.5" />
              {t("about.shortcuts_title")}
            </div>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
              {shortcuts.map((s) => (
                <div
                  key={s.keys}
                  className="px-3 py-1.5 flex items-center justify-between gap-2 bg-zinc-50/50 dark:bg-zinc-950/50"
                >
                  <span className="text-zinc-600 dark:text-zinc-400">{s.desc}</span>
                  <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
            >
              {t("app.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
