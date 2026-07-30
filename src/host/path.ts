/** 浏览器侧路径工具，避免依赖 Node path。 */

export function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) {
    return normalized.startsWith("/") ? "/" : ".";
  }
  return normalized.slice(0, idx);
}

export function basename(filePath: string, ext?: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (ext && name.endsWith(ext)) {
    return name.slice(0, -ext.length);
  }
  return name;
}

export function extname(filePath: string): string {
  const name = basename(filePath);
  const idx = name.lastIndexOf(".");
  if (idx <= 0) {
    return "";
  }
  return name.slice(idx);
}

export function join(...parts: string[]): string {
  const stack: string[] = [];
  for (const part of parts) {
    if (!part) {
      continue;
    }
    const segments = part.replace(/\\/g, "/").split("/");
    for (const seg of segments) {
      if (!seg || seg === ".") {
        continue;
      }
      if (seg === "..") {
        if (stack.length && stack[stack.length - 1] !== "..") {
          stack.pop();
        } else {
          stack.push(seg);
        }
        continue;
      }
      stack.push(seg);
    }
  }
  const absolute = parts[0]?.replace(/\\/g, "/").startsWith("/") ?? false;
  const joined = stack.join("/");
  return absolute ? `/${joined}` : joined;
}

export function platform(): "darwin" | "win32" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) {
    return "darwin";
  }
  if (ua.includes("win")) {
    return "win32";
  }
  return "linux";
}
