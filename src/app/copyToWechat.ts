/**
 * 复制预览内容到微信公众号编辑器。
 *
 * 约束：
 * - 微信剥 class / `<style>`，只认 inline；且粘贴后继承不可靠 → 视觉样式要写到每个节点
 * - 不能抄 width/height/flex：那是预览容器算出来的，会把排版钉死/撑爆
 */

export interface CopyToWechatResult {
  localImageCount: number;
}

/** 每个元素都写的视觉属性（含继承项——微信里不写就会丢） */
const VISUAL_PROPS = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-family",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-decoration-color",
  "text-indent",
  "vertical-align",
  "white-space",
  "word-break",
  "overflow-wrap",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-radius",
  "box-shadow",
  "opacity",
  "list-style-type",
  "list-style-position",
] as const;

const SAFE_DISPLAY = new Set([
  "inline",
  "inline-block",
  "list-item",
  "table",
  "table-row",
  "table-cell",
  "table-header-group",
  "table-row-group",
  "table-footer-group",
  "table-column-group",
  "table-caption",
]);

const SKIP_VALUES = new Set([
  "",
  "none",
  "normal",
  "auto",
  "start",
  "static",
  "visible",
  "rgba(0, 0, 0, 0)",
  "transparent",
  "0px",
  "0px 0px 0px 0px",
]);

const JUNK_SELECTORS = [
  ".penna-copy-code-button",
  ".penna-code-block__expand",
  "button",
  "script",
  "style",
  "iframe",
].join(",");

function parseCssColor(
  value: string,
): { r: number; g: number; b: number; a: number } | null {
  const comma = value.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
  );
  if (comma) {
    return {
      r: Number(comma[1]),
      g: Number(comma[2]),
      b: Number(comma[3]),
      a: comma[4] !== undefined ? Number(comma[4]) : 1,
    };
  }
  const space = value.match(
    /rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i,
  );
  if (space) {
    let a = 1;
    if (space[4] !== undefined) {
      a = space[4].endsWith("%")
        ? Number(space[4].slice(0, -1)) / 100
        : Number(space[4]);
    }
    return {
      r: Number(space[1]),
      g: Number(space[2]),
      b: Number(space[3]),
      a,
    };
  }
  return null;
}

/** 微信不吃半透明/color-mix：把 alpha 叠到白底上变成实色 */
function toOpaqueCssColor(
  value: string,
  ground: { r: number; g: number; b: number } = { r: 255, g: 255, b: 255 },
): string {
  if (!value || value === "transparent" || value.includes("color-mix(")) {
    return `rgb(${ground.r}, ${ground.g}, ${ground.b})`;
  }
  const c = parseCssColor(value);
  if (!c) {
    return value;
  }
  if (c.a >= 0.999) {
    return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
  }
  const r = Math.round(c.r * c.a + ground.r * (1 - c.a));
  const g = Math.round(c.g * c.a + ground.g * (1 - c.a));
  const b = Math.round(c.b * c.a + ground.b * (1 - c.a));
  return `rgb(${r}, ${g}, ${b})`;
}

function isDefaultish(prop: string, value: string): boolean {
  if (SKIP_VALUES.has(value)) {
    return true;
  }
  if (prop.startsWith("margin") || prop.startsWith("padding")) {
    return value === "0px";
  }
  if (prop === "font-weight") {
    return value === "400" || value === "normal";
  }
  if (prop === "opacity") {
    return value === "1";
  }
  if (prop === "vertical-align" && value === "baseline") {
    return true;
  }
  if (prop === "text-decoration" && value === "none solid rgb(0, 0, 0)") {
    return true;
  }
  if (prop === "text-decoration" && /^none\b/.test(value)) {
    return true;
  }
  return false;
}

function isLocalImageSrc(src: string): boolean {
  const s = src.trim().toLowerCase();
  if (!s) {
    return false;
  }
  if (/^https?:\/\//.test(s) || s.startsWith("data:") || s.startsWith("//")) {
    return false;
  }
  return (
    s.startsWith("asset:") ||
    s.startsWith("file:") ||
    s.startsWith("tauri:") ||
    s.startsWith("http://asset.localhost") ||
    s.startsWith("https://asset.localhost") ||
    (!s.includes("://") && !s.startsWith("mailto:"))
  );
}

