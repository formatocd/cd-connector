import { describe, expect, it } from "vitest";
import {
  joinPath,
  parentLocalPath,
  parentRemotePath,
  parseBreadcrumbs,
} from "./paths";

describe("remote path helpers", () => {
  it("computes parent remote paths cleanly", () => {
    expect(parentRemotePath("/")).toBe("/");
    expect(parentRemotePath("/var")).toBe("/");
    expect(parentRemotePath("/var/www/html/")).toBe("/var/www");
  });

  it("joins remote paths without duplicate slashes", () => {
    expect(joinPath("/", "index.html", false)).toBe("/index.html");
    expect(joinPath("/var/www/", "index.html", false)).toBe("/var/www/index.html");
  });
});

describe("local path helpers (Windows, UNC, POSIX)", () => {
  it("computes parent paths for Windows drives, UNC shares, and POSIX", () => {
    expect(parentLocalPath("C:\\Users\\Carlos")).toBe("C:\\Users");
    expect(parentLocalPath("C:\\Users")).toBe("C:\\");
    expect(parentLocalPath("\\\\server\\share\\sub\\dir")).toBe("\\\\server\\share\\sub");
    expect(parentLocalPath("\\\\server\\share")).toBe("\\\\server\\share");
    expect(parentLocalPath("//server/share/sub")).toBe("\\\\server\\share");
    expect(parentLocalPath("/home/user/docs")).toBe("/home/user");
  });

  it("joins local paths preserving Windows/UNC separators", () => {
    expect(joinPath("C:\\Users", "file.txt", true)).toBe("C:\\Users\\file.txt");
    expect(joinPath("//server/share", "file.txt", true)).toBe("\\\\server\\share\\file.txt");
    expect(joinPath("/home/user", "file.txt", true)).toBe("/home/user/file.txt");
  });

  it("parses breadcrumbs for UNC, Windows drive, and POSIX paths", () => {
    expect(parseBreadcrumbs("//server/share/a/b", true)).toEqual([
      { label: "\\\\server\\share", path: "\\\\server\\share" },
      { label: "a", path: "\\\\server\\share\\a" },
      { label: "b", path: "\\\\server\\share\\a\\b" },
    ]);

    expect(parseBreadcrumbs("C:\\Users\\Carlos", true)).toEqual([
      { label: "C:\\", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "Carlos", path: "C:\\Users\\Carlos" },
    ]);

    expect(parseBreadcrumbs("/var/log", false)).toEqual([
      { label: "/", path: "/" },
      { label: "var", path: "/var" },
      { label: "log", path: "/var/log" },
    ]);
  });
});
