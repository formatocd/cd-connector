export interface PathCrumb {
  label: string;
  path: string;
}

export function parentRemotePath(path: string): string {
  const cleaned = path.replace(/\/+$/, "");
  if (!cleaned || cleaned === "/") return "/";
  const idx = cleaned.lastIndexOf("/");
  if (idx <= 0) return "/";
  return cleaned.slice(0, idx);
}

export function parentLocalPath(path: string): string {
  // Windows UNC path e.g. \\server\share\sub -> \\server\share
  if (/^(\\\\|\/\/)/.test(path)) {
    const cleaned = path.replace(/\//g, "\\").replace(/\\+$/, "");
    const parts = cleaned.replace(/^\\+/, "").split("\\").filter(Boolean);
    if (parts.length <= 2) {
      return parts.length === 2 ? `\\\\${parts[0]}\\${parts[1]}` : cleaned;
    }
    return `\\\\${parts.slice(0, -1).join("\\")}`;
  }
  const sep = path.includes("\\") ? "\\" : "/";
  const cleaned = path.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  if (idx < 0) return path;
  if (idx === 0) return "/";
  if (sep === "\\" && idx === 2 && cleaned[1] === ":") {
    return `${cleaned.slice(0, 2)}\\`;
  }
  return cleaned.slice(0, idx);
}

export function joinPath(base: string, name: string, isLocal: boolean): string {
  if (isLocal) {
    const sep = base.includes("\\") || /^\/\//.test(base) ? "\\" : "/";
    const normalizedBase = sep === "\\" && /^\/\//.test(base) ? base.replace(/\//g, "\\") : base;
    return normalizedBase.endsWith(sep) ? `${normalizedBase}${name}` : `${normalizedBase}${sep}${name}`;
  }
  return base === "/" || !base ? `/${name}` : `${base.replace(/\/+$/, "")}/${name}`;
}

export function parseBreadcrumbs(path: string, isLocal: boolean): PathCrumb[] {
  if (!path) return [{ label: "/", path: "/" }];

  // Windows UNC network path e.g. \\server\share\folder
  if (isLocal && /^(\\\\|\/\/)[^\\/]+[\\/]+[^\\/]+/.test(path)) {
    const normalized = path.replace(/\//g, "\\");
    const parts = normalized.replace(/^\\+/, "").split("\\").filter(Boolean);
    if (parts.length >= 2) {
      const root = `\\\\${parts[0]}\\${parts[1]}`;
      const crumbs: PathCrumb[] = [{ label: root, path: root }];
      for (let i = 2; i < parts.length; i++) {
        crumbs.push({
          label: parts[i],
          path: `${root}\\${parts.slice(2, i + 1).join("\\")}`,
        });
      }
      return crumbs;
    }
  }

  // Windows path e.g. C:\Users\Carlos
  if (isLocal && /^[a-zA-Z]:/.test(path)) {
    const normalized = path.replace(/\//g, "\\");
    const parts = normalized.split("\\").filter(Boolean);
    const crumbs: PathCrumb[] = [];
    parts.forEach((part, idx) => {
      if (idx === 0) {
        crumbs.push({ label: `${part}\\`, path: `${part}\\` });
      } else {
        const full = `${parts[0]}\\${parts.slice(1, idx + 1).join("\\")}`;
        crumbs.push({ label: part, path: full });
      }
    });
    return crumbs;
  }

  // POSIX / Remote path
  const parts = path.split("/").filter(Boolean);
  const crumbs: PathCrumb[] = [{ label: "/", path: "/" }];
  parts.forEach((part, idx) => {
    crumbs.push({
      label: part,
      path: `/${parts.slice(0, idx + 1).join("/")}`,
    });
  });
  return crumbs;
}
