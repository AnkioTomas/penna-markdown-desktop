import { BaseUploader, type UploadResult } from "./BaseUploader";

/**
 * Typora Custom Command 约定：
 * - 调用：`<script> <tempPath>`
 * - 成功：stdout 首行 http(s) URL
 * - 失败：stdout 首行错误文本（常 exit 0）
 */
export class ScriptUploader extends BaseUploader {
  async upload(tempPath: string, originalName: string): Promise<UploadResult> {
    const script = this.config.getItem<string>("upload.script", "").trim();
    if (!script) {
      throw new Error("未配置 upload.script");
    }

    const scriptPath = this.resolveConfiguredPath(script);
    
    // 支持用户输入带空格的命令，例如 `node ./upload.js`
    const parts = scriptPath.split(/\s+/).filter(Boolean);
    const command = parts[0];
    const args = [...parts.slice(1), tempPath];
    
    const { stdout, stderr } = await this.runCommand(command, args);
    return this.parseTyporaOutput(stdout, stderr, originalName);
  }

  private parseTyporaOutput(
    stdout: string,
    stderr: string,
    fallbackMsg: string,
  ): UploadResult {
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      const err = stderr.trim();
      throw new Error(err || "上传脚本未输出结果");
    }

    const line = lines[0];
    if (this.isUrl(line)) {
      return { url: line, msg: fallbackMsg };
    }

    throw new Error(line);
  }
}
