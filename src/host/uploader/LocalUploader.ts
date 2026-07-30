import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "../path";
import { BaseUploader, type UploadResult } from "./BaseUploader";

/**
 * 把临时文件落到文档旁目录（默认 assets/），返回相对路径供 Markdown 引用。
 */
export class LocalUploader extends BaseUploader {
  async upload(tempPath: string, originalName: string): Promise<UploadResult> {
    const directory = this.config
      .getItem<string>("upload.directory")
      .trim()
      .replace(/\\/g, "/");
    const fileName = this.uniqueFileName(originalName);
    const segments = directory.split("/").filter(Boolean);
    const targetDir = segments.length
      ? join(this.documentDir, ...segments)
      : this.documentDir;
    const target = join(targetDir, fileName);

    const bytes = await readFile(tempPath);
    await mkdir(targetDir, { recursive: true });
    await writeFile(target, bytes);

    const url = segments.length ? `${segments.join("/")}/${fileName}` : fileName;
    return { url, msg: originalName };
  }
}
