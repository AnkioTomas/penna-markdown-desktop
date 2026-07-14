import {tempDir} from "@tauri-apps/api/path";
import {mkdir, remove, writeFile} from "@tauri-apps/plugin-fs";
import type {CherryConfig, UploadMode} from "./CherryConfig";
import {join} from "./path";
import type {BaseUploader, UploadResult} from "./uploader/BaseUploader";
import {LocalUploader} from "./uploader/LocalUploader";
import {PicgoUploader} from "./uploader/PicgoUploader";
import {ScriptUploader} from "./uploader/ScriptUploader";
import {UPicUploader} from "./uploader/UPicUploader";

export type { UploadResult } from "./uploader/BaseUploader";

export interface UploadRequest {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/**
 * 上传门面：base64 → 临时文件 → 按 mode 交给具体 Uploader → 清理临时目录。
 */
export class CherryUploader {
  constructor(
    private readonly documentPath: string,
    private readonly config: CherryConfig,
  ) {}

  public async upload(request: UploadRequest): Promise<UploadResult> {
    const mode = this.config.getItem<UploadMode>("upload.mode", "off");
    if (mode === "off") {
      throw new Error("文件上传已禁用");
    }
    if (!this.documentPath) {
      throw new Error("请先保存文档后再上传本地文件");
    }

    const uploader = this.createUploader(mode);
    const root = await tempDir();
    const tmpDir = join(root, `cherry-upload-${Date.now()}`);
    const fileName = this.uniqueFileName(request.name);
    const tmpFile = join(tmpDir, fileName);

    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(tmpFile, request.bytes);
      return await uploader.upload(tmpFile, request.name || fileName);
    } finally {
      await remove(tmpDir, { recursive: true }).catch(() => undefined);
    }
  }

  private createUploader(mode: Exclude<UploadMode, "off">): BaseUploader {
    switch (mode) {
      case "local":
        return new LocalUploader(this.documentPath, this.config);
      case "script":
        return new ScriptUploader(this.documentPath, this.config);
      case "picgo":
        return new PicgoUploader(this.documentPath, this.config);
      case "upic":
        return new UPicUploader(this.documentPath, this.config);
      default: {
        throw new Error(`未知上传模式: ${String(mode)}`);
      }
    }
  }

  private uniqueFileName(name: string): string {
    const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
    const base = name.replace(/\.[^.]+$/, "") || "file";
    const safe = base.replace(/[^\w.\-\u4e00-\u9fff]+/gi, "_");
    return `${safe}-${Date.now()}${ext}`;
  }
}
