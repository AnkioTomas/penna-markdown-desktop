import { message } from "@tauri-apps/plugin-dialog";
import type { AiProvider, PennaConfig } from "../host/PennaConfig";
import {
  AI_ACTION_PROMPTS,
  AI_ACTION_TEMPERATURE,
  AI_PROVIDERS,
} from "../host/PennaAi";

type Field =
  | {
      key: string;
      label: string;
      type: "text" | "number" | "checkbox" | "textarea" | "json";
      /**
       * 库内置的真实默认值。会回填进输入框；保存时若和内置一致则回写空串，
       * 配置里留空 = 继续跟随库默认，不把当前地址钉死。
       */
      builtin?: string;
      /** 只是说明用的 placeholder，本身不是可用值 */
      emptyMeans?: string;
      hint?: string;
    }
  | {
      key: string;
      label: string;
      type: "select";
      options: Array<{ value: string; label: string }>;
      hint?: string;
    };

/** 分区内的一小组字段，用小标题隔开 */
interface FieldGroup {
  title?: string;
  hint?: string;
  fields: Field[];
}

/** 左侧导航的一项，按「作用范围」划分 */
interface Section {
  id: string;
  label: string;
  hint: string;
  groups: FieldGroup[];
}

/**
 * penna-markdown 内置的远程渲染服务地址。
 *
 * 只能抄：库没从任何入口导出这几个常量（`penna-markdown` 和
 * `penna-markdown/transformer` 都没有），单独引子路径会把整个 transformer
 * 再打包一份，为三个字符串不值得。
 *
 * 升级依赖时核对：
 * dist/types/transformer/extends/block/mathBlock.d.ts   → MATH_API_HOST
 * dist/types/transformer/extends/block/specialCode.d.ts → MERMAID/ECHARTS_API_HOST
 */
const BUILTIN_MATH_API = "https://math-api-delta.vercel.app";
const BUILTIN_MERMAID_API = "https://mermaid.ink";
const BUILTIN_ECHARTS_API = "https://echarts-api.vercel.app";

/** 从供应商表推导，避免这句说明和 AI_PROVIDERS 脱节 */
const THINKING_CAPABLE = (Object.keys(AI_PROVIDERS) as AiProvider[])
  .filter((id) => AI_PROVIDERS[id].thinkingOff)
  .map((id) => AI_PROVIDERS[id].label)
  .join(" / ");

