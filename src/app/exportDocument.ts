import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { basename } from "../host/path";

function collectInlineStyles(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((el) => el.textContent ?? "")
    .filter(Boolean)
    .join("\n");
}

function getPreviewHtml(): string {
  const root =
    document.querySelector<HTMLElement>(
      "#cherry-root .cherry-preview .cherry-render",
    ) ??
    document.querySelector<HTMLElement>("#cherry-root .cherry-preview");
  return root?.innerHTML?.trim() || "<p></p>";
}

function buildExportHtml(title: string, bodyHtml: string): string {
  const styles = collectInlineStyles();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; overflow: scroll!important;}
    .cherry-export { max-width: 800px; margin: 0 auto; }
    ${styles}
    @media print {
      body { padding: 0; }
      .cherry-export { max-width: none; }
    }
  </style>
</head>
<body>
  <article class="cherry-export cherry-render cherry-preview">${bodyHtml}</article>
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

function defaultExportName(docPath: string | null, ext: string): string {
  if (docPath) {
    const name = basename(docPath).replace(/\.(md|markdown)$/i, "");
    return `${name || "export"}.${ext}`;
  }
  return `export.${ext}`;
}

export async function exportHtml(docPath: string | null): Promise<boolean> {
  const title = docPath ? basename(docPath) : "Cherry Markdown";
  const html = buildExportHtml(title, getPreviewHtml());
  const target = await save({
    defaultPath: defaultExportName(docPath, "html"),
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!target) {
    return false;
  }
  await writeTextFile(target, html);
  return true;
}

export async function exportPdf(docPath: string | null): Promise<void> {
  const bodyHtml = getPreviewHtml();
  const styles = collectInlineStyles();

  // Create a container that is ONLY visible during print
  const container = document.createElement("div");
  container.id = "cherry-print-container";
  container.innerHTML = `
    <div class="cherry-export cherry-render cherry-preview">${bodyHtml}</div>
  `;
  document.body.appendChild(container);

  // Inject print styles
  const styleEl = document.createElement("style");
  styleEl.id = "cherry-print-style";
  styleEl.textContent = `
    @media screen {
      #cherry-print-container { display: none !important; }
    }
    @media print {
      #cherry-root { display: none !important; }
      #cherry-print-container { display: block !important; background: #fff; color: #1f2328; width: 100%; }
      .cherry-export { max-width: none !important; margin: 0 !important; }
      ${styles}
    }
  `;
  document.head.appendChild(styleEl);

  // Give the browser a tick to apply styles
  await new Promise((resolve) => setTimeout(resolve, 100));

  const cleanup = () => {
    if (container.parentNode) container.remove();
    if (styleEl.parentNode) styleEl.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  
  window.addEventListener("afterprint", cleanup);
  
  try {
    window.print();
  } catch (e) {
    cleanup();
    throw e;
  }
  
  // Fallback cleanup in case afterprint doesn't fire
  window.setTimeout(cleanup, 5000);
}
