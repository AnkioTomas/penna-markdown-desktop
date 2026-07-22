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

export type ConfigListener = () => void;

export const CONFIG_DEFAULTS: Record<string, unknown> = {
  "ui.layout": "split",
  "ui.theme": "default",
  "ui.appearance": "auto",
  "ui.statusbar": true,
  "ui.sidebar": true,
  "ui.lineNumbers": true,
  "upload.mode": "off",
  "upload.directory": "assets",
  "upload.script": "",
  "upload.picgoPath": "",
  "upload.upicPath": "",
  "upload.timeoutMs": 60_000,
  "ai.enabled": false,
  "ai.provider": "openai",
  "ai.endpoint": "https://api.openai.com/v1",
  "ai.apiKey": "",

  "ai.model": "gpt-4o-mini",
  "ai.temperature": 0.7,
  "ai.headers": {},
  "ai.prompt.polish": "你是一个专业的文本编辑。请对以下文本进行润色，改善其表达的流畅度和语感，纠正生硬的表述。请保持原文的 Markdown 格式不变，仅输出润色后的文本，不要输出任何解释性的废话：\n\n",
  "ai.prompt.proofread": "你是一个专业的校对员。请对以下文本进行错别字和语病校对，修正错误的标点符号。请保持原文的 Markdown 格式不变，仅输出校对后的文本，不要输出任何解释性的废话：\n\n",
  "ai.prompt.translate": "你是一个专业的翻译。请将以下文本翻译为流畅的目标语言（中文翻译为英文，外文翻译为中文）。请保持原文的 Markdown 格式不变，仅输出翻译结果，不要输出任何解释性的废话：\n\n",
  "ai.prompt.summarize": "请提取以下文本的核心内容，生成一份简明扼要的摘要，并保留关键信息。仅输出摘要，不要输出任何解释性的废话：\n\n",
  "ai.prompt.custom": "请根据以下指令处理文本，仅输出处理结果：\n\n",
};

const DEFAULTS = CONFIG_DEFAULTS;

export class PennaConfig {
  private readonly store = new LazyStore("penna-config.json");
  private readonly cache = new Map<string, unknown>();
  private readonly listeners = new Set<ConfigListener>();
  private loaded = false;

  async load(): Promise<void> {
    const entries = await this.store.entries();
    this.cache.clear();
    for (const [key, value] of entries) {
      this.cache.set(key, value);
    }
    this.loaded = true;
  }

  onChange(listener: ConfigListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getItem<T>(key: string, def: T): T {
    if (!this.loaded) {
      return (DEFAULTS[key] as T | undefined) ?? def;
    }
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }
    return (DEFAULTS[key] as T | undefined) ?? def;
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    this.cache.set(key, value);
    await this.store.set(key, value);
    await this.store.save();
    for (const listener of this.listeners) {
      listener();
    }
  }

  async setMany(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      this.cache.set(key, value);
      await this.store.set(key, value);
    }
    await this.store.save();
    for (const listener of this.listeners) {
      listener();
    }
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = { ...DEFAULTS };
    for (const [key, value] of this.cache) {
      result[key] = value;
    }
    return result;
  }
}
