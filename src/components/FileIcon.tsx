import {
  Folder,
  Link2,
  File,
  FileCode2,
  FileImage,
  FileArchive,
  FileAudio,
  FileVideo,
  FileText,
  FileSpreadsheet,
  FileJson,
  FileTerminal,
} from "lucide-react";
import type { FileEntry } from "../types";

const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "java", "c", "cpp",
  "h", "hpp", "cs", "php", "rb", "swift", "kt", "html", "htm", "css", "scss",
  "less", "vue", "svelte", "sql", "xml", "yaml", "yml", "toml", "ini",
]);
const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff", "avif",
]);
const ARCHIVE_EXTS = new Set([
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst",
]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"]);
const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "webm", "wmv"]);
const TEXT_EXTS = new Set(["txt", "md", "log", "rtf", "pdf", "doc", "docx"]);
const SHEET_EXTS = new Set(["csv", "xls", "xlsx", "ods"]);
const SHELL_EXTS = new Set(["sh", "bash", "zsh", "ps1", "bat", "cmd"]);

export function FileIcon({ entry }: { entry: FileEntry }) {
  if (entry.is_symlink) {
    return <Link2 className="w-3.5 h-3.5 text-cyan-500 shrink-0" />;
  }
  if (entry.is_dir) {
    return <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  }

  const ext = entry.name.includes(".")
    ? entry.name.split(".").pop()?.toLowerCase() ?? ""
    : "";

  if (ext === "json" || ext === "jsonc") {
    return <FileJson className="w-3.5 h-3.5 text-yellow-500 shrink-0" />;
  }
  if (CODE_EXTS.has(ext)) {
    return <FileCode2 className="w-3.5 h-3.5 text-sky-500 shrink-0" />;
  }
  if (SHELL_EXTS.has(ext)) {
    return <FileTerminal className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  }
  if (IMAGE_EXTS.has(ext)) {
    return <FileImage className="w-3.5 h-3.5 text-purple-500 shrink-0" />;
  }
  if (ARCHIVE_EXTS.has(ext)) {
    return <FileArchive className="w-3.5 h-3.5 text-orange-500 shrink-0" />;
  }
  if (AUDIO_EXTS.has(ext)) {
    return <FileAudio className="w-3.5 h-3.5 text-pink-500 shrink-0" />;
  }
  if (VIDEO_EXTS.has(ext)) {
    return <FileVideo className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
  }
  if (SHEET_EXTS.has(ext)) {
    return <FileSpreadsheet className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />;
  }
  if (TEXT_EXTS.has(ext)) {
    return <FileText className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />;
  }
  return <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
}
