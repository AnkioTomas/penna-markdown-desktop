import { invoke } from "@tauri-apps/api/core";
import type { CherryConfig } from "../CherryConfig";
import { basename, extname, isAbsolute, resolve } from "../path";

export interface UploadResult {
  url: string;
  msg: string;
}

/**
 * 上传器基类：前端已把文件落到 tempPath，子类负责变成 Markdown URL。
 */
export abstract class BaseUploader {
  constructor(
    protected readonly documentPath: string,
    protected readonly config: CherryConfig,
  ) {}

  abstract upload(tempPath: string, originalName: string): Promise<UploadResult>;

  protected get timeoutMs(): number {
    return Math.max(
      1000,
      this.config.getItem<number>("upload.timeoutMs", 60_000),
    );
  }

  protected get documentDir(): string {
    const normalized = this.documentPath.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx <= 0 ? normalized : normalized.slice(0, idx);
  }

  protected resolveConfiguredPath(configured: string): string {
    const trimmed = configured.trim();
    if (!trimmed) {
      return "";
    }
    if (isAbsolute(trimmed)) {
      return trimmed;
    }
    return resolve(this.documentDir, trimmed);
  }

  /** 走自定义 `run_command`：用户配置的路径是任意的，shell scope 罩不住。 */
  protected async runCommand(
    command: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return invoke<{ stdout: string; stderr: string; code: number | null }>(
      "run_command",
      {
        command,
        args,
        cwd: this.documentDir,
        timeoutMs: this.timeoutMs,
      },
    );
  }

  protected isUrl(text: string): boolean {
    return /^https?:\/\//i.test(text);
  }

  protected uniqueFileName(name: string): string {
    const ext = extname(name);
    const base = basename(name, ext) || "file";
    const safe = base.replace(/[^\w.\-\u4e00-\u9fff]+/gi, "_");
    return `${safe}-${Date.now()}${ext}`;
  }
}
