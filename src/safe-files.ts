import { constants, openSync, closeSync, fstatSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { requireCapability } from "./security.js";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function configuredRoot(key: string): string {
  const value = process.env[key];
  if (!value || !isAbsolute(value)) throw new Error(`${key} must name an existing absolute directory`);
  const root = realpathSync(value);
  const info = statSync(root);
  if (!info.isDirectory() || root === sep) throw new Error(`${key} must be a dedicated directory`);
  if ((info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error(`${key} must be owned by this user and not writable by other users`);
  return root;
}

/** Preview-only attachments: canonical containment, regular files, bounded size. */
export function checkedAttachment(path: string): string {
  requireCapability("attachments");
  const root = configuredRoot("HIMALAYA_ATTACHMENT_ROOT");
  if (!isAbsolute(path) || /[\x00-\x1f\x7f"<>\\\u0085\u2028\u2029]/u.test(path)) throw new Error("Unsafe attachment path");
  const canonical = realpathSync(path);
  if (/[\x00-\x1f\x7f"<>\\\u0085\u2028\u2029]/u.test(canonical)) throw new Error("Unsafe canonical attachment path");
  const rel = relative(root, canonical);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Attachment is outside HIMALAYA_ATTACHMENT_ROOT");
  // Do not pass user-supplied symlinks to an MML parser, even within the root.
  if (lstatSync(path).isSymbolicLink()) throw new Error("Attachment symlinks are not accepted");
  const fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_ATTACHMENT_BYTES) throw new Error("Attachment must be a regular file with one link and at most 10 MiB");
  } finally { closeSync(fd); }
  return canonical;
}

/** Flat output namespace + exclusive creation prevents traversal and overwrite. */
export function writeExport(filename: string, content: string): string {
  requireCapability("export");
  if (!filename || filename === "." || filename === ".." || basename(filename) !== filename || /[\\\x00-\x1f\x7f]/u.test(filename)) throw new Error("destination must be a plain filename within HIMALAYA_EXPORT_ROOT");
  const root = configuredRoot("HIMALAYA_EXPORT_ROOT");
  const destination = join(root, filename);
  const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, content, "utf-8"); } finally { closeSync(fd); }
  return destination;
}

/** Never follow a CLI-created symlink while reading a temporary export. */
export function readRegularFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size > 10 * 1024 * 1024) throw new Error("Unsafe or oversized exported file");
    return readFileSync(fd, "utf-8");
  } finally { closeSync(fd); }
}
