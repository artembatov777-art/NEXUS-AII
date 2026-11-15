import { readFile } from "node:fs/promises";
import path from "node:path";

function decodeMountField(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8))
  );
}

/** Returns true only when the data directory is covered by a non-root mount. */
export function isCoveredByPersistentMount(directory, mountInfo) {
  const target = path.resolve(directory);
  return mountInfo.split("\n").some(line => {
    const separator = line.indexOf(" - ");
    if (separator < 0) return false;
    const fields = line.slice(0, separator).split(" ");
    const mountPoint = decodeMountField(fields[4] || "");
    if (!mountPoint || mountPoint === "/") return false;
    const resolvedMount = path.resolve(mountPoint);
    return target === resolvedMount || target.startsWith(resolvedMount + path.sep);
  });
}

/**
 * Railway can expose an ordinary writable container directory even when the
 * expected Volume was never attached. Refuse to report durable profile storage
 * unless the configured directory is actually covered by a mounted volume.
 * Local development and non-Railway deployments retain their configured path.
 */
export async function assertPersistentVolumeMounted(directory, environment = process.env) {
  if (!environment.RAILWAY_PROJECT_ID) return;
  let mountInfo;
  try {
    mountInfo = await readFile("/proc/self/mountinfo", "utf8");
  } catch {
    const error = new Error("NEXUS could not verify the Railway persistent Volume mount.");
    error.code = "VOLUME_MOUNT_UNVERIFIED";
    throw error;
  }
  if (!isCoveredByPersistentMount(directory, mountInfo)) {
    const error = new Error("Railway persistent storage is not mounted at NEXUS_DATA_DIR. Attach a Volume to this service at /data and set NEXUS_DATA_DIR=/data.");
    error.code = "VOLUME_NOT_MOUNTED";
    throw error;
  }
}
