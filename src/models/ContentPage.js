/**
 * ContentPage
 *
 * Represents a structured page in the YIC content tree. Pages compose
 * reusable ContentFragments, inline component data, SEO metadata,
 * and layout configurations into a deliverable experience unit.
 */

class ContentPage {
  constructor(data = {}) {
    this.id = data.id ?? null;
    this.path = data.path;         // e.g. '/en/products/cloud-platform'
    this.title = data.title ?? '';
    this.template = data.template ?? 'generic';
    this.locale = data.locale ?? 'en';
    this.status = data.status ?? 'draft';

    /** Ordered array of content area definitions */
    this.areas = data.areas ?? [];

    /** SEO + social metadata */
    this.meta = {
      title: data.meta?.title ?? data.title ?? '',
      description: data.meta?.description ?? '',
      canonicalUrl: data.meta?.canonicalUrl ?? null,
      ogImage: data.meta?.ogImage ?? null,
      noIndex: data.meta?.noIndex ?? false,
      structuredData: data.meta?.structuredData ?? null,
    };

    /** Experimentation / personalization rules */
    this.targeting = data.targeting ?? [];
    this.experiments = data.experiments ?? [];

    this.createdAt = data.createdAt ?? new Date().toISOString();
    this.updatedAt = data.updatedAt ?? new Date().toISOString();
    this.publishedAt = data.publishedAt ?? null;
    this.scheduledPublishAt = data.scheduledPublishAt ?? null;
  }

  // ── Areas ─────────────────────────────────────────────────────────────────────

  /**
   * Add a component to a named content area.
   * @param {string} areaName
   * @param {object} component  { type, props, fragmentRef? }
   * @param {number} [position]  Insert at position; appended if omitted
   */
  addComponent(areaName, component, position) {
    let area = this.areas.find(a => a.name === areaName);
    if (!area) {
      area = { name: areaName, components: [] };
      this.areas.push(area);
    }

    const entry = {
      id: `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...component,
    };

    if (position !== undefined) {
      area.components.splice(position, 0, entry);
    } else {
      area.components.push(entry);
    }

    this.updatedAt = new Date().toISOString();
    return entry.id;
  }

  removeComponent(areaName, componentId) {
    const area = this.areas.find(a => a.name === areaName);
    if (!area) return false;
    const idx = area.components.findIndex(c => c.id === componentId);
    if (idx === -1) return false;
    area.components.splice(idx, 1);
    this.updatedAt = new Date().toISOString();
    return true;
  }

  getArea(name) {
    return this.areas.find(a => a.name === name) ?? null;
  }

  // ── Fragment references ───────────────────────────────────────────────────────

  /** Collect all fragment paths referenced by this page's component tree. */
  collectFragmentRefs() {
    const refs = new Set();
    for (const area of this.areas) {
      for (const comp of area.components) {
        if (comp.fragmentRef) refs.add(comp.fragmentRef);
        if (Array.isArray(comp.fragmentRefs)) comp.fragmentRefs.forEach(r => refs.add(r));
      }
    }
    return [...refs];
  }

  // ── Targeting & experiments ───────────────────────────────────────────────────

  addTargetingRule(rule) {
    this.targeting.push({ id: `rule-${Date.now()}`, ...rule });
    return this;
  }

  addExperiment(experiment) {
    this.experiments.push({ id: `exp-${Date.now()}`, ...experiment });
    return this;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  publish() {
    this.status = 'published';
    this.publishedAt = new Date().toISOString();
    this.updatedAt = this.publishedAt;
    return this;
  }

  schedulePublish(isoDate) {
    this.scheduledPublishAt = isoDate;
    this.status = 'scheduled';
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      path: this.path,
      title: this.title,
      template: this.template,
      locale: this.locale,
      status: this.status,
      areas: this.areas,
      meta: this.meta,
      targeting: this.targeting,
      experiments: this.experiments,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      publishedAt: this.publishedAt,
      scheduledPublishAt: this.scheduledPublishAt,
    };
  }
}

module.exports = ContentPage;