function removeJunk(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll(JUNK_SELECTORS))) {
    el.remove();
  }
}

/**
 * 代码块每行是一个 `display:block` 的 span，DOM 里没有换行符。
 * 微信剥掉 class 和 display，行会挤成一行；纯文本也拿不到换行。
 * 拆掉行容器、按行补回 `\n`，行内高亮 span 原样保留。
 *
 * 折叠行一起带出：折叠是预览里的交互，展开按钮已被剥掉，没理由丢代码。
 */
function flattenCodeLines(root: HTMLElement): void {
  for (const code of root.querySelectorAll("code[data-penna-code]")) {
    const lines = Array.from(code.querySelectorAll(".penna-code-block__line"));
    if (!lines.length) {
      continue;
    }
    const flat = document.createDocumentFragment();
    for (const [index, line] of lines.entries()) {
      if (index > 0) {
        flat.appendChild(document.createTextNode("\n"));
      }
      while (line.firstChild) {
        flat.appendChild(line.firstChild);
      }
    }
    code.replaceChildren(flat);
  }
}

function protectCodeWhitespace(root: HTMLElement): void {
  for (const el of root.querySelectorAll("pre, code")) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    let node = walk.nextNode();
    while (node) {
      texts.push(node as Text);
      node = walk.nextNode();
    }
    for (const text of texts) {
      text.textContent = (text.textContent ?? "")
        .replace(/ /g, "\u00A0")
        .replace(/\t/g, "\u00A0".repeat(4));
    }
  }

  for (const pre of root.querySelectorAll("pre")) {
    const style = (pre as HTMLElement).style;
    style.whiteSpace = "pre-wrap";
    style.overflowX = "auto";
    style.maxWidth = "100%";
    style.boxSizing = "border-box";
  }
}

function replaceCheckboxes(root: HTMLElement): void {
  for (const input of Array.from(
    root.querySelectorAll('input[type="checkbox"]'),
  )) {
    const checked = (input as HTMLInputElement).checked;
    const span = document.createElement("span");
    span.textContent = checked ? "☑ " : "☐ ";
    input.replaceWith(span);
  }
}

function fixImages(root: HTMLElement): number {
  let localImageCount = 0;
  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (isLocalImageSrc(src)) {
      localImageCount += 1;
    }
    img.removeAttribute("width");
    img.removeAttribute("height");
    img.style.width = "";
    img.style.height = "auto";
    img.style.maxWidth = "100%";
    img.style.display = "block";
    img.style.margin = "0.75em auto";
  }
  return localImageCount;
}

function fixTables(root: HTMLElement): void {
  for (const table of root.querySelectorAll("table")) {
    const el = table as HTMLElement;
    el.style.borderCollapse = "collapse";
    el.style.width = "100%";
    el.style.maxWidth = "100%";
    el.style.tableLayout = "fixed";
    el.style.wordBreak = "break-word";
    el.style.margin = "0.75em 0";
  }
  for (const cell of root.querySelectorAll("th, td")) {
    const el = cell as HTMLElement;
    el.style.wordBreak = "break-word";
  }
}

