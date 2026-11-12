import Prism from "prismjs";
// Grammars used in the vault (text, markdown, bash, powershell, yaml, html) plus common neighbours.
// Core Prism already includes markup, css, clike and javascript.
import "prismjs/components/prism-bash";
import "prismjs/components/prism-batch";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-python";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Produces the DOM that Wiki.js ends up with after its server renderer and client-side Prism
 * (line-numbers, toolbar and copy-to-clipboard plugins) have all run, e.g. for ```yaml:
 *   <div class="code-toolbar"><pre class="prismjs line-numbers language-yaml">
 *   <code class="language-yaml">…tokens…<span aria-hidden="true" class="line-numbers-rows">
 *   <span></span>…</span></code></pre><div class="toolbar">…<button>Copy</button>…</div></div>
 * A bare fence keeps Prism's quirk: code class "language- language-none".
 */
export function highlightFence(content: string, lang: string, dataLine?: string | null): string {
  const lineAttr = dataLine ? ` data-line="${escapeHtml(dataLine)}"` : "";

  if (lang === "diagram") {
    // Wiki.js stores draw.io diagrams as base64 SVG inside the fence.
    return `<pre class="diagram"${lineAttr}>${decodeBase64(content)}</pre>`;
  }

  const code = content.replace(/\n$/, "");
  const prismLang = /^[\w-]+$/.test(lang) ? lang.toLowerCase() : "none";
  const codeClass = prismLang === "none" ? `language-${escapeHtml(lang)} language-none`.trimStart() : `language-${prismLang}`;
  // Prism.languages also holds helpers (extend, insertBefore, DFS); only objects are grammars.
  const candidate: unknown = Object.hasOwn(Prism.languages, prismLang) ? Prism.languages[prismLang] : undefined;
  const grammar = candidate && typeof candidate === "object" ? (candidate as Prism.Grammar) : undefined;
  const highlighted = grammar ? Prism.highlight(code, grammar, prismLang) : escapeHtml(code);
  const rows = "<span></span>".repeat(code.split("\n").length);

  // Prism's toolbar + copy-to-clipboard plugins wrap every highlighted block on the live site.
  return (
    `<div class="code-toolbar"${lineAttr}><pre class="prismjs line-numbers language-${prismLang}">` +
    `<code class="${codeClass}">${highlighted}` +
    `<span aria-hidden="true" class="line-numbers-rows">${rows}</span></code></pre>` +
    `<div class="toolbar"><div class="toolbar-item"><button>Copy</button></div></div></div>`
  );
}

function decodeBase64(text: string): string {
  try {
    return Buffer.from(text.trim(), "base64").toString("utf8");
  } catch {
    return "";
  }
}
