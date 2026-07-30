import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { basename, dirname, join } from "../host/path";

/**
 * index.html 里写死的标题。打印时要临时借用 `document.title`，用它还原。
 * 不能在导出时现场保存旧值：`afterprint` 万一没来（下面那两行残留清理说明这事发生过），
 * 下次导出就会把文档名当成「原标题」记住，标题从此漂着回不来。
 */
const APP_TITLE = document.title;

/**
 * 收集页面全部可用 CSS。
 * 主题样式由 Vite 打成 `<link rel="stylesheet">`，只扫 `<style>` 会丢主题。
 */
function collectDocumentStyles(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules?.length) {
        continue;
      }
      chunks.push(Array.from(rules, (rule) => rule.cssText).join("\n"));
    } catch {
      // 跨域 stylesheet 读不到 cssRules，跳过
    }
  }
  return chunks.join("\n");
}

/**
 * 导出只需要：主题 class 壳 + 预览内容层。
 * 不要整棵 `#penna-root`（会带上编辑器布局的 height/overflow 污染）。
 *
 * 摘掉 `penna-dark`：所有深色规则都靠这个 class 命中，
 * 深色 token 打到白纸上等于没有对比度。导出物恒定白天模式。
 */
function getExportRoot(): HTMLElement {
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

  const shell = document.createElement("article");
  shell.id = "penna-export";
  shell.className = appRoot.className.replace(/\bpenna-dark\b/g, "").trim();
  shell.appendChild(render.cloneNode(true));
  return shell;
}

/**
 * 导出壳的排版。HTML 导出与 PDF 打印必须共用同一份，
 * 否则两边的宽度 / 内边距会漂，导出结果和预览对不上。
 */
function exportShellCss(maxWidth: number): string {
  return `
    #penna-export {
      max-width: ${maxWidth}px;
      margin: 0 auto;
      padding: 24px;
      box-sizing: border-box;
      width: 100%;
      min-height: 100%;
      background: color-mix(in srgb, var(--penna-c-text-3) 8%, var(--penna-c-bg));
    }`;
}

/**
 * 打印态覆盖，同样两边共用。
 * 不指定 `@page size`：纸张由用户在打印对话框里选，这里不能替他决定。
 */
const EXPORT_PRINT_CSS = `
      @page {
        margin: 12mm;
      }
      html, body {
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
        position: static !important;
        margin: 0 !important;
        padding: 0 !important;
        background: transparent !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      #penna-export {
        max-width: none !important;
        margin: 0 !important;
        min-height: auto !important;
      }`;

function buildExportHtml(
  title: string,
  root: HTMLElement,
  maxWidth: number,
): string {
  const styles = collectDocumentStyles();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: auto !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
${exportShellCss(maxWidth)}
    ${styles}
    @media print {
${EXPORT_PRINT_CSS}
    }
  </style>
</head>
<body>
  ${root.outerHTML}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 导出物的文件名主干：去掉 Markdown 扩展名的文档名 */
function exportBaseName(docPath: string | null): string {
  if (!docPath) {
    return "export";
  }
  return basename(docPath).replace(/\.(md|markdown)$/i, "") || "export";
}

export async function exportHtml(
  docPath: string | null,
  maxWidth: number,
): Promise<boolean> {
  const title = docPath ? basename(docPath) : "Penna Markdown";
  const html = buildExportHtml(title, getExportRoot(), maxWidth);
  const fileName = `${exportBaseName(docPath)}.html`;
  const target = await save({
    // 带上目录，默认落在文档旁边
    defaultPath: docPath ? join(dirname(docPath), fileName) : fileName,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!target) {
    return false;
  }
  await writeTextFile(target, html);
  return true;
}

export async function exportPdf(
  docPath: string | null,
  maxWidth: number,
): Promise<void> {
  // 上一次打印若没收到 afterprint，残留节点会和本次内容叠加
  document.getElementById("penna-export")?.remove();
  document.getElementById("penna-print-isolation")?.remove();

  // 打印对话框「存储为 PDF」的默认文件名取自 document.title。
  // 窗口标题走的是 Tauri 原生 setTitle，和这里不是一回事，所以得自己借用。
  document.title = exportBaseName(docPath);

  const exportRoot = getExportRoot();
  document.body.appendChild(exportRoot);

  const style = document.createElement("style");
  style.id = "penna-print-isolation";
  style.textContent = `
    @media screen {
      #penna-export { display: none !important; }
    }
${exportShellCss(maxWidth)}
    @media print {
      /* 只留导出壳，编辑器 UI 全部退场 */
      body > *:not(#penna-export) {
        display: none !important;
      }
      #penna-export { display: block !important; }
${EXPORT_PRINT_CSS}
    }
  `;
  document.head.appendChild(style);

  const images = Array.from(exportRoot.querySelectorAll("img"));
  await Promise.all(images.map((img) => {
    img.removeAttribute("loading");
    if (img.complete) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
  }));

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  // 不能用定时器兜底：打印预览里改纸张 / 边距会按当前 DOM 重新排版，
  // 提前拆掉节点会让最终 PDF 和预览不一致。残留交给下次导出开头清。
  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    document.title = APP_TITLE;
    exportRoot.remove();
    style.remove();
  };

  window.addEventListener("afterprint", cleanup);

  try {
    await invoke("print_window");
  } catch (e) {
    cleanup();
    throw new Error(String(e));
  }
}
