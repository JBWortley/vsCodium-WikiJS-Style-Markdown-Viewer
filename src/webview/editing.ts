import type { EditTarget } from "../editing/edits";
import type { RenderedPage } from "../render/page";
import type { FromWebview, ToWebview } from "../render/protocol";

export interface SavedDraft { target: EditTarget; text: string }
export type SavedDrafts = Record<string, SavedDraft>;

/** UI changes are drafts until the host accepts a targeted document edit. */
export class BlockEditor {
  private uri?: string;
  private targets = new Map<string, EditTarget>();
  private draft?: { target: EditTarget; box: HTMLElement; text: HTMLTextAreaElement; error: HTMLElement; apply: HTMLButtonElement; cancel: HTMLButtonElement };
  private pending?: string;
  private restore: (() => void)[] = [];
  private errorBox?: HTMLElement;

  constructor(
    private readonly post: (message: FromWebview) => void,
    private readonly drafts: SavedDrafts,
    private readonly save: (drafts: SavedDrafts) => void,
    private readonly flush: () => void,
  ) {
    document.addEventListener("dblclick", event => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || element.closest("a,button,input,textarea,select,.wk-block-editor")) return;
      if (this.openElement(element)) { event.preventDefault(); event.stopPropagation(); }
    });
    document.addEventListener("keydown", event => {
      const element = event.target instanceof Element ? event.target : null;
      if (event.key === "F2" && element && !element.closest("input,textarea,select,.wk-block-editor")) {
        if (this.openElement(element)) { event.preventDefault(); event.stopPropagation(); }
      }
    });
  }

  /** Freeze only this page's DOM while editing, retaining the latest render in preview.ts. */
  defer(uri: string): boolean { return uri === this.uri && (!!this.draft || !!this.pending); }

  detach(): void {
    this.persist();
    this.draft?.box.remove();
    this.draft = undefined;
    this.errorBox?.remove();
    this.errorBox = undefined;
    for (const restore of this.restore.splice(0)) restore();
    this.pending = undefined;
  }

  attach(page: RenderedPage, uri: string): void {
    this.uri = uri;
    this.targets = new Map((page.editTargets ?? []).map(t => [t.id, t]));
    if (!this.targets.size) return;
    const contents = document.getElementById("wk-contents")!;
    for (const el of contents.querySelectorAll<HTMLElement>("[data-wk-edit]")) {
      const target = this.targets.get(el.dataset.wkEdit ?? "");
      if (!target) continue;
      const previous = el.getAttribute("tabindex");
      if (previous === null) {
        el.tabIndex = 0;
        this.restore.push(() => el.removeAttribute("tabindex"));
      }
      if (el.tagName === "IFRAME" || el.classList.contains("wk-embed-blocked")) {
        const button = this.button("Edit HTML", "wk-edit-frame", () => this.open(target, el));
        el.before(button);
        this.restore.push(() => button.remove());
      }
    }
    for (const el of contents.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-wk-check]')) {
      const target = this.targets.get(el.dataset.wkCheck ?? "");
      if (target?.kind !== "checkbox") continue;
      const disabled = el.getAttribute("disabled");
      el.disabled = false;
      el.setAttribute("aria-label", "Toggle checkbox");
      this.restore.push(() => {
        if (disabled !== null) el.setAttribute("disabled", disabled); else el.removeAttribute("disabled");
        el.removeAttribute("aria-label");
      });
    }
    const fm = document.getElementById("wk-frontmatter")!;
    const attributes = [...this.targets.values()].find(t => t.kind === "frontmatter");
    const tools = document.createElement("div");
    tools.className = "wk-edit-tools";
    const hint = document.createElement("span");
    hint.textContent = "Double-click text · Shift-click objects · F2 to edit";
    tools.append(hint);
    if (attributes) tools.append(this.button("Edit attributes", "wk-edit-attributes", () => this.open(attributes, fm)));
    fm.before(tools);
    this.restore.push(() => tools.remove());
    const saved = this.drafts[uri];
    if (saved) {
      const anchor = this.findElement(saved.target.id) ?? contents;
      this.open(saved.target, anchor, saved.text);
    }
  }

  handleClick(event: MouseEvent): boolean {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.closest(".wk-block-editor,.wk-edit-tools,.wk-edit-frame")) return false;
    if (event.shiftKey && this.openElement(element)) {
      event.preventDefault(); event.stopPropagation(); return true;
    }
    const checkbox = element.closest<HTMLInputElement>('input[type="checkbox"][data-wk-check]');
    const target = checkbox && this.targets.get(checkbox.dataset.wkCheck ?? "");
    if (!checkbox || target?.kind !== "checkbox") return false;
    event.stopPropagation();
    if (this.draft || this.pending) {
      event.preventDefault();
      this.draft?.text.focus();
      return true;
    }
    this.pending = target.id;
    checkbox.disabled = true;
    this.post({ type: "edit", id: target.id, checked: checkbox.checked });
    return true;
  }

  result(message: Extract<ToWebview, { type: "editResult" }>): void {
    if (message.id !== this.pending) return;
    this.pending = undefined;
    if (this.draft) {
      this.draft.apply.disabled = false;
      this.draft.cancel.disabled = false;
      this.draft.text.readOnly = false;
      if (!message.ok) {
        this.draft.error.textContent = message.message ?? "The change could not be applied.";
        this.persist();
        return;
      }
      this.close();
    } else {
      const checkbox = this.findElement(message.id, "data-wk-check") as HTMLInputElement | null;
      if (checkbox) {
        checkbox.disabled = false;
        if (!message.ok) checkbox.checked = this.targets.get(message.id)?.checked ?? false;
      }
      if (!message.ok) {
        this.errorBox?.remove();
        this.errorBox = document.createElement("p");
        this.errorBox.className = "wk-edit-error";
        this.errorBox.setAttribute("role", "alert");
        this.errorBox.textContent = message.message ?? "The checkbox could not be changed.";
        document.getElementById("wk-frontmatter")?.after(this.errorBox);
      }
      this.flush();
    }
  }

  private findElement(id: string, attr = "data-wk-edit"): HTMLElement | null {
    return Array.from(document.querySelectorAll<HTMLElement>(`#wk-contents [${attr}]`)).find(el => el.getAttribute(attr) === id) ?? null;
  }

  private openElement(element: Element): boolean {
    const el = element.closest<HTMLElement>("[data-wk-edit]");
    const target = el && this.targets.get(el.dataset.wkEdit ?? "");
    if (!el || !target || target.kind === "checkbox") return false;
    this.open(target, el);
    return true;
  }

  private open(target: EditTarget, anchor: HTMLElement, savedText?: string): void {
    if (this.draft) { this.draft.text.focus(); return; }
    if (this.pending) return;
    const box = document.createElement("section");
    box.className = "wk-block-editor";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", target.label);
    const label = document.createElement("label");
    label.textContent = target.label;
    const text = document.createElement("textarea");
    text.setAttribute("aria-label", target.label);
    text.spellcheck = false;
    text.value = savedText ?? (target.kind === "frontmatter" && !target.source ? "---\ntitle: \n---" : target.source);
    text.rows = Math.max(4, Math.min(20, text.value.split("\n").length + 1));
    label.append(text);
    const actions = document.createElement("div");
    actions.className = "wk-edit-actions";
    const apply = this.button("Apply", "wk-edit-apply", () => {
      if (!this.draft || this.pending) return;
      this.pending = target.id;
      apply.disabled = cancel.disabled = true;
      text.readOnly = true;
      this.persist();
      this.post({ type: "edit", id: target.id, text: text.value });
    });
    apply.dataset.action = "apply";
    const cancel = this.button("Cancel", "wk-edit-cancel", () => this.close());
    cancel.dataset.action = "cancel";
    const help = document.createElement("span");
    help.textContent = "Apply to document · Ctrl+Enter to apply · Esc to cancel · Save as usual";
    actions.append(apply, cancel, help);
    const error = document.createElement("div");
    error.className = "wk-edit-error";
    error.setAttribute("role", "alert");
    box.append(label, actions, error);
    // Never insert controls inside SVG, tables or paragraphs; keep valid HTML structure.
    let container: HTMLElement = anchor;
    const contents = document.getElementById("wk-contents");
    while (container.parentElement && container.parentElement !== contents && container !== contents && !container.matches("#wk-frontmatter")) container = container.parentElement;
    container.after(box);
    this.draft = { target, box, text, error, apply, cancel };
    text.addEventListener("input", () => this.persist());
    box.addEventListener("keydown", event => {
      // Keep textarea Undo/Redo in the draft; the workbench's custom-editor history handler
      // would otherwise undo an already-applied document edit as well.
      if (event.target === text && (event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) event.stopPropagation();
      if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
        event.preventDefault(); event.stopPropagation();
        if (this.pending) return;
        if (event.key === "Escape") this.close(); else apply.click();
      }
    });
    text.focus({ preventScroll: true });
    this.persist();
  }

  private close(): void {
    if (this.pending) return;
    const target = this.draft?.target;
    this.draft?.box.remove();
    this.draft = undefined;
    if (this.uri) delete this.drafts[this.uri];
    this.save(this.drafts);
    this.flush();
    if (target) this.findElement(target.id)?.focus({ preventScroll: true });
  }

  private persist(): void {
    if (this.uri && this.draft) {
      this.drafts[this.uri] = { target: this.draft.target, text: this.draft.text.value };
      this.save(this.drafts);
    }
  }

  private button(label: string, className: string, click: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); click(); });
    return button;
  }
}
