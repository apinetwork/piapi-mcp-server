import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_ALLOWED_MEDIA_DOMAINS = ["https://piapi.ai", "https://*.piapi.ai"];
export const MEDIA_GALLERY_URI = "ui://piapi/media-gallery";

export function mediaDomainsFromEnvironment(value = process.env.PIAPI_MEDIA_RESOURCE_DOMAINS): string[] {
  const domains = (value ? value.split(",") : DEFAULT_ALLOWED_MEDIA_DOMAINS)
    .map((domain) => domain.trim())
    .filter((domain) => /^https:\/\/(?:\*\.)?[a-z0-9.-]+$/i.test(domain));
  return [...new Set(domains)];
}

export function mediaGalleryHtml(allowedDomains: string[]): string {
  const domainJson = JSON.stringify(allowedDomains).replace(/</g, "\\u003c");
  const script = readFileSync(fileURLToPath(new URL("../../ui/media-gallery.js", import.meta.url)), "utf8");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PiAPI media result</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; color: #1f2937; }
    body { margin: 0; padding: 12px; background: transparent; color: inherit; }
    .summary { font-size: 13px; color: #6b7280; margin-bottom: 10px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .card { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 12px; overflow: hidden; background: color-mix(in srgb, Canvas 92%, currentColor 8%); }
    .preview { width: 100%; max-height: 280px; object-fit: contain; display: block; background: #111827; }
    video.preview { aspect-ratio: 16 / 9; } audio { width: calc(100% - 24px); margin: 12px; }
    .model-preview { width: 100%; min-height: 240px; display: grid; place-items: center; background: #111827; }
    .model-canvas { width: 100%; height: 240px; display: block; touch-action: none; }
    .body { padding: 10px 12px 12px; }
    .kind { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
    .expiry { font-size: 12px; color: #6b7280; margin: 4px 0; }
    a { color: #2563eb; overflow-wrap: anywhere; font-size: 13px; }
    .empty { padding: 12px; border: 1px dashed color-mix(in srgb, currentColor 22%, transparent); border-radius: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div id="app" class="empty">Waiting for PiAPI media result…</div>
  <script>window.__PIAPI_MEDIA_RESOURCE_DOMAINS__ = ${domainJson};</script>
  <script>${script}</script>
</body>
</html>`;
}
