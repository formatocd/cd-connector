import { useId } from "react";

interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className = "w-12 h-12" }: AppLogoProps) {
  const uid = useId();
  const bgId = `cd-bg-${uid}`;
  const discId = `cd-disc-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={className}
      aria-label="CD Remote"
    >
      <defs>
        <linearGradient id={bgId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id={discId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={`url(#${bgId})`} />
      <circle
        cx="256"
        cy="256"
        r="168"
        fill="none"
        stroke={`url(#${discId})`}
        strokeWidth="34"
        opacity="0.95"
      />
      <circle
        cx="256"
        cy="256"
        r="52"
        fill="#0f172a"
        stroke="#e2e8f0"
        strokeWidth="14"
      />
      <path
        d="M168 220 L316 220 L282 186"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M344 292 L196 292 L230 326"
        fill="none"
        stroke="#c084fc"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
