import {
  Folder,
  Link2,
  File,
  FileImage,
  FileArchive,
  FileAudio,
  FileVideo,
  FileText,
  FileSpreadsheet,
  FileTerminal,
  Database,
  KeyRound,
  Lock,
  Settings,
  GitBranch,
  Container,
  FileCode2,
} from "lucide-react";
import type { FileEntry } from "../types";

interface BadgeSpec {
  label: string;
  bg: string;
  fg: string;
}

const EXT_BADGES: Record<string, BadgeSpec> = {
  // Web & JS/TS
  js: { label: "JS", bg: "#f7df1e", fg: "#18181b" },
  mjs: { label: "JS", bg: "#f7df1e", fg: "#18181b" },
  cjs: { label: "JS", bg: "#f7df1e", fg: "#18181b" },
  ts: { label: "TS", bg: "#3178c6", fg: "#ffffff" },
  mts: { label: "TS", bg: "#3178c6", fg: "#ffffff" },
  cts: { label: "TS", bg: "#3178c6", fg: "#ffffff" },
  jsx: { label: "JX", bg: "#0ea5e9", fg: "#ffffff" },
  tsx: { label: "TX", bg: "#0284c7", fg: "#ffffff" },
  vue: { label: "V", bg: "#41b883", fg: "#ffffff" },
  svelte: { label: "S", bg: "#ff3e00", fg: "#ffffff" },
  html: { label: "<>", bg: "#e34f26", fg: "#ffffff" },
  htm: { label: "<>", bg: "#e34f26", fg: "#ffffff" },
  css: { label: "#", bg: "#264de4", fg: "#ffffff" },
  scss: { label: "S", bg: "#cd6799", fg: "#ffffff" },
  sass: { label: "S", bg: "#cd6799", fg: "#ffffff" },
  less: { label: "L", bg: "#1d365d", fg: "#ffffff" },

  // Backend & Systems
  rs: { label: "RS", bg: "#dea584", fg: "#18181b" },
  py: { label: "PY", bg: "#3776ab", fg: "#ffd43b" },
  go: { label: "GO", bg: "#00add8", fg: "#ffffff" },
  php: { label: "PHP", bg: "#777bb4", fg: "#ffffff" },
  rb: { label: "RB", bg: "#cc342d", fg: "#ffffff" },
  java: { label: "JV", bg: "#f89820", fg: "#18181b" },
  kt: { label: "KT", bg: "#7f52ff", fg: "#ffffff" },
  cs: { label: "C#", bg: "#68217a", fg: "#ffffff" },
  c: { label: "C", bg: "#5c6bc0", fg: "#ffffff" },
  h: { label: "H", bg: "#7e57c2", fg: "#ffffff" },
  cpp: { label: "C+", bg: "#00599c", fg: "#ffffff" },
  hpp: { label: "H+", bg: "#7e57c2", fg: "#ffffff" },
  swift: { label: "SW", bg: "#f05138", fg: "#ffffff" },

  // Data & Config
  json: { label: "{}", bg: "#eab308", fg: "#18181b" },
  jsonc: { label: "{}", bg: "#eab308", fg: "#18181b" },
  yaml: { label: "YM", bg: "#cb171e", fg: "#ffffff" },
  yml: { label: "YM", bg: "#cb171e", fg: "#ffffff" },
  toml: { label: "TM", bg: "#9c4121", fg: "#ffffff" },
  xml: { label: "XM", bg: "#f97316", fg: "#ffffff" },
  md: { label: "M↓", bg: "#38bdf8", fg: "#0f172a" },
  mdx: { label: "M↓", bg: "#f59e0b", fg: "#0f172a" },

  // Documents
  pdf: { label: "PDF", bg: "#dc2626", fg: "#ffffff" },
  doc: { label: "W", bg: "#2563eb", fg: "#ffffff" },
  docx: { label: "W", bg: "#2563eb", fg: "#ffffff" },
  xls: { label: "X", bg: "#16a34a", fg: "#ffffff" },
  xlsx: { label: "X", bg: "#16a34a", fg: "#ffffff" },
  ppt: { label: "P", bg: "#ea580c", fg: "#ffffff" },
  pptx: { label: "P", bg: "#ea580c", fg: "#ffffff" },
  svg: { label: "SVG", bg: "#f59e0b", fg: "#18181b" },
};