/** 代码块：去行号后强制实色背景 + 边框（微信友好） */
function reinforceCodeBlocks(root: HTMLElement): void {
  const applyChrome = (
    el: HTMLElement,
    withMargin: boolean,
  ): { bg: string; border: string } => {
    const cs = getComputedStyle(el);
    const bg = toOpaqueCssColor(
      cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)"
        ? cs.backgroundColor
        : "rgb(246, 248, 250)",
    );
    const border = toOpaqueCssColor(
      cs.borderTopColor && cs.borderTopColor !== "rgba(0, 0, 0, 0)"
        ? cs.borderTopColor
        : "rgb(208, 215, 222)",
    );
    el.style.backgroundColor = bg;
    el.style.border = `1px solid ${border}`;
    el.style.borderRadius =
      cs.borderRadius && cs.borderRadius !== "0px" ? cs.borderRadius : "6px";
    el.style.overflow = "hidden";
    el.style.boxSizing = "border-box";
    if (withMargin) {
      el.style.margin = "0.75em 0";
    }
    return { bg, border };
  };

  for (const block of root.querySelectorAll(".penna-code-block")) {
    const panel =
      (block.querySelector(".penna-code-block__panel") as HTMLElement | null) ??
      (block as HTMLElement);
    const { bg, border } = applyChrome(panel, true);

    const pre = block.querySelector("pre") as HTMLElement | null;
    if (pre) {
      pre.style.margin = "0";
      pre.style.padding = "12px 16px";
      pre.style.backgroundColor = bg;
      pre.style.border = "none";
      pre.style.borderRadius = "0";
      pre.style.whiteSpace = "pre-wrap";
      pre.style.overflowX = "auto";
      pre.style.maxWidth = "100%";
    }

    const header = block.querySelector(
      ".penna-code-block__header",
    ) as HTMLElement | null;
    if (header) {
      header.style.borderBottom = `1px solid ${border}`;
      header.style.padding = "8px 12px";
      header.style.backgroundColor = bg;
    }
  }

  for (const pre of root.querySelectorAll("pre")) {
    if (pre.closest(".penna-code-block")) {
      continue;
    }
    applyChrome(pre as HTMLElement, true);
    (pre as HTMLElement).style.padding = "12px 16px";
    (pre as HTMLElement).style.whiteSpace = "pre-wrap";
  }
}

/**
 * 自定义容器 / alert：主题用 color-mix(transparent) 半透明，
 * 微信里背景边框会丢。强制叠成实色并补左边强调条。
 */
function reinforceAlerts(root: HTMLElement): void {
  for (const alert of root.querySelectorAll(".penna-alert")) {
    const el = alert as HTMLElement;
    const cs = getComputedStyle(el);
    const bg = toOpaqueCssColor(
      cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)"
        ? cs.backgroundColor
        : "rgb(246, 248, 250)",
    );
    const accent = toOpaqueCssColor(
      cs.borderLeftColor && cs.borderLeftColor !== "rgba(0, 0, 0, 0)"
        ? cs.borderLeftColor
        : cs.color || "rgb(9, 105, 218)",
    );
    const thin = toOpaqueCssColor(accent);

    el.style.backgroundColor = bg;
    el.style.color = cs.color;
    el.style.borderTop = `1px solid ${thin}`;
    el.style.borderRight = `1px solid ${thin}`;
    el.style.borderBottom = `1px solid ${thin}`;
    el.style.borderLeft = `4px solid ${accent}`;
    el.style.borderRadius =
      cs.borderRadius && cs.borderRadius !== "0px" ? cs.borderRadius : "6px";
    el.style.padding =
      cs.padding && cs.padding !== "0px" ? cs.padding : "12px 16px";
    el.style.margin = "0.75em 0";
    el.style.boxSizing = "border-box";
  }
}

function appendBorders(computed: CSSStyleDeclaration, parts: string[]): void {
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const width = computed.getPropertyValue(`border-${side}-width`).trim();
    const style = computed.getPropertyValue(`border-${side}-style`).trim();
    const color = computed.getPropertyValue(`border-${side}-color`).trim();
    if (!width || width === "0px" || !style || style === "none") {
      continue;
    }
    parts.push(
      `border-${side}:${width} ${style} ${toOpaqueCssColor(color)}`,
    );
  }
}

function appendSafeDisplay(computed: CSSStyleDeclaration, parts: string[]): void {
  let display = computed.getPropertyValue("display").trim();
  if (display === "inline-flex") {
    display = "inline-block";
  }
  if (SAFE_DISPLAY.has(display)) {
    parts.push(`display:${display}`);
  }
}

