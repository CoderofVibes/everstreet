// Job 003s1: a disposable local preview (scripts/preview-*.ts) declares itself by setting
// window.__everstreetPreview before the app loads; the shell then shows a persistent strip so a
// capture of synthetic evidence can't be mistaken for testnet proof. The app never sets it, and it
// changes no behaviour: it is a label only (no signer, no key, no fallback).

export interface PreviewLabel {
  label: string;
  detail: string;
}

export function previewLabel(): PreviewLabel | null {
  const v = (globalThis as { __everstreetPreview?: unknown }).__everstreetPreview;
  if (!v || typeof v !== "object") return null;
  const { label, detail } = v as { label?: unknown; detail?: unknown };
  if (typeof label !== "string" || !label.trim() || label.length > 160) return null;
  return {
    label,
    detail: typeof detail === "string" && detail.length <= 600 ? detail : "",
  };
}
