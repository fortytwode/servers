import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const koffi = require("koffi");

// Use the Node process's libuv to borrow the same OS handle used by fs.read.
const getHandle = koffi.load(null).func("void *uv_get_osfhandle(int fd)");
const finalPath = koffi.load("kernel32.dll").func(
  "uint32_t __stdcall GetFinalPathNameByHandleW(void *handle, void *buffer, uint32_t capacity, uint32_t flags)",
);

export function verifyWindowsReadHandle(fd: number, approvedPath: string): void {
  const handle = getHandle(fd);
  // One call gets the normalized DOS path directly from the open handle.
  // Windows extended-length paths are limited to 32,767 UTF-16 code units.
  const capacity = 32768;
  const buffer = Buffer.alloc(capacity * 2);
  const length = finalPath(handle, buffer, capacity, 0);
  if (!length || length >= capacity) {
    throw new Error("Cannot verify the final path of the opened file");
  }

  const actual = buffer.toString("utf16le", 0, length * 2);
  if (actual !== path.toNamespacedPath(approvedPath)) {
    throw new Error("Access denied - the opened file does not match the approved path");
  }
}
