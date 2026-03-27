/**
 * LocalizationService
 *
 * Manages multi-locale content strategy in YIC CMS.
 * Handles locale resolution, translation memory, locale-specific
 * content inheritance, and machine translation routing.
 */

const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

class LocaleConfig {
  constructor(def) {
    this.code = def.code;           // e.g. 'en-US'
    this.language = def.language;   // e.g. 'en'
    this.region = def.region ?? null;
    this.label = def.label;
    this.direction = def.direction ?? 'ltr';
    this.fallbackLocales = def.fallbackLocales ?? [];
    this.dateFormat = def.dateFormat ?? 'MM/DD/YYYY';
    this.numberFormat = def.numberFormat ?? { decimal: '.', thousands: ',' };
    this.currency = def.currency ?? 'USD';
    this.enabled = def.enabled ?? true;
    this.publishable = def.publishable ?? true;
  }
}

class LocalizationService {
  constructor() {
    this._locales = new Map();
    this._defaultLocale = null;
    this._translationMemory = new Map();  // key(sourceLocale:text) → Map<targetLocale, translation>
    this._mtAdapters = new Map();         // locale → MT adapter
  }

  // ── Locale registry ───────────────────────────────────────────────────────────

  addLocale(def) {
    if (!LOCALE_PATTERN.test(def.code) && !def.code.includes('-')) {
      // allow bare language codes like 'en'
    }
    const locale = new LocaleConfig(def);
    this._locales.set(locale.code, locale);
    if (!this._defaultLocale) this._defaultLocale = locale.code;
    return this;
  }

  setDefault(code) {
    if (!this._locales.has(code)) throw new Error(`Unknown locale: ${code}`);
    this._defaultLocale = code;
    return this;
  }

  getLocale(code) { return this._locales.get(code) ?? null; }
  listLocales() { return [...this._locales.values()].filter(l => l.enabled); }
  get defaultLocale() { return this._defaultLocale; }

  // ── Locale resolution ─────────────────────────────────────────────────────────

  /**
   * Resolve the best available locale for a visitor's accept-language preference.
   * @param {string[]} acceptLanguage  e.g. ['fr-CA', 'fr', 'en']
   * @returns {string} Resolved locale code
   */
  resolveLocale(acceptLanguage = []) {
    for (const pref of acceptLanguage) {
      if (this._locales.has(pref)) return pref;

      // Try language-only match
      const lang = pref.split('-')[0];
      const match = [...this._locales.keys()].find(l => l.startsWith(lang));
      if (match) return match;
    }
    return this._defaultLocale;
  }

  /**
   * Build the fallback chain for a locale (for content inheritance).
   * e.g. fr-CA → fr → en
   */
  getFallbackChain(code) {
    const locale = this._locales.get(code);
    if (!locale) return [this._defaultLocale];

    const chain = [code];
    const visited = new Set([code]);

    const expand = (localeCode) => {
      const cfg = this._locales.get(localeCode);
      if (!cfg) return;
      for (const fb of cfg.fallbackLocales) {
        if (!visited.has(fb)) {
          chain.push(fb);
          visited.add(fb);
          expand(fb);
        }
      }
    };

    expand(code);
    if (!chain.includes(this._defaultLocale)) chain.push(this._defaultLocale);
    return chain;
  }

  // ── Translation memory ────────────────────────────────────────────────────────

  remember(sourceLocale, sourceText, targetLocale, translation) {
    const key = `${sourceLocale}:${sourceText}`;
    if (!this._translationMemory.has(key)) this._translationMemory.set(key, new Map());
    this._translationMemory.get(key).set(targetLocale, { translation, addedAt: new Date().toISOString() });
  }

  recall(sourceLocale, sourceText, targetLocale) {
    const key = `${sourceLocale}:${sourceText}`;
    return this._translationMemory.get(key)?.get(targetLocale)?.translation ?? null;
  }

  // ── Machine translation ───────────────────────────────────────────────────────

  addMTAdapter(locale, adapter) {
    if (typeof adapter.translate !== 'function') {
      throw new TypeError('MT adapter must implement translate(text, sourceLocale): Promise<string>');
    }
    this._mtAdapters.set(locale, adapter);
    return this;
  }

  /**
   * Translate text to a target locale.
   * Checks translation memory first; falls back to MT adapter.
   */
  async translate(text, sourceLocale, targetLocale) {
    const remembered = this.recall(sourceLocale, text, targetLocale);
    if (remembered) return remembered;

    const adapter = this._mtAdapters.get(targetLocale) ?? this._mtAdapters.get('*');
    if (!adapter) throw new Error(`No MT adapter for locale: ${targetLocale}`);

    const translated = await adapter.translate(text, sourceLocale);
    this.remember(sourceLocale, text, targetLocale, translated);
    return translated;
  }
}

module.exports = new LocalizationService();
