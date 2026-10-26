import { ApiError } from '#core/errors/ApiError.js';
import { settingsService } from '#services/settings/settings.service.js';
import { PAGE_DEFAULTS } from './page.defaults.js';
import { CONTENT_PAGES, ContentPage } from './page.model.js';

const definitionOf = (key) => CONTENT_PAGES.find((p) => p.key === key);

/** Fills {site}, {email} and {phone}; a placeholder with nothing behind it reads as "us". */
async function fillDefaults(text) {
  const { siteName, supportEmail, supportPhone } = await settingsService.get('branding');
  return text
    .replaceAll('{site}', siteName)
    .replaceAll('{email}', supportEmail || 'our support team')
    .replaceAll('{phone}', supportPhone || 'our support team');
}

/** The stored page, or the starting text when an admin hasn't written one yet. */
async function view(def, doc) {
  return {
    key: def.key,
    slug: def.slug,
    title: doc?.title ?? def.title,
    content: doc ? doc.content : await fillDefaults(PAGE_DEFAULTS[def.key]),
    published: doc?.published ?? true,
    customised: Boolean(doc),
    seo: { title: doc?.seo?.title ?? null, description: doc?.seo?.description ?? null },
    updatedAt: doc?.updatedAt ?? null,
  };
}

export const pageService = {
  async list() {
    const docs = await ContentPage.find().lean();
    const byKey = new Map(docs.map((d) => [d.key, d]));
    return Promise.all(CONTENT_PAGES.map((def) => view(def, byKey.get(def.key))));
  },

  /** Published pages for the footer: names and addresses only. */
  async publicList() {
    return (await this.list()).filter((p) => p.published).map(({ key, slug, title }) => ({ key, slug, title }));
  },

  async publicGet(slug) {
    const def = CONTENT_PAGES.find((p) => p.slug === slug);
    const page = def && (await view(def, await ContentPage.findOne({ key: def.key }).lean()));
    if (!page?.published) throw ApiError.notFound('Page not found');
    return page;
  },

  async update(key, input, actor) {
    const def = definitionOf(key);
    if (!def) throw ApiError.notFound('Page not found');
    const doc = await ContentPage.findOneAndUpdate(
      { key },
      { $set: { ...input, updatedBy: actor }, $setOnInsert: { key } },
      { upsert: true, returnDocument: 'after', runValidators: true },
    ).lean();
    return view(def, doc);
  },

  /** Back to the starting text. */
  async reset(key) {
    const def = definitionOf(key);
    if (!def) throw ApiError.notFound('Page not found');
    await ContentPage.deleteOne({ key });
    return view(def, null);
  },
};
