import { Cherry, DEFAULT_TOOLBAR_ITEMS, type CherryOptions } from "cherry-markdown-next";
import "cherry-markdown-next/editor.css";
import "cherry-markdown-next/transformer.css";

class CherryDesktopApp {
  private readonly root: HTMLElement;
  private editor: Cherry | null = null;

  constructor() {
    const rootEl = document.getElementById("cherry-root");
    if (!rootEl) {
      throw new Error("Missing #cherry-root");
    }
    this.root = rootEl;
    this.createEditor();
  }

  private createEditor(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }

    const options: CherryOptions = {
      layout: "split",
      appearance: "light",
      themeId: "default",
      statusbar: true,
      sidebar: true,
      toolbar: {
        items: [...DEFAULT_TOOLBAR_ITEMS]
      },
      preview: {
        maxWidth: "720px",
      },
      editor: {
        value: "# Hello Cherry Markdown Desktop\\n\\nWelcome to your new Markdown editor.",
        lineNumbers: true,
      },
    };

    this.editor = new Cherry(this.root, options);
  }
}

new CherryDesktopApp();