function appendGradientBackground(
  computed: CSSStyleDeclaration,
  parts: string[],
): void {
  const image = computed.getPropertyValue("background-image").trim();
  if (!image || image === "none") {
    return;
  }
  // 只保留渐变，丢掉 url(...) 装饰图（公众号里往往无效还占地方）
  if (/gradient\(/i.test(image) && !/url\(/i.test(image)) {
    parts.push(`background-image:${image}`);
  }
}

function collectStyle(el: HTMLElement): string {
  const computed = getComputedStyle(el);
  const parts: string[] = [];

  for (const prop of VISUAL_PROPS) {
    let value = computed.getPropertyValue(prop).trim();
    if (!value || isDefaultish(prop, value) || value.includes("var(")) {
      continue;
    }
    if (value.includes("color-mix(")) {
      continue;
    }
    if (prop === "background-color" || prop.endsWith("-color")) {
      value = toOpaqueCssColor(value);
    }
    parts.push(`${prop}:${value}`);
  }

  appendBorders(computed, parts);
  appendSafeDisplay(computed, parts);
  appendGradientBackground(computed, parts);

  return parts.join(";");
}

function inlineComputedStyles(root: HTMLElement): void {
  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of elements) {
    // 跳过最终会被丢掉的标签
    if (el.tagName === "BR" || el.tagName === "WBR") {
      continue;
    }
    const style = collectStyle(el);
    if (style) {
      el.setAttribute("style", style);
    } else {
      el.removeAttribute("style");
    }
  }
}

function stripAttrs(root: HTMLElement): void {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    const keep = new Set([
      "style",
      "src",
      "href",
      "alt",
      "title",
      "colspan",
      "rowspan",
    ]);
    for (const attr of Array.from(el.attributes)) {
      if (!keep.has(attr.name.toLowerCase())) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

function rootSectionStyle(render: HTMLElement): string {
  const cs = getComputedStyle(render);
  const parts: string[] = [
    "max-width:100%",
    "margin:0 auto",
    "padding:0",
    "box-sizing:border-box",
    "word-wrap:break-word",
  ];
  for (const prop of [
    "color",
    "background-color",
    "font-size",
    "font-family",
    "line-height",
    "letter-spacing",
  ] as const) {
    const value = cs.getPropertyValue(prop).trim();
    if (!value || isDefaultish(prop, value) || value.includes("var(")) {
      continue;
    }
    parts.push(`${prop}:${value}`);
  }
  return parts.join(";");
}

function buildOffscreenHost(themeClass: string): HTMLElement {
  const host = document.createElement("div");
  host.className = themeClass.replace(/\bpenna-dark\b/g, "").trim();
  host.setAttribute(
    "style",
    [
      "position:fixed",
      "left:-99999px",
      "top:0",
      "width:677px",
      "pointer-events:none",
      "opacity:0",
      "z-index:-1",
    ].join(";"),
  );
  return host;
}

function getPreviewRender(): { appRoot: HTMLElement; render: HTMLElement } {
  const appRoot = document.querySelector<HTMLElement>("#penna-root");
  if (!appRoot) {
    throw new Error("无法找到编辑器根节点");
  }
  const render =
    appRoot.querySelector<HTMLElement>(".penna-preview .penna-render") ??
    appRoot.querySelector<HTMLElement>(".penna-render");
  if (!render) {
    throw new Error("无法找到预览内容");
  }
  return { appRoot, render };
}

async function writeClipboardHtml(html: string, plain: string): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    }),
  ]);
}

/**
 * 将当前预览复制为公众号可粘贴的富文本。
 */
export async function copyToWechat(): Promise<CopyToWechatResult> {
  const { appRoot, render } = getPreviewRender();
  const host = buildOffscreenHost(appRoot.className);
  const clone = render.cloneNode(true) as HTMLElement;
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    void host.offsetHeight;

    removeJunk(clone);
    flattenCodeLines(clone);
    replaceCheckboxes(clone);
    const sectionStyle = rootSectionStyle(clone);
    inlineComputedStyles(clone);
    protectCodeWhitespace(clone);
    reinforceCodeBlocks(clone);
    reinforceAlerts(clone);
    const localImageCount = fixImages(clone);
    fixTables(clone);
    stripAttrs(clone);

    const section = document.createElement("section");
    section.setAttribute("style", sectionStyle);
    while (clone.firstChild) {
      section.appendChild(clone.firstChild);
    }

    await writeClipboardHtml(
      section.outerHTML,
      section.innerText || section.textContent || "",
    );

    return { localImageCount };
  } finally {
    host.remove();
  }
}
