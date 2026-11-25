import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, AlertTriangle, Shield } from "lucide-react";
import { formatBytesWithExact } from "../utils/format";
import type { FileEntry } from "../types";

// --- Text Prompt Modal (New Folder / Rename) ---

interface TextPromptModalProps {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  selectStem?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function TextPromptModal({
  title,
  label,
  initialValue = "",
  confirmLabel,
  selectStem = false,
  onConfirm,
  onCancel,
}: TextPromptModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (selectStem && initialValue.includes(".")) {
      const dotIdx = initialValue.lastIndexOf(".");
      input.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialValue.length);
    } else {
      input.select();
    }
  }, [initialValue, selectStem]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {label}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {t("app.cancel")}
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer"
            >
              {confirmLabel ?? t("app.confirm")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Confirm Delete Modal ---

interface ConfirmDeleteModalProps {
  entries: FileEntry[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteModal({
  entries,
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("workspace.confirm_delete_title")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-zinc-700 dark:text-zinc-300">
            {entries.length === 1
              ? t("workspace.confirm_delete", { name: entries[0].name })
              : t("workspace.confirm_delete_many", { count: entries.length })}
          </p>

          {entries.length > 1 && (
            <div className="max-h-32 overflow-y-auto p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 font-mono text-[11px] text-zinc-600 dark:text-zinc-400 space-y-0.5">
              {entries.slice(0, 20).map((e) => (
                <div key={e.path} className="truncate">
                  {e.name}
                </div>
              ))}
              {entries.length > 20 && (
                <div className="text-zinc-400">+{entries.length - 20} ...</div>
              )}
            </div>
          )}

          <p className="text-[11px] text-red-600 dark:text-red-400">
            {t("workspace.delete_warning")}
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              autoFocus
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {t("app.cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white cursor-pointer"
            >
              {t("app.delete")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Generic Confirm Modal (for Sidebar folders/sessions & Credentials) ---

interface ConfirmActionModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
  onCheckboxChange?: (checked: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionModal({
  title,
  message,
  confirmLabel,
  danger = true,
  checkboxLabel,
  checkboxChecked = false,
  onCheckboxChange,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {danger && <AlertTriangle className="w-4 h-4 text-red-500" />}
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
            {message}
          </p>

          {checkboxLabel && onCheckboxChange && (
            <label className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 cursor-pointer">
              <input
                type="checkbox"
                checked={checkboxChecked}
                onChange={(e) => onCheckboxChange(e.target.checked)}
                className="rounded border-zinc-300 text-red-600 focus:ring-red-500"
              />
              {checkboxLabel}
            </label>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              autoFocus
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {t("app.cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg text-white cursor-pointer ${
                danger
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              {confirmLabel ?? t("app.delete")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Properties & Chmod Modal ---

interface PropertiesModalProps {
  entry: FileEntry;
  isRemote: boolean;
  onApplyChmod?: (mode: number) => Promise<void>;
  onClose: () => void;
}

export function PropertiesModal({
  entry,
  isRemote,
  onApplyChmod,
  onClose,
}: PropertiesModalProps) {
  const { t } = useTranslation();
  const initialMode = entry.mode ?? (entry.is_dir ? 0o755 : 0o644);
  const [mode, setMode] = useState<number>(initialMode & 0o777);
  const [octalText, setOctalText] = useState<string>(
    (initialMode & 0o777).toString(8).padStart(3, "0")
  );
  const [saving, setSaving] = useState(false);

  const toggleBit = (bit: number) => {
    const next = mode ^ bit;
    setMode(next);
    setOctalText(next.toString(8).padStart(3, "0"));
  };

  const handleOctalChange = (val: string) => {
    const cleaned = val.replace(/[^0-7]/g, "").slice(0, 4);
    setOctalText(cleaned);
    if (cleaned.length >= 3) {
      const parsed = parseInt(cleaned, 8);
      if (!Number.isNaN(parsed)) {
        setMode(parsed & 0o7777);
      }
    }
  };

  const handleSave = async () => {
    if (!onApplyChmod) return;
    setSaving(true);
    try {
      await onApplyChmod(mode);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const bitGroups = [
    { label: t("workspace.props_owner_col"), r: 0o400, w: 0o200, x: 0o100 },
    { label: t("workspace.props_group_col"), r: 0o040, w: 0o020, x: 0o010 },
    { label: t("workspace.props_others_col"), r: 0o004, w: 0o002, x: 0o001 },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("workspace.props_title")} — {entry.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="space-y-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500 shrink-0">{t("workspace.props_type")}:</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {entry.is_symlink
                  ? t("workspace.props_type_symlink")
                  : entry.is_dir
                  ? t("workspace.props_type_dir")
                  : t("workspace.props_type_file")}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500 shrink-0">{t("workspace.props_path")}:</span>
              <span className="font-mono text-[11px] text-zinc-800 dark:text-zinc-200 break-all text-right">
                {entry.path}
              </span>
            </div>
            {!entry.is_dir && (
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500 shrink-0">{t("workspace.col_size")}:</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200">
                  {formatBytesWithExact(entry.size)}
                </span>
              </div>
            )}
            {entry.modified && (
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500 shrink-0">{t("workspace.col_modified")}:</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200">
                  {entry.modified}
                </span>
              </div>
            )}
            {entry.owner && (
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500 shrink-0">{t("workspace.props_owner")}:</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200">
                  {entry.owner}
                </span>
              </div>
            )}
          </div>

          {isRemote && onApplyChmod && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {t("workspace.props_chmod_section")}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {bitGroups.map((g) => (
                  <div
                    key={g.label}
                    className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50 space-y-1.5"
                  >
                    <div className="font-medium text-[11px] text-zinc-600 dark:text-zinc-400">
                      {g.label}
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(mode & g.r) !== 0}
                        onChange={() => toggleBit(g.r)}
                        className="rounded border-zinc-300 text-indigo-600"
                      />
                      <span>{t("workspace.props_read")}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(mode & g.w) !== 0}
                        onChange={() => toggleBit(g.w)}
                        className="rounded border-zinc-300 text-indigo-600"
                      />
                      <span>{t("workspace.props_write")}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(mode & g.x) !== 0}
                        onChange={() => toggleBit(g.x)}
                        className="rounded border-zinc-300 text-indigo-600"
                      />
                      <span>{t("workspace.props_exec")}</span>
                    </label>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {t("workspace.props_octal")}
                </label>
                <input
                  type="text"
                  value={octalText}
                  onChange={(e) => handleOctalChange(e.target.value)}
                  className="w-24 px-2.5 py-1.5 text-center font-mono text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {t("app.close")}
            </button>
            {isRemote && onApplyChmod && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer"
              >
                {t("app.save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
