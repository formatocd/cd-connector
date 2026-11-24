import { useId } from "react";
import type { CSSProperties } from "react";

interface TerminalSolidIconProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Solid inverted terminal icon: filled rounded terminal badge with `>_` knocked out.
 */
export function TerminalSolidIcon({ className = "w-4 h-4", style }: TerminalSolidIconProps) {
  const maskId = `term-solid-${useId()}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId}>
          <rect x="2" y="3" width="20" height="18" rx="4" fill="white" />
          <path
            d="M7 9l4 3-4 3"
            stroke="black"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12.5 15.5h4.5"
            stroke="black"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </mask>
      </defs>
      <rect
        x="2"
        y="3"
        width="20"
        height="18"
        rx="4"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
