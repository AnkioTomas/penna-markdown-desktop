import { LazyStore } from "@tauri-apps/plugin-store";

export type UploadMode = "off" | "local" | "script" | "picgo" | "upic";

export type AppearanceMode = "light" | "dark" | "auto";

export type AiActionId =
  | "polish"
  | "proofread"
  | "translate"
  | "summarize"
  | "custom";

export type AiProvider =
  | "openai"
  | "openrouter"
  | "deepseek"
  | "moonshot"
  | "ollama"
  | "custom";

/**
 * 配置默认值的唯一真源。读配置一律走 `getItem`，缺省值只能来自这张表，
 * 调用点不再各带一份 —— 两处默认值打架过一次了：`ai.endpoint` 曾经在这里
 * 被钉成 OpenAI 地址，导致「留空跟随供应商预设」永远不成立。
 *
 * 空串 / -1 是「跟随内置」的哨兵值，含义见各自的消费方。
 */
const DEFAULTS: Record<string, unknown> = {
  "ui.layout": "split",
  "ui.theme": "default",
  "ui.appearance": "auto",
  "ui.statusbar": true,
  "ui.sidebar": true,
  "ui.lineNumbers": true,
  /** 默认编辑命令快捷键（与上游 DEFAULT_SHORTCUTS / 菜单 accelerator 同源） */
  "editor.shortcuts": true,
  /** 预览与导出正文的最大宽度（px），两处必须同源否则导出物和预览对不上 */
  "ui.previewMaxWidth": 800,
  "render.codeEnhanced": true,
  "render.codeLineNumbers": true,
  "render.codeWrap": false,
  "render.headingSlug": true,
  "upload.mode": "off",
  "upload.directory": "assets",
  "upload.script": "",
  "upload.picgoPath": "",
  "upload.upicPath": "",
  "upload.timeoutMs": 60_000,
  "ai.enabled": false,
  "ai.provider": "openai",
  /** 空串 = 用 AI_PROVIDERS 里当前供应商的预设 */
  "ai.endpoint": "",
  "ai.model": "",
  "ai.apiKey": "",
  /** -1 = 用 AI_ACTION_TEMPERATURE 里该动作的内置温度 */
  "ai.temperature": -1,
  "ai.thinking": true,
  "ai.headers": {},
  /** 附加请求体，直接合并进 chat/completions；可覆盖内置供应商参数 */
  "ai.body": {},
  /** 空串 = 用 AI_ACTION_PROMPTS 里该动作的内置提示词 */
  "ai.prompt.polish": "",
  "ai.prompt.proofread": "",
  "ai.prompt.translate": "",
  "ai.prompt.summarize": "",
  "ai.prompt.custom": "",
};

/**
 * v0.1.3 及以前这几个 key 带着写死的默认值，设置面板每次保存又把它们原样落盘。
 * 后果：选了 DeepSeek 也会把请求发到 `https://api.openai.com/v1`（缺 /chat/completions
 * 的坏地址）并带上 gpt-4o-mini；内置提示词和按动作的温度则永远走不到。
 *
 * 配置里凡是和这些值一字不差的，都是当年自动填进去的，不是用户的选择 —— 删掉即可
 * 回到「留空跟随预设」。用户自己改过的值不等于这里的字面量，不会被误删。
 *
 * 一次性迁移，整块可在下个大版本删除。
 */
const LEGACY_AUTOFILLED: Record<string, unknown> = {
  "ai.endpoint": "https://api.openai.com/v1",
  "ai.model": "gpt-4o-mini",
  "ai.temperature": 0.7,
  "ai.prompt.polish":
    "你是一个专业的文本编辑。请对以下文本进行润色，改善其表达的流畅度和语感，纠正生硬的表述。请保持原文的 Markdown 格式不变，仅输出润色后的文本，不要输出任何解释性的废话：\n\n",
  "ai.prompt.proofread":
    "你是一个专业的校对员。请对以下文本进行错别字和语病校对，修正错误的标点符号。请保持原文的 Markdown 格式不变，仅输出校对后的文本，不要输出任何解释性的废话：\n\n",
  "ai.prompt.translate":
    "你是一个专业的翻译。请将以下文本翻译为流畅的目标语言（中文翻译为英文，外文翻译为中文）。请保持原文的 Markdown 格式不变，仅输出翻译结果，不要输出任何解释性的废话：\n\n",
  "ai.prompt.summarize":
    "请提取以下文本的核心内容，生成一份简明扼要的摘要，并保留关键信息。仅输出摘要，不要输出任何解释性的废话：\n\n",
  "ai.prompt.custom": "请根据以下指令处理文本，仅输出处理结果：\n\n",
};

export class PennaConfig {
  private readonly store = new LazyStore("penna-config.json");
  private readonly cache = new Map<string, unknown>();

  async load(): Promise<void> {
    const entries = await this.store.entries();
    this.cache.clear();
    for (const [key, value] of entries) {
      this.cache.set(key, value);
    }
    await this.dropLegacyAutofilled();
  }

  private async dropLegacyAutofilled(): Promise<void> {
    let dropped = false;
    for (const [key, legacy] of Object.entries(LEGACY_AUTOFILLED)) {
      if (this.cache.get(key) === legacy) {
        this.cache.delete(key);
        await this.store.delete(key);
        dropped = true;
      }
    }
    if (dropped) {
      await this.store.save();
    }
  }

  getItem<T>(key: string): T {
    return (this.cache.has(key) ? this.cache.get(key) : DEFAULTS[key]) as T;
  }

  async setMany(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      this.cache.set(key, value);
      await this.store.set(key, value);
    }
    await this.store.save();
  }
}
