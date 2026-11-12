interface Resource { readonly scheme: string; toString(): string }
interface RefreshableView {
  readonly kind: "editor" | "preview";
  readonly panel: { readonly active: boolean };
  readonly doc?: { readonly uri: Resource };
  refresh(): void;
}

/** Resolve command-palette, keyboard and editor-title invocations to the displayed document. */
export function refreshViews(views: Iterable<RefreshableView>, resource?: Resource, source?: Resource): boolean {
  const all = [...views];
  // The single FollowingPreview has a synthetic editor resource, unlike custom editors.
  // Title actions can come from an inactive group, so do not substitute the active document.
  const target = resource?.scheme === "webview-panel"
    ? all.find(view => view.kind === "preview")?.doc?.uri
    : resource ?? all.find(view => view.panel.active)?.doc?.uri ?? source;
  if (!target) return false;
  const matches = all.filter(view => view.doc?.uri.toString() === target.toString());
  for (const view of matches) view.refresh();
  return matches.length > 0;
}
