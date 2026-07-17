import fs from "node:fs";
import path from "node:path";

/**
 * Writes `content` to `<vaultPath>/<relPath>`, creating parent directories
 * as needed. Refuses any `relPath` that would resolve outside the vault
 * root (SPEC: the vault must be un-manglable — this is the one seam every
 * vault write goes through).
 */
export function writeVaultFile(vaultPath: string, relPath: string, content: string): string {
  const vaultRoot = path.resolve(vaultPath);
  const target = path.resolve(vaultRoot, relPath);
  const relFromRoot = path.relative(vaultRoot, target);

  if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
    throw new Error(`refusing to write outside the vault: ${relPath}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}
