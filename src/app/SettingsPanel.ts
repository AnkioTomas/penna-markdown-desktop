import type { AiProvider, PennaConfig, UploadMode } from "../host/PennaConfig";
import {
  AI_ACTION_PROMPTS,
  AI_ACTION_TEMPERATURE,
  AI_PROVIDERS,
} from "../host/PennaAi";

type Field =
  | {
      key: string;
      label: string;
      type: "text" | "number" | "checkbox" | "textarea";
      /** 留空表示使用该内置值；展示为 placeholder / 回填 */
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

const UI_FIELDS: Field[] = [
  {
    key: "ui.layout",
    label: "布局",
    type: "select",
    options: [
      { value: "split", label: "分栏" },
      { value: "edit", label: "仅编辑" },
      { value: "preview", label: "仅预览" },
    ],
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
  },
  {
    key: "ui.appearance",
    label: "明暗模式",
    type: "select",
    options: [
      { value: "auto", label: "自动（跟随系统）" },
      { value: "light", label: "浅色" },
      { value: "dark", label: "深色" },
    ],
  },
  { key: "ui.statusbar", label: "状态栏", type: "checkbox" },
  { key: "ui.sidebar", label: "侧边栏", type: "checkbox" },
  { key: "ui.lineNumbers", label: "行号", type: "checkbox" },
];

const UPLOAD_FIELDS: Field[] = [
  {
    key: "upload.mode",
    label: "上传模式",
    type: "select",
    options: [
      { value: "off", label: "关闭" },
      { value: "local", label: "本地 assets" },
      { value: "script", label: "自定义脚本" },
      { value: "picgo", label: "PicGo" },
      { value: "upic", label: "uPic" },
    ],
  },
  { key: "upload.directory", label: "本地目录", type: "text" },
  {
    key: "upload.script",
    label: "脚本路径",
    type: "text",
    emptyMeans: "未配置（script 模式必填）",
  },
  {
    key: "upload.picgoPath",
    label: "PicGo 路径",
    type: "text",
    emptyMeans: "/Applications/PicGo.app/Contents/MacOS/PicGo 或 PATH 中的 picgo",
  },
  {
    key: "upload.upicPath",
    label: "uPic 路径",
    type: "text",
    emptyMeans: "/Applications/uPic.app/Contents/MacOS/uPic",
  },
  { key: "upload.timeoutMs", label: "超时(ms)", type: "number" },
];

const AI_FIELDS: Field[] = [
  { key: "ai.enabled", label: "启用 AI", type: "checkbox" },
  {
    key: "ai.provider",
    label: "供应商",
    type: "select",
    options: (Object.keys(AI_PROVIDERS) as AiProvider[]).map((value) => ({
      value,
      label: AI_PROVIDERS[value].label,
    })),
  },
  {
    key: "ai.endpoint",
    label: "Endpoint",
    type: "text",
    emptyMeans: "", // 运行时按供应商填充
    hint: "留空使用供应商预设",
  },
  { key: "ai.apiKey", label: "API Key", type: "text" },

  {
    key: "ai.model",
    label: "模型",
    type: "text",
    emptyMeans: "",
    hint: "留空使用供应商默认模型",
  },
  {
    key: "ai.temperature",
    label: "温度",
    type: "number",
    hint: `-1 表示按动作内置（润色 ${AI_ACTION_TEMPERATURE.polish} / 校对 ${AI_ACTION_TEMPERATURE.proofread} / 翻译 ${AI_ACTION_TEMPERATURE.translate} / 摘要 ${AI_ACTION_TEMPERATURE.summarize}）`,
  },
  {
    key: "ai.prompt.polish",
    label: "润色提示词",
    type: "textarea",
    emptyMeans: AI_ACTION_PROMPTS.polish,
    hint: "留空使用内置提示词；保存时若与内置一致仍记为空",
  },
  {
    key: "ai.prompt.proofread",
    label: "校对提示词",
    type: "textarea",
    emptyMeans: AI_ACTION_PROMPTS.proofread,
    hint: "留空使用内置提示词",
  },
  {
    key: "ai.prompt.translate",
    label: "翻译提示词",
    type: "textarea",
    emptyMeans: AI_ACTION_PROMPTS.translate,
    hint: "留空使用内置提示词",
  },
  {
    key: "ai.prompt.summarize",
    label: "摘要提示词",
    type: "textarea",
    emptyMeans: AI_ACTION_PROMPTS.summarize,
    hint: "留空使用内置提示词",
  },
  {
    key: "ai.prompt.custom",
    label: "自定义提示词",
    type: "textarea",
    emptyMeans: AI_ACTION_PROMPTS.custom,
    hint: "留空使用内置提示词",
  },
];

function storedValue(config: PennaConfig, field: Field): string | boolean {
  if (field.type === "checkbox") {
    return config.getItem<boolean>(field.key, false);
  }
  if (field.type === "number") {
    return String(config.getItem<number>(field.key, 0));
  }
  return String(config.getItem<string>(field.key, ""));
}

function providerPreset(config: PennaConfig): {
  endpoint: string;
  defaultModel: string;
} {
  const provider = config.getItem<AiProvider>("ai.provider", "openai");
  return AI_PROVIDERS[provider] ?? AI_PROVIDERS.custom;
}

function resolveEmptyMeans(
  field: Field,
  config: PennaConfig,
): string | undefined {
  if (field.type === "select" || field.type === "checkbox") {
    return undefined;
  }
  if (field.key === "ai.endpoint") {
    return providerPreset(config).endpoint || "自定义供应商需手动填写";
  }
  if (field.key === "ai.model") {
    return providerPreset(config).defaultModel || "自定义供应商需手动填写";
  }
  return field.emptyMeans;
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
        return `<label class="penna-dialog-field penna-dialog-field--check" for="${id}"><input id="${id}" data-key="${field.key}" type="checkbox" ${stored ? "checked" : ""} /><span>${escapeHtml(field.label)}</span></label>`;
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

      const emptyMeans = resolveEmptyMeans(field, config) ?? "";
      const isEmptyOverride =
        typeof stored === "string" &&
        stored.trim() === "" &&
        Boolean(emptyMeans);

      // 长文本：空配置时直接回填内置内容便于阅读；保存时若未改回写空串
      if (field.type === "textarea") {
        const display = isEmptyOverride ? emptyMeans : String(stored);
        const builtinAttr = isEmptyOverride
          ? ` data-builtin="${escapeHtml(emptyMeans)}"`
          : emptyMeans
            ? ` data-builtin="${escapeHtml(emptyMeans)}"`
            : "";
        return `<label class="penna-dialog-field" for="${id}">${escapeHtml(field.label)}<textarea id="${id}" data-key="${field.key}" rows="6"${builtinAttr} placeholder="${escapeHtml(emptyMeans)}">${escapeHtml(display)}</textarea>${hint}</label>`;
      }

      // 短文本 / 数字：用 placeholder 展示内置默认，不污染已存值
      const placeholder = emptyMeans
        ? ` placeholder="${escapeHtml(emptyMeans)}"`
        : "";
      const providerBound =
        field.key === "ai.endpoint" || field.key === "ai.model"
          ? ` data-provider-bound="${field.key === "ai.endpoint" ? "endpoint" : "model"}"`
          : "";
      return `<label class="penna-dialog-field" for="${id}">${escapeHtml(field.label)}<input id="${id}" data-key="${field.key}" type="${field.type}" value="${escapeHtml(String(stored))}"${placeholder}${providerBound} />${hint}</label>`;
    })
    .join("");
}

