/**
 * VersionManager
 *
 * Provides snapshot-based versioning for content nodes in YIC CMS.
 * Versions are stored as immutable diffs (JSON Patch RFC 6902) relative
 * to the previous version, enabling efficient storage and fast diff display.
 */

class Diff {
  /**
   * Compute a JSON Patch diff between two plain objects.
   * Returns an array of patch operations.
   */
  static compute(before, after, path = '') {
    const ops = [];

    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const fullPath = `${path}/${key}`;
      const a = before[key];
      const b = after[key];

      if (!(key in before)) {
        ops.push({ op: 'add', path: fullPath, value: b });
      } else if (!(key in after)) {
        ops.push({ op: 'remove', path: fullPath });
      } else if (a !== b) {
        if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
          ops.push(...this.compute(a, b, fullPath));
        } else {
          ops.push({ op: 'replace', path: fullPath, value: b });
        }
      }
    }

    return ops;
  }

  /**
   * Apply a JSON Patch array to a target object.
   * Returns a new object (does not mutate).
   */
  static apply(target, patch) {
    let result = JSON.parse(JSON.stringify(target));

    for (const op of patch) {
      const parts = op.path.slice(1).split('/');
      const lastKey = parts.pop();
      let obj = result;
      for (const key of parts) obj = obj[key];

      switch (op.op) {
        case 'add':
        case 'replace':
          obj[lastKey] = op.value;
          break;
        case 'remove':
          if (Array.isArray(obj)) obj.splice(Number(lastKey), 1);
          else delete obj[lastKey];
          break;
        case 'move': {
          const fromParts = op.from.slice(1).split('/');
          const fromKey = fromParts.pop();
          let fromObj = result;
          for (const k of fromParts) fromObj = fromObj[k];
          obj[lastKey] = fromObj[fromKey];
          delete fromObj[fromKey];
          break;
        }
      }
    }

    return result;
  }
}

class ContentVersion {
  constructor(data) {
    this.id = data.id ?? `v-${Date.now()}`;
    this.contentId = data.contentId;
    this.version = data.version;
    this.label = data.label ?? `v${data.version}`;
    this.patch = data.patch ?? [];     // JSON Patch from previous version
    this.snapshot = data.snapshot ?? null; // full snapshot (stored for v1 and every 10th)
    this.author = data.author ?? null;
    this.comment = data.comment ?? '';
    this.createdAt = data.createdAt ?? new Date().toISOString();
  }
}

class VersionManager {
  constructor() {
    this._store = new Map();   // contentId → ContentVersion[]
    this._snapshotInterval = 10;
  }

  useStore(store) {
    // Optionally connect a persistent store adapter
    this._persistentStore = store;
    return this;
  }

  /**
   * Snapshot the current state of a content node, creating a new version.
   * @param {object} node   Content node with { id, version, ...fields }
   * @param {object} [opts] { author, comment }
   * @returns {ContentVersion}
   */
  async snapshot(node, opts = {}) {
    const history = this._store.get(node.id) ?? [];
    const prevVersion = history.at(-1);
    const newVersionNum = (node.version ?? 0) + 1;

    let patch = [];
    let snapshot = null;

    if (!prevVersion) {
      snapshot = JSON.parse(JSON.stringify(node));
    } else {
      const prevSnapshot = await this._reconstruct(node.id, prevVersion.version);
      patch = Diff.compute(prevSnapshot, node);

      if (newVersionNum % this._snapshotInterval === 0) {
        snapshot = JSON.parse(JSON.stringify(node));
      }
    }

    const version = new ContentVersion({
      contentId: node.id,
      version: newVersionNum,
      patch,
      snapshot,
      author: opts.author,
      comment: opts.comment,
    });

    history.push(version);
    this._store.set(node.id, history);

    if (this._persistentStore) await this._persistentStore.save(version);

    return version;
  }

  /**
   * List all versions for a content node.
   * @returns {ContentVersion[]}
   */
  async listVersions(contentId) {
    if (this._persistentStore) return this._persistentStore.findByContentId(contentId);
    return this._store.get(contentId) ?? [];
  }

  /**
   * Reconstruct the full content snapshot at a given version number.
   */
  async _reconstruct(contentId, targetVersion) {
    const history = this._store.get(contentId) ?? [];

    // Find nearest snapshot at or before targetVersion
    let base = null;
    let baseVersion = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const v = history[i];
      if (v.version <= targetVersion && v.snapshot) {
        base = v.snapshot;
        baseVersion = v.version;
        break;
      }
    }

    if (!base) return null;

    let current = base;
    for (const v of history) {
      if (v.version <= baseVersion || v.version > targetVersion) continue;
      if (v.patch?.length) current = Diff.apply(current, v.patch);
    }

    return current;
  }

  async restore(contentId, targetVersion) {
    const snapshot = await this._reconstruct(contentId, targetVersion);
    if (!snapshot) throw new Error(`Cannot restore ${contentId} to version ${targetVersion}`);
    return snapshot;
  }

  /**
   * Compute a human-readable diff between two versions.
   */
  async diff(contentId, fromVersion, toVersion) {
    const [from, to] = await Promise.all([
      this._reconstruct(contentId, fromVersion),
      this._reconstruct(contentId, toVersion),
    ]);
    if (!from || !to) throw new Error('Could not reconstruct versions for diff');
    return Diff.compute(from, to);
  }
}

module.exports = new VersionManager();
