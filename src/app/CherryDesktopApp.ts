import {
  Cherry,
  DEFAULT_TOOLBAR_ITEMS,
  type CherryOptions,
  type EditorOptions,
  type SideBarOptions,
  type ToolbarItem,
} from "cherry-markdown-next";
import "cherry-markdown-next/editor.css";
import "cherry-markdown-next/transformer.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Menu } from "@tauri-apps/api/menu";
import { stat } from "@tauri-apps/plugin-fs";
import { CherryAi } from "../host/CherryAi";
import { CherryConfig, type UploadMode } from "../host/CherryConfig";
import { CherryUploader } from "../host/CherryUploader";
import { DocumentSession } from "./DocumentSession";
import { exportHtml, exportPdf } from "./exportDocument";
import { SettingsPanel } from "./SettingsPanel";
import "../themes.css";
import "../styles.css";

interface EditorChangePayload {
  markdown: string;
}

interface CherryBoot {
  text: string;
  appearance: "light" | "dark";
  layout: string;
  theme: string;
  statusbar: boolean;
  sidebar: boolean;
  lineNumbers: boolean;
  uploadEnabled: boolean;
  aiEnabled: boolean;
}


function resolveAppearance(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export class CherryDesktopApp {
  private readonly root: HTMLElement;
  private readonly config = new CherryConfig();
  private readonly session = new DocumentSession();
  private readonly settings: SettingsPanel;
  private editor: Cherry | null = null;
  private applyingExternalUpdate = false;

  constructor() {
    const rootEl = document.getElementById("cherry-root");
    if (!rootEl) {
      throw new Error("Missing #cherry-root");
    }
    this.root = rootEl;
    this.settings = new SettingsPanel(this.config, () => {
      this.createEditor(this.buildBoot());
    });
  }

  async start(): Promise<void> {
    await this.config.load();
    try {
      await this.setupMenu();
    } catch (error) {
      console.warn("[cherry-desktop] menu setup failed", error);
    }
    this.bindWindowEvents();
    this.bindAppearanceWatcher();
    
    // 先处理启动参数和拖拽事件加载文件
    await this.bindOpenFileEvents();
    
    // 如果没有通过启动参数创建出编辑器，则用空文档兜底创建
    if (!this.editor) {
      this.createEditor(this.buildBoot());
    }
    
    await this.session.refreshTitle();
  }



  private isUploadEnabled(): boolean {
    const mode = this.config.getItem<UploadMode>("upload.mode", "off");
    if (mode === "off") {
      return false;
    }
    if (mode === "script") {
      return Boolean(this.config.getItem<string>("upload.script", "").trim());
    }
    return true;
  }

  private buildBoot(): CherryBoot {
    return {
      text: this.session.getText(),
      appearance: resolveAppearance(),
      layout: this.config.getItem<string>("ui.layout", "split"),
      theme: this.config.getItem<string>("ui.theme", "default"),
      statusbar: this.config.getItem<boolean>("ui.statusbar", true),
      sidebar: this.config.getItem<boolean>("ui.sidebar", true),
      lineNumbers: this.config.getItem<boolean>("ui.lineNumbers", true),
      uploadEnabled: this.isUploadEnabled(),
      aiEnabled: this.config.getItem<boolean>("ai.enabled", false),
    };
  }



  private buildEditorOptions(boot: CherryBoot): EditorOptions {
    const editorOptions: EditorOptions = {
      value: boot.text,
      lineNumbers: boot.lineNumbers,
    };

    if (boot.uploadEnabled) {
      // 拦截默认 Web 上传行为，将本地文件读取操作转交给 Tauri 原生 IPC 处理
      editorOptions.onParseFile = async (file) => {
        try {
          const path = this.session.getPath();
          if (!path) {
            throw new Error("请先保存文档后再上传本地文件");
          }
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          return await new CherryUploader(path, this.config).upload({
            name: file.name,
            mime: file.type,
            bytes,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await message(`上传失败: ${msg}`, {
            title: "上传失败",
            kind: "error",
          });
          throw error;
        }
      };
    }

    if (boot.aiEnabled) {
      editorOptions.onAiRequest = async (
        action,
        selected,
        prompts,
        onUpdate,
      ) => {
        try {
          return await new CherryAi(this.config).request(
            action,
            selected,
            prompts,
            onUpdate,
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await message(`AI 请求失败: ${msg}`, {
            title: "AI 失败",
            kind: "error",
          });
          throw error;
        }
      };
    }

    return editorOptions;
  }

  private buildSidebarOptions(enabled: boolean): SideBarOptions | boolean {
    if (!enabled) {
      return false;
    }
    if (!this.session.getFolderRoot()) {
      // 无工作区：只显示大纲（编辑器默认行为）
      return true;
    }
    return {
      fetchFiles: () => this.session.listWorkspaceFiles(),
      onFileClick: (fileId) => {
        void this.handleSidebarFileClick(fileId);
      },
    };
  }

  private createEditor(boot: CherryBoot): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }

    const options: CherryOptions = {
      layout: boot.layout as CherryOptions["layout"],
      appearance: boot.appearance,
      themeId: boot.theme,
      statusbar: boot.statusbar,
      sidebar: this.buildSidebarOptions(boot.sidebar),
      // 核心改造：弃用 Web 端工具栏，由 Tauri 原生系统菜单完全接管格式化操作
      toolbar: false,
      preview: {
        maxWidth: "800px",
      },
      editor: this.buildEditorOptions(boot),
    };

    this.editor = new Cherry(this.root, options);
    this.editor.eventBus.on("editor:change", (payload: EditorChangePayload) => {
      if (this.applyingExternalUpdate) {
        return;
      }
      // 初始化 / setMarkdown 也会冒泡 change；内容没变就别标 dirty
      if (payload.markdown === this.session.getText()) {
        return;
      }
      this.session.setText(payload.markdown, true);
    });

    const activePath = this.session.getPath();
    if (activePath) {
      this.editor.setSidebarActiveFile(activePath);
    }
  }

  /**
   * 同步 CodeMirror 内部状态到本地 DocumentSession。
   * 必须在文件保存或窗口关闭前调用，以确保拿到最新内容。
   */
  private syncFromEditor(): void {
    if (!this.editor) {
      return;
    }
    const markdown = this.editor.getMarkdown();
    if (markdown !== this.session.getText()) {
      this.session.setText(markdown, true);
    }
  }

  /**
   * 递归转换器：将 Cherry Markdown 的 Web 工具栏 JSON 配置，
   * 一比一映射转换为 Tauri 的原生菜单系统（包括多级子菜单和快捷键）。
   */
  private mapCherryToolbarToTauriItems(items: ToolbarItem[], run: (cmd: string) => () => void): any[] {
    const ACCELERATORS: Record<string, string> = {
      bold: "CmdOrCtrl+B",
      italic: "CmdOrCtrl+I",
      strikethrough: "CmdOrCtrl+Shift+X",
      underline: "CmdOrCtrl+U",
      code: "CmdOrCtrl+E",
      heading1: "CmdOrCtrl+1",
      heading2: "CmdOrCtrl+2",
      heading3: "CmdOrCtrl+3",
      blockquote: "CmdOrCtrl+Shift+Q",
      unorderedList: "CmdOrCtrl+Shift+U",
      // 不要用 Shift+O：和「打开文件夹」冲突
      orderedList: "CmdOrCtrl+Shift+7",
      taskList: "CmdOrCtrl+Shift+C",
      link: "CmdOrCtrl+K",
      image: "CmdOrCtrl+Shift+I",
      table: "CmdOrCtrl+Shift+T",
      math: "CmdOrCtrl+Shift+M",
      codeBlockBasic: "CmdOrCtrl+Shift+P",
    };

    const result: any[] = [];
    for (const item of items) {
      if ("type" in item && item.type === "separator") {
        result.push({ item: "Separator" });
      } else if (("type" in item && item.type === "menu") || "children" in item) {
        const menu = item as any;
        if (!menu.children || menu.children.length === 0) continue;
        result.push({
          text: menu.label || menu.id,
          items: this.mapCherryToolbarToTauriItems(menu.children, run),
        });
      } else {
        const btn = item as any;
        const resItem: any = {
          text: btn.label || btn.id,
          action: run(btn.id),
        };
        if (ACCELERATORS[btn.id]) {
          resItem.accelerator = ACCELERATORS[btn.id];
        }
        result.push(resItem);
      }
    }
    return result;
  }

  private async setupMenu(): Promise<void> {
    const appIcon = await defaultWindowIcon();
    const run = (cmd: string) => () => { this.editor?.runCommand(cmd); };
    
    const dynamicItems = this.mapCherryToolbarToTauriItems(DEFAULT_TOOLBAR_ITEMS, run);

    const menu = await Menu.new({
      items: [
        {
          text: "Cherry Markdown Next",
          items: [
            {
              item: {
                About: {
                  name: "Cherry Markdown Next",
                  icon: appIcon ?? undefined,
                },
              },
              text: "关于 Cherry Markdown Next",
            },
            { item: "Separator" },
            {
              text: "设置…",
              accelerator: "CmdOrCtrl+,",
              action: () => this.settings.open(),
            },
            { item: "Separator" },
            { item: "Hide", text: "隐藏" },
            { item: "HideOthers", text: "隐藏其他" },
            { item: "ShowAll", text: "全部显示" },
            { item: "Separator" },
            { item: "Quit", text: "退出" },
          ],
        },
        {
          text: "文件",
          items: [
            {
              text: "新建",
              accelerator: "CmdOrCtrl+N",
              action: () => {
                void this.handleNew();
              },
            },
            {
              text: "打开文件夹…",
              accelerator: "CmdOrCtrl+Shift+O",
              action: () => {
                void this.handleOpenFolder();
              },
            },
            {
              text: "打开文件…",
              accelerator: "CmdOrCtrl+O",
              action: () => {
                void this.handleOpen();
              },
            },
            { item: "Separator" },
            {
              text: "保存",
              accelerator: "CmdOrCtrl+S",
              action: () => {
                void this.handleSave();
              },
            },
            {
              text: "另存为…",
              accelerator: "CmdOrCtrl+Shift+S",
              action: () => {
                void this.handleSaveAs();
              },
            },
            { item: "Separator" },
            {
              text: "导出 HTML…",
              action: () => {
                void this.handleExportHtml();
              },
            },
            {
              text: "导出 PDF…",
              action: () => {
                void this.handleExportPdf();
              },
            },
          ],
        },
        {
          text: "编辑",
          items: [
            { item: "Undo", text: "撤销" },
            { item: "Redo", text: "重做" },
            { item: "Separator" },
            { item: "Cut", text: "剪切" },
            { item: "Copy", text: "复制" },
            { item: "Paste", text: "粘贴" },
            { item: "SelectAll", text: "全选" },
          ],
        },
        {
          text: "视图",
          items: [
            { item: "Minimize", text: "最小化" },
            { item: "Maximize", text: "最大化" },
            { item: "Fullscreen", text: "进入全屏" },
            { item: "Separator" },
            { item: "CloseWindow", text: "关闭窗口" },
          ],
        },
        ...dynamicItems,
      ],
    });
    await menu.setAsAppMenu();
  }

  /**
   * 拦截窗口的物理关闭事件（红叉/Cmd+Q）。
   * 必须在这里做脏状态检查（弹窗询问是否保存），否则未保存的内容将随进程直接丢失。
   */
  private bindWindowEvents(): void {
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          void this.handleSaveAs();
        } else {
          void this.handleSave();
        }
      }
    });

    void getCurrentWindow().onCloseRequested(async (event) => {
      this.syncFromEditor();
      if (!(await this.session.confirmDiscard())) {
        event.preventDefault();
      }
    });

    void getCurrentWindow().onDragDropEvent(async (event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          const path = paths[0]; // 只处理第一个拖拽的文件或文件夹
          try {
            const info = await stat(path);
            this.syncFromEditor();
            if (info.isDirectory) {
              if (await this.session.openFolder(path)) {
                this.createEditor(this.buildBoot());
              }
            } else if (info.isFile && isMarkdownPath(path)) {
              if (await this.session.openDocument(path)) {
                this.updateEditorContent();
              }
            }
          } catch (error) {
            console.error("[cherry-desktop] drag drop handle failed", error);
          }
        }
      }
    });
  }

  private bindAppearanceWatcher(): void {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const appearance = resolveAppearance();
      this.editor?.theme.setLightDark(appearance);
    };
    media.addEventListener("change", apply);
  }



  private async bindOpenFileEvents(): Promise<void> {
    await listen<string[]>("open-files", (event) => {
      void this.openIncomingFiles(event.payload);
    });

    try {
      const startup = await invoke<string[]>("get_startup_files");
      await this.openIncomingFiles(startup);
    } catch (error) {
      console.warn("[cherry-desktop] get_startup_files failed", error);
    }
  }

  private async openIncomingFiles(paths: string[]): Promise<void> {
    const file = paths.find((path) => isMarkdownPath(path));
    if (!file) {
      return;
    }
    if (await this.session.openDocument(file)) {
      this.updateEditorContent();
    }
  }

  /** 
   * 仅更新内容与激活侧边栏文件，避免昂贵的 createEditor DOM 重建。
   */
  private updateEditorContent(): void {
    if (!this.editor) {
      this.createEditor(this.buildBoot());
      return;
    }
    this.editor.setMarkdown(this.session.getText());
    const activePath = this.session.getPath();
    if (activePath) {
      this.editor.setSidebarActiveFile(activePath);
    }
  }

  private async handleNew(): Promise<void> {
    this.syncFromEditor();
    if (await this.session.newDocument()) {
      this.updateEditorContent();
    }
  }

  private async handleOpenFolder(): Promise<void> {
    this.syncFromEditor();
    if (await this.session.openFolder()) {
      this.createEditor(this.buildBoot());
    }
  }

  private async handleSidebarFileClick(fileId: string): Promise<void> {
    if (fileId === this.session.getPath()) {
      return;
    }
    this.syncFromEditor();
    if (await this.session.openDocument(fileId)) {
      this.updateEditorContent();
    }
  }

  private async handleOpen(): Promise<void> {
    this.syncFromEditor();
    if (await this.session.openDocument()) {
      this.updateEditorContent();
    }
  }

  private async handleSave(): Promise<void> {
    this.syncFromEditor();
    try {
      await this.session.save();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await message(`保存失败: ${msg}`, { title: "保存失败", kind: "error" });
    }
  }

  private async handleSaveAs(): Promise<void> {
    this.syncFromEditor();
    try {
      await this.session.saveAs();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await message(`另存为失败: ${msg}`, {
        title: "另存为失败",
        kind: "error",
      });
    }
  }

  private async handleExportHtml(): Promise<void> {
    this.syncFromEditor();
    try {
      const ok = await exportHtml(this.session.getPath());
      if (ok) {
        await message("HTML 已导出", { title: "导出成功", kind: "info" });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await message(`导出 HTML 失败: ${msg}`, {
        title: "导出失败",
        kind: "error",
      });
    }
  }

  private async handleExportPdf(): Promise<void> {
    this.syncFromEditor();
    try {
      await exportPdf(this.session.getPath());
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await message(`导出 PDF 失败: ${msg}`, {
        title: "导出失败",
        kind: "error",
      });
    }
  }
}
