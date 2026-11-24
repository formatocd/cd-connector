import fs from "node:fs";
import path from "node:path";

const TARGET_DIR = path.resolve("src-tauri", "target");
const BUNDLE_EXTENSIONS = [
  ".exe",
  ".msi",
  ".dmg",
  ".deb",
  ".rpm",
  ".AppImage",
  ".tar.gz",
  ".zip",
  ".sig",
];

function findBundleDirs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === "bundle") {
      acc.push(full);
    } else if (
      entry.name !== "deps" &&
      entry.name !== "build" &&
      entry.name !== "incremental" &&
      entry.name !== ".fingerprint"
    ) {
      findBundleDirs(full, acc);
    }
  }
  return acc;
}

function renameInBundle(bundleDir) {
  let renamed = 0;
  for (const sub of fs.readdirSync(bundleDir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const subDir = path.join(bundleDir, sub.name);
    for (const file of fs.readdirSync(subDir, { withFileTypes: true })) {
      if (!file.isFile()) continue;
      const matchesExt = BUNDLE_EXTENSIONS.some((ext) =>
        file.name.toLowerCase().endsWith(ext.toLowerCase())
      );
      if (!matchesExt) continue;
      if (!file.name.includes("CD Remote")) continue;

      const nextName = file.name.replaceAll("CD Remote", "cd-remote");
      const from = path.join(subDir, file.name);
      const to = path.join(subDir, nextName);
      if (fs.existsSync(to)) {
        fs.unlinkSync(to);
      }
      fs.renameSync(from, to);
      console.log(`Renamed: ${path.relative(TARGET_DIR, from)} -> ${nextName}`);
      renamed++;
    }
  }
  return renamed;
}

const bundleDirs = findBundleDirs(TARGET_DIR);
let total = 0;
for (const dir of bundleDirs) {
  total += renameInBundle(dir);
}

if (total === 0) {
  console.log("No bundle artifacts needed renaming.");
} else {
  console.log(`Done. Renamed ${total} bundle artifact(s).`);
}
