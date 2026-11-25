import type { Protocol } from "../types";

export const PROTOCOLS: readonly Protocol[] = [
  "ftp",
  "ftps_explicit",
  "ftps_implicit",
  "sftp",
  "ssh",
] as const;

export function isProtocol(value: unknown): value is Protocol {
  return typeof value === "string" && (PROTOCOLS as readonly string[]).includes(value);
}

export function defaultPortForProtocol(protocol: Protocol): number {
  switch (protocol) {
    case "ftp":
    case "ftps_explicit":
      return 21;
    case "ftps_implicit":
      return 990;
    case "sftp":
    case "ssh":
      return 22;
  }
}

export function isFtpLike(protocol: Protocol): boolean {
  return (
    protocol === "ftp" ||
    protocol === "ftps_explicit" ||
    protocol === "ftps_implicit"
  );
}

export function protocolLabel(protocol: Protocol): string {
  switch (protocol) {
    case "ftp":
      return "FTP";
    case "ftps_explicit":
      return "FTPS";
    case "ftps_implicit":
      return "FTPS-I";
    case "sftp":
      return "SFTP";
    case "ssh":
      return "SSH";
  }
}
