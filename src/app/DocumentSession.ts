import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import type { CherryFileItem } from "cherry-markdown-next";
import { basename, dirname, join } from "../host/path";

const UNTITLED = "Untitled.md";

export type DocumentListener = () => void;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isInsideRoot(root: string, filePath: string): boolean {
  const r = normalizePath(root);
  const f = normalizePath(filePath);
  return f === r || f.startsWith(`${r}/`);
}

function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

function relativeToRoot(root: string, filePath: string): string {
  const r = normalizePath(root);
  const f = normalizePath(filePath);
  if (f.startsWith(`${r}/`)) {
    return f.slice(r.length + 1);
  }
  return basename(filePath);
}

function firstSummaryLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    return trimmed.replace(/^#+\s*/, "").slice(0, 80);
  }
  return "";
}

export class DocumentSession {
  private path: string | null = null;
  /** 打开文件夹后的工作根目录（侧栏文件列表 / 相对资源 / 另存默认路径） */
  private folderRoot: string | null = null;
  private text = "";
  private dirty = false;
  private readonly listeners = new Set<DocumentListener>();

  onChange(listener: DocumentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPath(): string | null {
    return this.path;
  }

  getDir(): string | null {
    if (this.path) {
      return dirname(this.path);
    }
    return this.folderRoot;
  }

  getFolderRoot(): string | null {
    return this.folderRoot;
  }

  getText(): string {
    return this.text;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  setText(text: string, markDirty = true): void {
    this.text = text;
    if (markDirty) {
      this.dirty = true;
    }
    this.emit();
  }

  async newDocument(): Promise<boolean> {
    if (!(await this.confirmDiscard())) {
      return false;
    }
    this.path = null;
    this.folderRoot = null;
    this.text = "";
    this.dirty = false;
    this.updateBaseHref(null);
    this.emit();
    return true;
  }

  async openFolder(folderPath?: string): Promise<boolean> {
    if (!(await this.confirmDiscard())) {
      return false;
    }
    let picked = folderPath;
    if (!picked) {
      const selected = await open({
        multiple: false,
        directory: true,
      });
      if (!selected || Array.isArray(selected)) {
        return false;
      }
      picked = selected;
    }
    this.folderRoot = picked;
    this.path = null;
    this.text = "";
    this.dirty = false;
    this.updateBaseHref(picked);
    this.emit();
    return true;
  }

  /** 供编辑器侧栏 `fetchFiles`：递归列出工作区内的 Markdown 文件。 */
  async listWorkspaceFiles(): Promise<CherryFileItem[]> {
    const root = this.folderRoot;
    if (!root) {
      return [];
    }

    const paths: string[] = [];
    await this.collectMarkdownFiles(root, paths);
    paths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    const items: CherryFileItem[] = [];
    for (const filePath of paths) {
      let updateTime = "";
      let summary = "";
      try {
        const info = await stat(filePath);
        if (info.mtime) {
          updateTime = info.mtime.toLocaleString();
        }
        summary = firstSummaryLine(await readTextFile(filePath));
      } catch (error) {
        console.warn("[cherry-desktop] skip file meta", filePath, error);
      }
      items.push({
        id: filePath,
        title: relativeToRoot(root, filePath),
        updateTime,
        summary,
      });
    }
    return items;
  }

  async openDocument(filePath?: string): Promise<boolean> {
    if (!(await this.confirmDiscard())) {
      return false;
    }

    let selected = filePath;
    if (!selected) {
      const picked = await open({
        multiple: false,
        directory: false,
        defaultPath: this.folderRoot ?? undefined,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });
      if (!picked || Array.isArray(picked)) {
        return false;
      }
      selected = picked;
    }

    const content = await readTextFile(selected);
    this.path = selected;
    this.text = content;
    this.dirty = false;
    this.updateBaseHref(this.folderRoot ?? dirname(this.path));
    this.emit();
    return true;
  }

  async save(): Promise<boolean> {
    if (!this.path) {
      return this.saveAs();
    }
    await writeTextFile(this.path, this.text);
    this.dirty = false;
    this.updateBaseHref(this.folderRoot ?? dirname(this.path));
    this.emit();
    return true;
  }

  async saveAs(): Promise<boolean> {
    const defaultPath = this.path
      ?? (this.folderRoot ? join(this.folderRoot, UNTITLED) : UNTITLED);
    const target = await save({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!target) {
      return false;
    }
    await writeTextFile(target, this.text);
    this.path = target;
    this.dirty = false;
    this.updateBaseHref(this.folderRoot ?? dirname(this.path));
    this.emit();
    return true;
  }

  async confirmDiscard(): Promise<boolean> {
    if (!this.dirty) {
      return true;
    }
    return ask("当前文档尚未保存，是否丢弃修改？", {
      title: "未保存的更改",
      kind: "warning",
    });
  }

  async refreshTitle(): Promise<void> {
    const name = this.path
      ? basename(this.path)
      : this.folderRoot
        ? `${basename(this.folderRoot)}/`
        : UNTITLED;
    const title = `${this.dirty ? "• " : ""}${name} — Cherry Markdown Next`;
    await getCurrentWindow().setTitle(title);
  }

  updateBaseHref(docDir: string | null): void {
    let base = document.querySelector("base");
    if (!base) {
      base = document.createElement("base");
      document.head.prepend(base);
    }
    if (!docDir) {
      base.removeAttribute("href");
      return;
    }
    const href = convertFileSrc(docDir).replace(/\/?$/, "/");
    base.setAttribute("href", href);
  }

  private async collectMarkdownFiles(
    dir: string,
    out: string[],
  ): Promise<void> {
    const entries = await readDir(dir);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" ) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory) {
        await this.collectMarkdownFiles(full, out);
        continue;
      }
      if (entry.isFile && isMarkdownName(entry.name)) {
        out.push(full);
      }
    }
  }

  private emit(): void {
    void this.refreshTitle();
    for (const listener of this.listeners) {
      listener();
    }
  }
}
