import { Check } from "lucide-react";

export interface ColorSwatch {
  id: string;
  hex: string;
  label: string;
}

export const ICON_COLOR_SWATCHES: ColorSwatch[] = [
  { id: "#38bdf8", hex: "#38bdf8", label: "Sky" },
  { id: "#6366f1", hex: "#6366f1", label: "Indigo" },
  { id: "#a855f7", hex: "#a855f7", label: "Purple" },
  { id: "#ec4899", hex: "#ec4899", label: "Pink" },
  { id: "#ef4444", hex: "#ef4444", label: "Red" },
  { id: "#f97316", hex: "#f97316", label: "Orange" },
  { id: "#f59e0b", hex: "#f59e0b", label: "Amber" },
  { id: "#10b981", hex: "#10b981", label: "Emerald" },
  { id: "#14b8a6", hex: "#14b8a6", label: "Teal" },
  { id: "#71717a", hex: "#71717a", label: "Zinc" },
];

export function resolveIconColor(
  customColor: string | null | undefined,
  fallbackHex: string
): string {
  return customColor && customColor.trim() ? customColor : fallbackHex;
}

interface IconColorPickerProps {
  value: string | null | undefined;
  defaultHex: string;
  onChange: (hex: string | null) => void;
  compact?: boolean;
}

export function IconColorPicker({
  value,
  defaultHex,
  onChange,
  compact = false,
}: IconColorPickerProps) {
  const activeHex = resolveIconColor(value, defaultHex);

  return (
    <div className={`flex flex-wrap items-center ${compact ? "gap-1" : "gap-1.5"}`}>
      {ICON_COLOR_SWATCHES.map((swatch) => {
        const selected = activeHex.toLowerCase() === swatch.hex.toLowerCase();
        return (
          <button
            key={swatch.id}
            type="button"
            title={swatch.label}
            onClick={() => onChange(swatch.hex)}
            style={{ backgroundColor: swatch.hex }}
            className={`${
              compact ? "w-4 h-4 rounded" : "w-5 h-5 rounded-md"
            } flex items-center justify-center transition-transform cursor-pointer ${
              selected
                ? "ring-2 ring-offset-1 ring-zinc-900 dark:ring-white dark:ring-offset-zinc-900 scale-110"
                : "hover:scale-110 opacity-85 hover:opacity-100"
            }`}
          >
            {selected && (
              <Check className="w-3 h-3 text-white drop-shadow-xs stroke-[3]" />
            )}
          </button>
        );
      })}
    </div>
  );
}
