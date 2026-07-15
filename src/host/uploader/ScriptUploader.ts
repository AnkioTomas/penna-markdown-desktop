import { BaseUploader, type UploadResult } from "./BaseUploader";

/**
 * 简单 shell-like 分词：按空白拆分，但双引号/单引号内的空白保留。
 * 引号本身会被剥离。不处理转义——用户配的是 Windows 路径，够用了。
 */
function splitCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote = "";
  for (const ch of input) {
    if (quote) {
      if (ch === quote) {
        quote = "";
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

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
    const parts = splitCommand(scriptPath);
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
