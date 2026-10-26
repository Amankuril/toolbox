import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { absoluteUrl, seoService } from './seo.service.js';

const escapeHtml = (s) =>
  String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
// JSON inside <script>: "</script>" in a product name must not end the tag.
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const link = (l) => `<a href="${escapeHtml(l.path)}">${escapeHtml(l.name)}</a>`;

/** The built index.html, re-read whenever a frontend deploy replaces it. */
let template = null;
async function loadTemplate() {
  const file = path.join(env.FRONTEND_DIST_DIR, 'index.html');
  const { mtimeMs } = await fs.stat(file);
  if (template?.mtimeMs !== mtimeMs) template = { mtimeMs, html: await fs.readFile(file, 'utf8') };
  return template.html;
}

/** Plain, semantic markup of the page's main content. React replaces it as soon as the app starts. */
function renderContent(c) {
  if (!c) return '';
  const parts = ['<main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">'];
  if (c.breadcrumbs?.length) {
    parts.push(`<nav aria-label="Breadcrumb"><a href="/">Home</a>${c.breadcrumbs.map((b) => ` › ${link(b)}`).join('')}</nav>`);
  }
  parts.push(`<h1>${escapeHtml(c.heading)}</h1>`);
  if (c.image) parts.push(`<img src="${escapeHtml(c.image.src)}" alt="${escapeHtml(c.image.alt)}" width="440">`);
  if (c.facts?.length) parts.push(`<ul>${c.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`);
  if (c.intro) parts.push(`<p>${escapeHtml(c.intro)}</p>`);
  if (c.body)
    parts.push(
      `<section><h2>Description</h2>${c.body
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join('')}</section>`,
    );
  if (c.specs?.length) {
    parts.push(
      `<section><h2>Specifications</h2><table>${c.specs.map((s) => `<tr><th>${escapeHtml(s.label)}</th><td>${escapeHtml(s.value)}</td></tr>`).join('')}</table></section>`,
    );
  }
  for (const section of c.sections ?? []) {
    if (!section.links.length) continue;
    parts.push(
      `<section><h2>${escapeHtml(section.heading)}</h2><ul>${section.links.map((l) => `<li>${link(l)}</li>`).join('')}</ul></section>`,
    );
  }
  parts.push('</main>');
  return parts.join('');
}

/** Head tags for one page. Each is marked data-ssr so the app can drop them once it manages the head itself. */
function renderHead(page) {
  const tags = [`<title data-ssr>${escapeHtml(page.title)}</title>`];
  const meta = (attr, key, value) => value && tags.push(`<meta data-ssr ${attr}="${key}" content="${escapeHtml(value)}">`);

  if (page.status === 404) {
    meta('name', 'robots', 'noindex');
    return tags.join('\n    ');
  }
  const url = absoluteUrl(page.path);
  meta('name', 'description', page.description);
  meta('name', 'keywords', page.keywords);
  tags.push(`<link data-ssr rel="canonical" href="${escapeHtml(url)}">`);
  meta('property', 'og:type', page.ogType ?? 'website');
  meta('property', 'og:site_name', page.siteName);
  meta('property', 'og:title', page.title);
  meta('property', 'og:description', page.description);
  meta('property', 'og:url', url);
  meta('property', 'og:locale', 'en_IN');
  meta('property', 'og:image', page.image);
  meta('property', 'og:image:alt', page.imageAlt);
  meta('property', 'product:price:amount', page.price?.amount);
  meta('property', 'product:price:currency', page.price?.currency);
  meta('name', 'twitter:card', page.image ? 'summary_large_image' : 'summary');
  meta('name', 'twitter:title', page.title);
  meta('name', 'twitter:description', page.description);
  meta('name', 'twitter:image', page.image);
  for (const data of page.jsonLd ?? []) tags.push(`<script data-ssr type="application/ld+json">${jsonForScript(data)}</script>`);
  return tags.join('\n    ');
}

function renderPage(html, page) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace('</head>', `  ${renderHead(page)}\n  </head>`)
    .replace(/<div id="root"><\/div>/, `<div id="root">${renderContent(page.content)}</div>`);
}

const page = (load) => async (req, res, next) => {
  let html;
  try {
    html = await loadTemplate();
  } catch (err) {
    // No build to fill in: nginx falls back to serving the static index.html itself.
    logger.error({ err, dir: env.FRONTEND_DIST_DIR }, 'Storefront index.html not found for SEO rendering');
    return res.status(503).type('text/plain').send('Storefront build not found');
  }
  try {
    const data = await load(req.params);
    // Same rule as nginx's index.html: always revalidate so a deploy reaches users immediately.
    res
      .status(data.status ?? 200)
      .set('Cache-Control', 'no-cache')
      .type('html')
      .send(renderPage(html, data));
  } catch (err) {
    next(err);
  }
};

/**
 * Crawlable storefront pages. nginx sends these paths here (deploy/nginx/toolbox.conf) so search engines and
 * link previews get real titles, descriptions, structured data and content instead of an empty app shell.
 */
export const seoRoutes = Router()
  .get('/robots.txt', (_req, res) => res.set('Cache-Control', 'public, max-age=3600').type('text/plain').send(seoService.robots()))
  .get('/sitemap.xml', async (_req, res) =>
    res
      .set('Cache-Control', 'public, max-age=1800')
      .type('application/xml')
      .send(await seoService.sitemap()),
  )
  .get(
    '/',
    page(() => seoService.home()),
  )
  .get(
    '/p/:slug',
    page(({ slug }) => seoService.product(slug.toLowerCase())),
  )
  .get(
    '/c/:slug',
    page(({ slug }) => seoService.category(slug.toLowerCase())),
  )
  .get(
    '/store/:slug',
    page(({ slug }) => seoService.store(slug.toLowerCase())),
  )
  .get(
    '/pages/:slug',
    page(({ slug }) => seoService.page(slug.toLowerCase())),
  );
