// Read-only adaptation of modelcontextprotocol/servers at
// c799c8552b0f27b7a33a7b9233773da144dddcf5, src/filesystem/pinned-directory.ts
// and src/filesystem/path-validation.ts. See the accompanying LICENSE.

import fs from "fs";
import path from "path";

const WINDOWS_DRIVE_PREFIX = /^(?:\\\\[?.]\\)?[A-Za-z]:/;
const WINDOWS_UNC_ROOT =
  /^(?:\\\\[?.]\\UNC\\|\\\\(?![?.]\\))[^\\/]+[\\/][^\\/]+/i;
const WINDOWS_DEVICE_NAME =
  /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]) *(?:\..*)?$/is;

function isWindows(): boolean {
  return process.platform === "win32";
}

// Check normalized Windows paths before resolving them and again after realpath.
export function validateWindowsReadPath(filePath: string): void {
  if (!isWindows()) return;

  const drive = WINDOWS_DRIVE_PREFIX.exec(filePath);
  const rest = drive ? filePath.slice(drive[0].length) : filePath;
  const components = filePath.replace(WINDOWS_UNC_ROOT, "").split(/[\\/]/);
  if (rest.includes(":")) {
    throw new Error(`Access denied - NTFS alternate data streams are not supported: ${filePath}`);
  }
  for (const part of components) {
    if (!part || part === "." || part === "..") continue;
    if (WINDOWS_DEVICE_NAME.test(part) || part.endsWith(".") || part.endsWith(" ")) {
      throw new Error(`Access denied - unsupported Windows path component: ${filePath}`);
    }
  }
}

function isWindowsUncRoot(filePath: string): boolean {
  const match = WINDOWS_UNC_ROOT.exec(filePath);
  return match !== null && /^[\\/]?$/.test(filePath.slice(match[0].length));
}

const DATA_VOLUME = "/System/Volumes/Data";

function withoutDataVolume(directory: string): string {
  return directory.startsWith(`${DATA_VOLUME}/`)
    ? directory.slice(DATA_VOLUME.length)
    : directory;
}

function isSameDirectory(current: string, directory: string): boolean {
  if (process.platform !== "darwin") return current === directory;

  // macOS getcwd uses the firmlinked spelling for the Data volume.
  return withoutDataVolume(current) === withoutDataVolume(directory);
}

function directoryChanged(directory: string): Error {
  return new Error(`Access denied - a directory on the path changed during the operation: ${directory}`);
}

function cannotEnter(directory: string, error: unknown): Error {
  const code = (error as NodeJS.ErrnoException).code;
  const message = code === "ENOENT" || code === "ENOTDIR"
    ? `Parent directory does not exist: ${directory}`
    : `${code ?? "Error"}: cannot enter directory: ${directory}`;
  return Object.assign(new Error(message), { code });
}

/** Borrow the process cwd only for a synchronous action, then restore it. */
function inDirectory<T>(directory: string, action: () => T): T {
  let previous: string | undefined;
  try {
    previous = process.cwd();
  } catch {
    // A removed working directory has no path to return to.
  }

  const root = path.parse(directory).root;
  try {
    try {
      process.chdir(directory);
    } catch (error) {
      throw cannotEnter(directory, error);
    }
    // Windows cwd is a spelling, so only the file identity check applies there.
    if (!isWindows() && !isSameDirectory(process.cwd(), directory)) {
      throw directoryChanged(directory);
    }
    return action();
  } finally {
    try {
      process.chdir(previous ?? root);
    } catch {
      process.chdir(root);
    }
  }
}

function isSameEntry(found: fs.BigIntStats, opened: fs.BigIntStats): boolean {
  if (found.ino !== opened.ino) return false;
  // Older Windows libuv can report a zero device for the path stat.
  if (isWindows() && found.dev === 0n) {
    return found.size === opened.size && found.mtimeNs === opened.mtimeNs;
  }
  return found.dev === opened.dev;
}

function directoryReadError(filePath: string): Error {
  return Object.assign(
    new Error(`EISDIR: illegal operation on a directory, read '${filePath}'`),
    { code: "EISDIR" },
  );
}

function nameReadError(error: unknown, name: string, filePath: string): unknown {
  const errno = error as NodeJS.ErrnoException;
  if (error instanceof Error && errno.path === name) {
    error.message = error.message.replace(`'${name}'`, `'${filePath}'`);
    errno.path = filePath;
  }
  return error;
}

async function openReadDescriptor(filePath: string): Promise<{ fd: number; opened: fs.BigIntStats }> {
  // Load native support before borrowing cwd. Non-read tools do not need it.
  const verifyWindowsReadHandle = isWindows()
    ? (await import("./windows-read-handle.js")).verifyWindowsReadHandle
    : undefined;
  const name = path.basename(filePath);
  if (!name || (isWindows() && isWindowsUncRoot(filePath))) {
    throw directoryReadError(filePath);
  }

  return inDirectory(path.dirname(filePath), () => {
    let found: fs.BigIntStats;
    let fd: number;
    try {
      found = fs.lstatSync(name, { bigint: true });
      if (found.isDirectory()) throw directoryReadError(filePath);
      if (!found.isFile()) throw new Error(`Cannot read: not a regular file: ${filePath}`);

      const flags = fs.constants.O_RDONLY
        | (fs.constants.O_NOFOLLOW ?? 0)
        | (fs.constants.O_NONBLOCK ?? 0);
      fd = fs.openSync(name, flags);
    } catch (error) {
      throw nameReadError(error, name, filePath);
    }

    try {
      const opened = fs.fstatSync(fd, { bigint: true });
      if (!opened.isFile() || !isSameEntry(found, opened)) {
        throw new Error(`Refusing to read: ${filePath} was replaced while it was being opened`);
      }
      verifyWindowsReadHandle?.(fd, filePath);
      return { fd, opened };
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  });
}

function close(fd: number): Promise<void> {
  return new Promise((resolve, reject) =>
    fs.close(fd, error => error ? reject(error) : resolve()),
  );
}

interface ReadableFile {
  readonly size: number;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/** Open a validated regular file and read only from its descriptor. */
export async function openFileForReading(filePath: string): Promise<ReadableFile> {
  const { fd, opened } = await openReadDescriptor(filePath);
  return {
    size: Number(opened.size),
    read: (buffer, offset, length, position) => new Promise((resolve, reject) =>
      fs.read(fd, buffer, offset, length, position, (error, bytesRead) =>
        error ? reject(error) : resolve({ bytesRead }),
      ),
    ),
    close: () => close(fd),
  };
}

export async function readFileInDirectory(filePath: string): Promise<Buffer> {
  const { fd } = await openReadDescriptor(filePath);
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      fs.readFile(fd, (error, content) => error ? reject(error) : resolve(content)),
    );
  } finally {
    await close(fd);
  }
}
