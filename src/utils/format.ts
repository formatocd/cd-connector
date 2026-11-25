const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  return `${(bytes / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1)} ${BYTE_UNITS[idx]}`;
}

export function formatBytesWithExact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  return `${formatBytes(bytes)} (${Math.floor(bytes).toLocaleString()} B)`;
}
