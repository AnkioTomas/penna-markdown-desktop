import { exists } from "@tauri-apps/plugin-fs";
import { platform } from "../path";
import { BaseUploader, type UploadResult } from "./BaseUploader";

/**
 * PicGo 桌面端 / picgo-core CLI：
 *   <PicGo> upload <file>
 */
export class PicgoUploader extends BaseUploader {
  async upload(tempPath: string, originalName: string): Promise<UploadResult> {
    const command = await this.resolvePicgo();
    const { stdout, stderr } = await this.runCommand(command, [
      "upload",
      tempPath,
    ]);
    const url = this.parsePicgoOutput(stdout, stderr);
    return { url, msg: originalName };
  }

  private async resolvePicgo(): Promise<string> {
    const configured = this.config.getItem<string>("upload.picgoPath").trim();
    if (configured) {
      return configured;
    }

    for (const candidate of this.defaultCandidates()) {
      if (candidate.includes("/") || candidate.includes("\\")) {
        if (await exists(candidate)) {
          return candidate;
        }
      } else {
        return candidate;
      }
    }

    throw new Error(
      "未找到 PicGo，请安装桌面端或 picgo-core，或配置 upload.picgoPath",
    );
  }

  private defaultCandidates(): string[] {
    switch (platform()) {
      case "darwin":
        return ["/Applications/PicGo.app/Contents/MacOS/PicGo", "picgo"];
      default:
        return ["picgo"];
    }
  }

  private parsePicgoOutput(stdout: string, stderr: string): string {
    const text = `${stdout}\n${stderr}`;
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const successIdx = lines.findIndex((line) =>
      /\[PicGo SUCCESS\]/i.test(line),
    );
    if (successIdx >= 0) {
      for (let i = successIdx + 1; i < lines.length; i++) {
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

    throw new Error(stderr.trim() || stdout.trim() || "PicGo 未返回 URL");
  }
}
