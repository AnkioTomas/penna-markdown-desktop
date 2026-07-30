import { exists } from "@tauri-apps/plugin-fs";
import { platform } from "../path";
import { BaseUploader, type UploadResult } from "./BaseUploader";

/**
 * macOS uPic CLI：
 *   /Applications/uPic.app/Contents/MacOS/uPic -u <file>
 */
export class UPicUploader extends BaseUploader {
  async upload(tempPath: string, originalName: string): Promise<UploadResult> {
    if (platform() !== "darwin") {
      throw new Error("uPic 仅支持 macOS");
    }

    const command = await this.resolveUPic();
    const { stdout, stderr } = await this.runCommand(command, ["-u", tempPath]);
    const url = this.parseUPicOutput(stdout, stderr);
    return { url, msg: originalName };
  }

  private async resolveUPic(): Promise<string> {
    const configured = this.config.getItem<string>("upload.upicPath").trim();
    if (configured) {
      return configured;
    }

    const fallback = "/Applications/uPic.app/Contents/MacOS/uPic";
    if (await exists(fallback)) {
      return fallback;
    }

    throw new Error(
      "未找到 uPic，请安装到 /Applications，或配置 upload.upicPath",
    );
  }

  private parseUPicOutput(stdout: string, stderr: string): string {
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const marker = lines.findIndex((line) => /^Output URL:?$/i.test(line));
    if (marker >= 0) {
      for (let i = marker + 1; i < lines.length; i++) {
        if (this.isUrl(lines[i])) {
          return lines[i];
        }
      }
    }

    for (let i = lines.length - 1; i >= 0; i--) {
      if (this.isUrl(lines[i])) {
        return lines[i];
      }
    }

    throw new Error(stderr.trim() || stdout.trim() || "uPic 未返回 URL");
  }
}