const SECTIONS: Section[] = [
  {
    id: "global",
    label: "全局",
    hint: "作用于整个窗口。",
    groups: [
      {
        fields: [
          {
            key: "ui.appearance",
            label: "明暗模式",
            type: "select",
            options: [
              { value: "auto", label: "自动（跟随系统）" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ],
            hint: "导出的 HTML / PDF 始终是浅色",
          },
          {
            key: "ui.theme",
            label: "主题",
            type: "select",
            options: [
              "default",
              "github",
              "claude",
              "morandi",
              "latex",
              "vue",
              "notion",
            ].map((value) => ({ value, label: value })),
            hint: "同时决定编辑区的语法高亮和预览区的排版",
          },
          {
            key: "ui.layout",
            label: "启动布局",
            type: "select",
            options: [
              { value: "split", label: "分栏（编辑 + 预览）" },
              { value: "edit", label: "仅编辑" },
              { value: "preview", label: "仅预览" },
            ],
            hint: "窗口打开时的分栏方式",
          },
          {
            key: "ui.sidebar",
            label: "显示侧边栏",
            type: "checkbox",
            hint: "窗口左侧的大纲与文件列表，宽度可直接拖拽",
          },
          {
            key: "ui.statusbar",
            label: "显示状态栏",
            type: "checkbox",
            hint: "窗口底部的字数与光标位置",
          },
        ],
      },
    ],
  },
  {
    id: "editor",
    label: "编辑区域",
    hint: "只影响左侧的 Markdown 源码编辑区。",
    groups: [
      {
        fields: [
          {
            key: "ui.lineNumbers",
            label: "显示行号",
            type: "checkbox",
            hint: "编辑区左侧的行号，和预览区代码块的行号是两个设置",
          },
        ],
      },
      {
        title: "图片上传",
        hint: "在编辑区粘贴或拖入图片时如何处理。文档必须先保存，否则没有落盘位置。",
        fields: [
          {
            key: "upload.mode",
            label: "上传方式",
            type: "select",
            options: [
              { value: "off", label: "关闭（不处理）" },
              { value: "local", label: "存到本地目录" },
              { value: "script", label: "自定义脚本" },
              { value: "picgo", label: "PicGo" },
              { value: "upic", label: "uPic" },
            ],
          },
          {
            key: "upload.directory",
            label: "本地目录",
            type: "text",
            hint: "「存到本地目录」方式：相对文档所在目录，正文里插入相对路径",
          },
          {
            key: "upload.script",
            label: "脚本路径",
            type: "text",
            emptyMeans: "「自定义脚本」方式必填",
            hint: "按 Typora 约定调用「脚本 图片路径」，脚本需在首行输出图片 URL",
          },
          {
            key: "upload.picgoPath",
            label: "PicGo 路径",
            type: "text",
            emptyMeans:
              "/Applications/PicGo.app/Contents/MacOS/PicGo 或 PATH 中的 picgo",
          },
          {
            key: "upload.upicPath",
            label: "uPic 路径",
            type: "text",
            emptyMeans: "/Applications/uPic.app/Contents/MacOS/uPic",
          },
          {
            key: "upload.timeoutMs",
            label: "上传超时（毫秒）",
            type: "number",
            hint: "等待上传命令返回的最长时间",
          },
        ],
      },
    ],
  },
  {
    id: "preview",
    label: "预览区域",
    hint: "影响右侧预览，以及导出的 HTML / PDF 和复制到公众号的结果。",
    groups: [
      {
        fields: [
          {
            key: "ui.previewMaxWidth",
            label: "正文最大宽度（px）",
            type: "number",
            hint: "「仅预览」布局和导出时生效；分栏布局下宽度由窗口决定",
          },
          {
            key: "render.headingSlug",
            label: "标题锚点",
            type: "checkbox",
            hint: "给标题生成 id，导出 HTML 后可用 #锚点 跳转",
          },
        ],
      },
      {
        title: "代码块",
        fields: [
          {
            key: "render.codeEnhanced",
            label: "增强渲染",
            type: "checkbox",
            hint: "语言顶栏、复制按钮、行高亮、折叠、图表；关闭后输出朴素代码块",
          },
          {
            key: "render.codeLineNumbers",
            label: "显示行号",
            type: "checkbox",
            hint: "预览区代码块左侧的行号",
          },
          {
            key: "render.codeWrap",
            label: "自动换行",
            type: "checkbox",
            hint: "关闭时超长的行改为横向滚动",
          },
        ],
      },
      {
        title: "远程渲染服务",
        hint: "公式和图表由远程服务渲染成图片，正文内容会离开本机。下面填的是内置地址，可改为自建服务；清空则回到内置地址。",
        fields: [
          {
            key: "render.mathApiHost",
            label: "公式（$...$）",
            type: "text",
            builtin: BUILTIN_MATH_API,
          },
          {
            key: "render.mermaidApiHost",
            label: "Mermaid",
            type: "text",
            builtin: BUILTIN_MERMAID_API,
          },
          {
            key: "render.echartsApiHost",
            label: "ECharts",
            type: "text",
            builtin: BUILTIN_ECHARTS_API,
          },
        ],
      },
    ],
  },
  {
    id: "ai",
    label: "AI 助手",
    hint: "编辑区选中文本后可用的 AI 动作，走 OpenAI 兼容的 chat/completions 接口。",
    groups: [
      {
        title: "连接",
        fields: [
          {
            key: "ai.enabled",
            label: "启用 AI",
            type: "checkbox",
            hint: "关闭后编辑区不再出现 AI 动作",
          },
          {
            key: "ai.provider",
            label: "供应商",
            type: "select",
            options: (Object.keys(AI_PROVIDERS) as AiProvider[]).map(
              (value) => ({
                value,
                label: AI_PROVIDERS[value].label,
              }),
            ),
            hint: "决定下面两项留空时使用的预设",
          },
          // placeholder 由 bindProviderFields 按当前供应商实时填
          {
            key: "ai.endpoint",
            label: "Endpoint",
            type: "text",
            hint: "留空使用供应商预设",
          },
          {
            key: "ai.model",
            label: "模型",
            type: "text",
            hint: "留空使用供应商默认模型",
          },
          {
            key: "ai.apiKey",
            label: "API Key",
            type: "text",
            hint: "明文存放在本机配置文件里",
          },
        ],
      },
      {
        title: "请求参数",
        fields: [
          {
            key: "ai.temperature",
            label: "温度",
            type: "number",
            hint: `-1 表示按动作内置（润色 ${AI_ACTION_TEMPERATURE.polish} / 校对 ${AI_ACTION_TEMPERATURE.proofread} / 翻译 ${AI_ACTION_TEMPERATURE.translate} / 摘要 ${AI_ACTION_TEMPERATURE.summarize}）`,
          },
          {
            key: "ai.thinking",
            label: "思考模式",
            type: "checkbox",
            hint: `仅 ${THINKING_CAPABLE} 支持切换；其余供应商请用下面的「附加参数」自行指定`,
          },
          {
            key: "ai.body",
            label: "附加参数",
            type: "json",
            hint: "供应商专有参数，原样合并进请求体，可覆盖上面的思考模式开关。model / messages / temperature / stream 由上面的设置决定，写在这里无效",
          },
        ],
      },
      {
        title: "提示词",
        hint: "留空使用内置提示词；改回和内置一致时也记为空。",
        fields: [
          {
            key: "ai.prompt.polish",
            label: "润色",
            type: "textarea",
            builtin: AI_ACTION_PROMPTS.polish,
          },
          {
            key: "ai.prompt.proofread",
            label: "校对",
            type: "textarea",
            builtin: AI_ACTION_PROMPTS.proofread,
          },
          {
            key: "ai.prompt.translate",
            label: "翻译",
            type: "textarea",
            builtin: AI_ACTION_PROMPTS.translate,
          },
          {
            key: "ai.prompt.summarize",
            label: "摘要",
            type: "textarea",
            builtin: AI_ACTION_PROMPTS.summarize,
          },
          {
            key: "ai.prompt.custom",
            label: "自定义",
            type: "textarea",
            builtin: AI_ACTION_PROMPTS.custom,
          },
        ],
      },
    ],
  },
];

function storedValue(config: PennaConfig, field: Field): string | boolean {
  if (field.type === "checkbox") {
    return config.getItem<boolean>(field.key);
  }
  if (field.type === "json") {
    const value = config.getItem<Record<string, unknown>>(field.key);
    // 空对象显示为空框，别让用户对着一个 {} 猜要不要删
    return Object.keys(value).length ? JSON.stringify(value, null, 2) : "";
  }
  if (field.type === "number") {
    return String(config.getItem<number>(field.key));
  }
  return String(config.getItem<string>(field.key));
}

function renderFields(fields: Field[], config: PennaConfig): string {
  return fields
    .map((field) => {
      const stored = storedValue(config, field);
      const id = `cfg-${field.key}`;
      const hint = field.hint
        ? `<span class="penna-dialog-table-hint">${escapeHtml(field.hint)}</span>`
        : "";

      if (field.type === "checkbox") {
        // 说明必须换行放在标题下面，挤在勾选框同一行没人看得懂
        return `<label class="penna-dialog-field penna-dialog-field--check" for="${id}"><input id="${id}" data-key="${field.key}" type="checkbox" ${stored ? "checked" : ""} /><span class="penna-settings-check-text"><span>${escapeHtml(field.label)}</span>${hint}</span></label>`;
      }

      if (field.type === "select") {
        const options = field.options
          .map(
            (opt) =>
              `<option value="${opt.value}" ${opt.value === stored ? "selected" : ""}>${escapeHtml(opt.label)}</option>`,
          )
          .join("");
        return `<label class="penna-dialog-field" for="${id}">${escapeHtml(field.label)}<select id="${id}" data-key="${field.key}">${options}</select>${hint}</label>`;
      }

      if (field.type === "json") {
        // data-json 既标记类型，也带上给报错用的字段名
        return `<label class="penna-dialog-field" for="${id}">${escapeHtml(field.label)}<textarea id="${id}" data-key="${field.key}" data-json="${escapeHtml(field.label)}" rows="4" placeholder="${escapeHtml('{"top_p": 0.9}')}">${escapeHtml(String(stored))}</textarea>${hint}</label>`;
      }

      // 有内置值的字段：空配置时把内置值回填进框，让用户看到实际生效的是什么。
      // data-builtin 让保存时把「没改过」还原成空串，配置里不留死值。
      const builtin = field.builtin ?? "";
      const display = String(stored).trim() || builtin;
      const builtinAttr = builtin
        ? ` data-builtin="${escapeHtml(builtin)}"`
        : "";
      const placeholderText = builtin || field.emptyMeans || "";
      const placeholder = placeholderText
        ? ` placeholder="${escapeHtml(placeholderText)}"`
        : "";

      if (field.type === "textarea") {
        return `<label class="penna-dialog-field" for="${id}">${escapeHtml(field.label)}<textarea id="${id}" data-key="${field.key}" rows="6"${builtinAttr}${placeholder}>${escapeHtml(display)}</textarea>${hint}</label>`;
      }

      const providerBound =
        field.key === "ai.endpoint" || field.key === "ai.model"
          ? ` data-provider-bound="${field.key === "ai.endpoint" ? "endpoint" : "model"}"`
          : "";
      return `<label class="penna-dialog-field" for="${id}">${escapeHtml(field.label)}<input id="${id}" data-key="${field.key}" type="${field.type}" value="${escapeHtml(display)}"${builtinAttr}${placeholder}${providerBound} />${hint}</label>`;
    })
    .join("");
}

function renderGroup(group: FieldGroup, config: PennaConfig): string {
  const title = group.title
    ? `<p class="penna-settings-group-title">${escapeHtml(group.title)}</p>`
    : "";
  const hint = group.hint
    ? `<p class="penna-dialog-table-hint">${escapeHtml(group.hint)}</p>`
    : "";
  return `<div class="penna-settings-group">${title}${hint}${renderFields(group.fields, config)}</div>`;
}

/**
 * 所有分区一次性渲染，非当前分区用 `hidden` 藏起来。
 * 保存时 `readValues` 扫全表单，切分区不会丢掉还没提交的修改。
 */
function renderPages(config: PennaConfig): string {
  return SECTIONS.map(
    (section, index) => `
      <section class="penna-settings-page" data-page="${section.id}"${index === 0 ? "" : " hidden"}>
        <p class="penna-dialog-table-hint">${escapeHtml(section.hint)}</p>
        ${section.groups.map((group) => renderGroup(group, config)).join("")}
      </section>`,
  ).join("");
}

function renderNav(): string {
  return SECTIONS.map(
    (section, index) =>
      `<button type="button" class="penna-settings-nav-item${index === 0 ? " is-active" : ""}" data-section="${section.id}">${escapeHtml(section.label)}</button>`,
  ).join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 解析失败直接抛：让保存流程停下来报错，不要把坏配置写进去 */
function parseJsonObject(label: string, raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`「${label}」不是合法 JSON：${detail}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`「${label}」必须是 JSON 对象，例如 {"top_p": 0.9}`);
  }
  return parsed as Record<string, unknown>;
}

function readValues(root: HTMLElement): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const el of root.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("[data-key]")) {
    const key = el.dataset.key!;
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      values[key] = el.checked;
      continue;
    }
    if (el instanceof HTMLInputElement && el.type === "number") {
      const num = Number(el.value);
      // 清空或乱填不算「改成 0」：宽度 0 会让预览直接空白，保留原值更合理
      if (el.value.trim() && Number.isFinite(num)) {
        values[key] = num;
      }
      continue;
    }
    const jsonLabel = el.dataset.json;
    if (jsonLabel !== undefined) {
      values[key] = parseJsonObject(jsonLabel, el.value);
      continue;
    }

    let value = el.value;
    const builtin = el.dataset.builtin;
    // 与内置完全一致 → 存空，继续走「留空用默认」
    if (builtin !== undefined && value.trim() === builtin.trim()) {
      value = "";
    }
    values[key] = value;
  }
  return values;
}

function bindSectionNav(root: HTMLElement): void {
  const items = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-section]"),
  );
  const pages = Array.from(
    root.querySelectorAll<HTMLElement>("[data-page]"),
  );
  const scroller = root.querySelector<HTMLElement>(".penna-settings-pages");

  for (const item of items) {
    item.addEventListener("click", () => {
      for (const other of items) {
        other.classList.toggle("is-active", other === item);
      }
      for (const page of pages) {
        page.hidden = page.dataset.page !== item.dataset.section;
      }
      if (scroller) {
        scroller.scrollTop = 0;
      }
    });
  }
}

function bindProviderFields(root: HTMLElement): void {
  const providerSelect = root.querySelector<HTMLSelectElement>(
    '[data-key="ai.provider"]',
  );
  const endpointInput = root.querySelector<HTMLInputElement>(
    '[data-provider-bound="endpoint"]',
  );
  const modelInput = root.querySelector<HTMLInputElement>(
    '[data-provider-bound="model"]',
  );
  const thinkingInput = root.querySelector<HTMLInputElement>(
    '[data-key="ai.thinking"]',
  );
  if (!providerSelect || !endpointInput || !modelInput) {
    return;
  }

  const sync = () => {
    const preset = AI_PROVIDERS[providerSelect.value as AiProvider];
    endpointInput.placeholder = preset.endpoint || "自定义供应商需手动填写";
    modelInput.placeholder = preset.defaultModel || "自定义供应商需手动填写";
    if (thinkingInput) {
      thinkingInput.disabled = !preset.thinkingOff;
    }
  };

  providerSelect.addEventListener("change", sync);
  sync();
}

export class SettingsPanel {
  private host: HTMLElement | null = null;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.close();
    }
  };

  constructor(
    private readonly config: PennaConfig,
    private readonly onSaved: () => void,
  ) {}

  open(): void {
    if (this.host) {
      return;
    }

    const mount =
      document.querySelector<HTMLElement>("#penna-root .penna") ??
      document.getElementById("penna-root");
    if (!mount) {
      throw new Error("Missing penna mount for settings dialog");
    }

    const host = document.createElement("div");
    host.className = "penna-dialog-host";
    host.innerHTML = `
      <button type="button" class="penna-dialog-backdrop" aria-label="关闭"></button>
      <div class="penna-dialog-panel" role="dialog" aria-modal="true">
        <div class="penna-dialog-body">
          <form class="penna-dialog-form penna-dialog-form--settings">
            <div class="penna-dialog-table-head">
              <span class="penna-dialog-table-title">设置</span>
            </div>
            <div class="penna-settings-body">
              <nav class="penna-settings-nav" aria-label="设置分类">
                ${renderNav()}
              </nav>
              <div class="penna-settings-pages">
                ${renderPages(this.config)}
              </div>
            </div>
            <div class="penna-dialog-actions">
              <button type="button" data-action="cancel">取消</button>
              <button type="button" class="is-primary" data-action="save">保存</button>
            </div>
          </form>
        </div>
      </div>
    `;

    host
      .querySelector(".penna-dialog-backdrop")
      ?.addEventListener("click", () => this.close());
    host
      .querySelector('[data-action="cancel"]')
      ?.addEventListener("click", () => this.close());
    host
      .querySelector('[data-action="save"]')
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        void this.save(host);
      });
    host.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.save(host);
    });

    bindSectionNav(host);
    bindProviderFields(host);
    mount.appendChild(host);
    this.host = host;
    document.addEventListener("keydown", this.onKeyDown);
  }

  close(): void {
    if (!this.host) {
      return;
    }
    document.removeEventListener("keydown", this.onKeyDown);
    this.host.classList.add("is-closing");
    const host = this.host;
    this.host = null;
    window.setTimeout(() => host.remove(), 200);
  }

  private async save(root: HTMLElement): Promise<void> {
    let values: Record<string, unknown>;
    try {
      values = readValues(root);
    } catch (error) {
      // 校验没过就别关弹窗，用户还要回去改
      const detail = error instanceof Error ? error.message : String(error);
      await message(detail, { title: "设置未保存", kind: "error" });
      return;
    }

    await this.config.setMany(values);
    this.close();
    this.onSaved();
  }
}
