
import type { AiActionId, AiProvider, PennaConfig } from "./PennaConfig";

interface AiProviderPreset {
  label: string;
  endpoint: string;
  defaultModel: string;
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderPreset> = {
  openai: {
    label: "OpenAI (ChatGPT)",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
  },
  openrouter: {
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
  },
  deepseek: {
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    defaultModel: "deepseek-chat",
  },
  moonshot: {
    label: "Moonshot (Kimi)",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    defaultModel: "moonshot-v1-8k",
  },
  ollama: {
    label: "Ollama (本地)",
    endpoint: "http://127.0.0.1:11434/v1/chat/completions",
    defaultModel: "llama3.2",
  },
  custom: {
    label: "自定义",
    endpoint: "",
    defaultModel: "",
  },
};

export const AI_OUTPUT_RULES = `
输出规则（必须遵守）：
1. 只输出处理后的 Markdown 正文，不要开场白、不要总结、不要「如下所示」之类说明。
2. 不要用 \`\`\`markdown 包裹整个结果；原文里已有的代码块照常保留。
3. 保留原有 Markdown 结构：标题层级、列表、引用、表格、链接、图片、脚注、GFM/Penna 扩展语法（Alert、容器、卡片等）能保留则保留。
4. 行内代码、代码块、公式、URL、锚点 id、frontmatter 键名不要擅自改写。
5. 若原文为空或无需改动，仍返回合理结果（摘要类可给出简短说明；其余尽量保持可替换文本）。
`.trim();

export const AI_ACTION_PROMPTS: Record<string, string> = {
  polish: `
你是资深中文技术写作者与 Markdown 编辑。任务：润色用户给出的 Markdown 片段。

目标：
- 表达更清晰、连贯、专业，去掉冗余与口语废话，但不改变原意与事实。
- 统一术语与人称；理顺长句；修正明显别扭的语序。
- 对英文专有名词、API、命令、路径保持原样。
- 不要扩写成长文，不要添加原文没有的观点或章节。

${AI_OUTPUT_RULES}
`.trim(),

  proofread: `
你是严谨的中文校对编辑。任务：校对用户给出的 Markdown 片段。

只做纠错，不做风格重写：
- 错别字、多字漏字、同音误用（的/地/得 等）。
- 标点、中英文夹杂空格、全半角混用。
- 明显主谓残缺、搭配错误、重复字词。
- 专有名词大小写、常见技术名拼写（在有把握时修正）。
- 不要为了「更好看」改写句式；原意与结构尽量不动。

${AI_OUTPUT_RULES}
`.trim(),

  translate: `
你是专业中英双语译者，熟悉技术文档与 Markdown。任务：翻译用户给出的 Markdown 片段。

方向判定：
- 若正文以中文为主 → 译为流畅、自然的英文。
- 若正文以英文为主 → 译为规范、通顺的简体中文。
- 中英混杂时：翻译叙述性文字，保留代码、标识符、命令、路径、URL、文件名不译。

要求：
- 术语前后一致；技术含义准确，避免机翻腔。
- 保持 Markdown 标记与结构位置对应（标题、列表、表格列等）。
- 链接文字可译，URL 本身不译；图片 alt 可译。

${AI_OUTPUT_RULES}
`.trim(),

  summarize: `
你是信息提炼助手。任务：为用户给出的 Markdown 片段生成摘要。

要求：
- 使用简洁简体中文。
- 抓核心论点与关键信息，去掉例子堆砌与重复表述。
- 结构优先：3–8 条要点列表；若原文极短，可用 1–3 句概括。
- 不要引入原文没有的信息；不确定处不要臆造。
- 摘要本身使用合法 Markdown（可用列表/加粗），但不要复制原文全部内容。

${AI_OUTPUT_RULES}
`.trim(),

  custom: `
你是可控的 Markdown 文本改写引擎。用户会给出「指令」与「文本」。
严格按指令处理文本；指令未要求的内容不要擅自发挥。

若指令与「保留 Markdown 结构」冲突，优先满足指令，但仍避免破坏代码块与 URL。
若指令含糊，做最小必要改动并保持可直接替换。

${AI_OUTPUT_RULES}
`.trim(),
};

export const AI_ACTION_TEMPERATURE: Record<string, number> = {
  polish: 0.4,
  proofread: 0.1,
  translate: 0.2,
  summarize: 0.3,
  custom: 0.4,
};

type AiOnUpdate = (contentDelta?: string, thinkingDelta?: string) => void;

interface ChatCompletionDelta {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
}

interface ChatCompletionChunk {
  choices?: Array<{ delta?: ChatCompletionDelta }>;
  error?: { message?: string };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export class PennaAi {
  constructor(private readonly config: PennaConfig) {}

  /**
   * 适配编辑器 `OnAiRequest`：
   * `(action, text, prompts?, onUpdate?, signal?) => Promise<string>`
   * 有 `onUpdate` 时走 SSE 流式，推送增量 contentDelta / thinkingDelta。
   */
  public async request(
    action: string,
    text: string,
    prompts?: string,
    onUpdate?: AiOnUpdate,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.config.getItem<boolean>("ai.enabled", false)) {
      throw new Error("AI 未启用");
    }

    const { endpoint, model } = this.resolveEndpointAndModel();
    const apiKey = await this.resolveApiKey();
    const system = this.resolveSystemPrompt(action);
    const userContent = this.buildUserMessage(action, text, prompts);
    const temperature = this.resolveTemperature(action);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.getItem<Record<string, string>>("ai.headers", {}),
    };
    if (apiKey && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent },
          ],
          temperature,
          stream: Boolean(onUpdate),
        }),
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const raw = error instanceof Error ? error.message : String(error);
      throw new Error(`网络连接失败: ${raw}`);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `响应错误 HTTP ${response.status}${detail ? `\n原始响应: ${detail.slice(0, 500)}` : ""}`,
      );
    }

    if (onUpdate) {
      return this.consumeStream(response, onUpdate);
    }

    let rawBody = "";
    try {
      rawBody = await response.text();
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const raw = error instanceof Error ? error.message : String(error);
      throw new Error(`网络连接失败: ${raw}`);
    }

    let data: {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    try {
      data = JSON.parse(rawBody) as typeof data;
    } catch {
      throw new Error(`响应错误: 非 JSON\n原始响应: ${rawBody.slice(0, 500)}`);
    }

    if (data.error?.message) {
      throw new Error(
        `响应错误: ${data.error.message}\n原始响应: ${rawBody.slice(0, 500)}`,
      );
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(`响应错误: 缺少内容\n原始响应: ${rawBody.slice(0, 500)}`);
    }
    return this.stripModelFences(content);
  }

  private async consumeStream(
    response: Response,
    onUpdate: AiOnUpdate,
  ): Promise<string> {
    if (!response.body) {
      throw new Error("响应错误: 流式响应缺少 body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        const raw = error instanceof Error ? error.message : String(error);
        throw new Error(`网络连接失败: ${raw}`);
      }
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") {
          continue;
        }

        let chunk: ChatCompletionChunk;
        try {
          chunk = JSON.parse(data) as ChatCompletionChunk;
        } catch {
          continue;
        }

        if (chunk.error?.message) {
          throw new Error(
            `响应错误: ${chunk.error.message}\n原始响应: ${data.slice(0, 500)}`,
          );
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          continue;
        }

        const contentDelta =
          typeof delta.content === "string" && delta.content
            ? delta.content
            : undefined;
        if (contentDelta) {
          content += contentDelta;
        }

        const thinkingDelta =
          (typeof delta.reasoning_content === "string" &&
            delta.reasoning_content) ||
          (typeof delta.reasoning === "string" && delta.reasoning) ||
          undefined;

        if (contentDelta || thinkingDelta) {
          onUpdate(contentDelta, thinkingDelta || undefined);
        }
      }
    }

    const final = this.stripModelFences(content);
    if (!final) {
      throw new Error("响应错误: 缺少内容");
    }
    return final;
  }

  private resolveEndpointAndModel(): { endpoint: string; model: string } {
    const provider = this.config.getItem<AiProvider>("ai.provider", "openai");
    const preset = AI_PROVIDERS[provider] ?? AI_PROVIDERS.custom;
    const endpoint =
      this.config.getItem<string>("ai.endpoint", "").trim() || preset.endpoint;
    const model =
      this.config.getItem<string>("ai.model", "").trim() || preset.defaultModel;

    if (!endpoint) {
      throw new Error(
        provider === "custom"
          ? "自定义供应商需配置 ai.endpoint"
          : "未解析到 AI endpoint",
      );
    }
    if (!model) {
      throw new Error("未配置 ai.model");
    }

    return { endpoint, model };
  }

  private async resolveApiKey(): Promise<string> {
    return this.config.getItem<string>("ai.apiKey", "").trim();
  }

  private resolveSystemPrompt(action: string): string {
    const override = this.config
      .getItem<string>(`ai.prompt.${action as AiActionId}`, "")
      .trim();
    if (override) {
      return override;
    }
    return (
      AI_ACTION_PROMPTS[action] ||
      `你是 Markdown 写作助手。按要求处理文本。\n\n${AI_OUTPUT_RULES}`
    );
  }

  private resolveTemperature(action: string): number {
    const configured = this.config.getItem<number>("ai.temperature", -1);
    if (configured >= 0) {
      return configured;
    }
    return AI_ACTION_TEMPERATURE[action] ?? 0.3;
  }

  private buildUserMessage(
    action: string,
    text: string,
    prompts?: string,
  ): string {
    if (action === "custom") {
      const instruction = prompts?.trim() || "优化表达，使更清晰，不改变原意。";
      return `## 指令\n${instruction}\n\n## 文本\n${text}`;
    }

    const labels: Record<string, string> = {
      polish: "请润色以下 Markdown：",
      proofread: "请校对以下 Markdown（只纠错，不重写风格）：",
      translate: "请翻译以下 Markdown：",
      summarize: "请总结以下 Markdown：",
    };
    const label = labels[action] || "请处理以下 Markdown：";
    return `${label}\n\n${text}`;
  }

  private stripModelFences(content: string): string {
    const trimmed = content.trim();
    const matched = trimmed.match(
      /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i,
    );
    return matched?.[1]?.trim() ?? trimmed;
  }
}