function renderSection(title: string, fields: Field[], config: PennaConfig): string {
  return `
    <p class="penna-dialog-table-hint penna-dialog-section">${escapeHtml(title)}</p>
    ${renderFields(fields, config)}
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      values[key] = Number(el.value);
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

  if (typeof values["upload.mode"] === "string") {
    values["upload.mode"] = values["upload.mode"] as UploadMode;
  }
  return values;
}

function bindProviderPlaceholders(root: HTMLElement): void {
  const providerSelect = root.querySelector<HTMLSelectElement>(
    '[data-key="ai.provider"]',
  );
  const endpointInput = root.querySelector<HTMLInputElement>(
    '[data-provider-bound="endpoint"]',
  );
  const modelInput = root.querySelector<HTMLInputElement>(
    '[data-provider-bound="model"]',
  );
  if (!providerSelect || !endpointInput || !modelInput) {
    return;
  }

  const sync = () => {
    const preset =
      AI_PROVIDERS[providerSelect.value as AiProvider] ?? AI_PROVIDERS.custom;
    endpointInput.placeholder =
      preset.endpoint || "自定义供应商需手动填写";
    modelInput.placeholder =
      preset.defaultModel || "自定义供应商需手动填写";
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
            <div class="penna-dialog-form-scroll-area">
              ${renderSection("界面", UI_FIELDS, this.config)}
              ${renderSection("文件上传", UPLOAD_FIELDS, this.config)}
              ${renderSection("AI", AI_FIELDS, this.config)}
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

    bindProviderPlaceholders(host);
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
    const values = readValues(root);
    await this.config.setMany(values);
    this.close();
    this.onSaved();
  }
}