const FOLDER_COLORS: Record<string, string> = {
  src: "text-emerald-500",
  components: "text-sky-500",
  docs: "text-blue-500",
  dist: "text-orange-500",
  build: "text-orange-500",
  target: "text-orange-500",
  public: "text-teal-500",
  assets: "text-purple-500",
  images: "text-purple-500",
  img: "text-purple-500",
  tests: "text-pink-500",
  test: "text-pink-500",
  node_modules: "text-lime-600 dark:text-lime-500",
  ".git": "text-red-500",
  ".github": "text-zinc-500 dark:text-zinc-400",
  ".vscode": "text-blue-500",
  config: "text-cyan-500",
  scripts: "text-emerald-600",
};

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "avif"]);
const ARCHIVE_EXTS = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"]);
const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "webm", "wmv"]);
const SHELL_EXTS = new Set(["sh", "bash", "zsh", "ps1", "bat", "cmd"]);
const DB_EXTS = new Set(["sql", "db", "sqlite", "sqlite3", "mdb"]);
const KEY_EXTS = new Set(["pem", "key", "pub", "crt", "cer", "p12", "pfx", "ppk"]);
const CONFIG_EXTS = new Set(["ini", "cfg", "conf", "env", "properties", "htaccess"]);
const TEXT_EXTS = new Set(["txt", "log", "rtf", "license"]);

function ExtBadge({ spec }: { spec: BadgeSpec }) {
  const fontSize = spec.label.length >= 3 ? "5.8" : "7.2";
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5 shrink-0"
      aria-hidden="true"
    >
      <rect x="0.5" y="1.5" width="15" height="13" rx="3" fill={spec.bg} />
      <text
        x="8"
        y="10.6"
        textAnchor="middle"
        fill={spec.fg}
        fontSize={fontSize}
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {spec.label}
      </text>
    </svg>
  );
}

export function FileIcon({ entry }: { entry: FileEntry }) {
  if (entry.is_symlink) {
    return <Link2 className="w-3.5 h-3.5 text-cyan-500 shrink-0" />;
  }

  const lowerName = entry.name.toLowerCase();

  if (entry.is_dir) {
    const color = FOLDER_COLORS[lowerName] ?? "text-amber-500";
    return <Folder className={`w-3.5 h-3.5 shrink-0 ${color}`} />;
  }

  // Special filenames (Material Icon Theme conventions)
  if (lowerName === "dockerfile" || lowerName.startsWith("docker-compose")) {
    return <Container className="w-3.5 h-3.5 text-sky-500 shrink-0" />;
  }
  if (lowerName.startsWith(".git")) {
    return <GitBranch className="w-3.5 h-3.5 text-orange-500 shrink-0" />;
  }
  if (lowerName === ".env" || lowerName.startsWith(".env.")) {
    return <KeyRound className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  }
  if (
    lowerName.endsWith(".lock") ||
    lowerName === "package-lock.json" ||
    lowerName === "pnpm-lock.yaml" ||
    lowerName === "cargo.lock"
  ) {
    return <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />;
  }
  if (lowerName === "license" || lowerName === "license.md" || lowerName === "license.txt") {
    return <FileText className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  }

  const ext = lowerName.includes(".") ? lowerName.split(".").pop() ?? "" : "";

  if (ext && EXT_BADGES[ext]) {
    return <ExtBadge spec={EXT_BADGES[ext]} />;
  }
  if (ext === "csv" || ext === "ods") {
    return <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  }
  if (SHELL_EXTS.has(ext)) {
    return <FileTerminal className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  }
  if (DB_EXTS.has(ext)) {
    return <Database className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  }
  if (KEY_EXTS.has(ext)) {
    return <KeyRound className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  }
  if (CONFIG_EXTS.has(ext)) {
    return <Settings className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />;
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
  if (TEXT_EXTS.has(ext)) {
    return <FileText className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />;
  }
  if (ext === "map" || ext === "wasm") {
    return <FileCode2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
  }

  return <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
}
