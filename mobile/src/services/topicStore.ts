export interface ServerTopic {
  slug: string;
  name: string;
  conceptCount: number;
  following: boolean;
}

interface Dependencies {
  read: () => Promise<ServerTopic[] | null>;
  write: (topics: ServerTopic[]) => Promise<void>;
  fetch: () => Promise<ServerTopic[]>;
  pending: () => Promise<string[] | undefined>;
  enqueue: (slugs: string[]) => Promise<void>;
}

/** Shared catalog and optimistic follow state for Personalization and Stats. */
export class TopicStore {
  private deps: Dependencies;
  private topics: ServerTopic[] = [];
  private revision = 0;
  private epoch = 0;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(deps: Dependencies) { this.deps = deps; }

  getSnapshot = (): ServerTopic[] => this.topics;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(topics: ServerTopic[]): void {
    this.topics = topics;
    this.listeners.forEach(listener => listener());
  }

  async load(): Promise<ServerTopic[]> {
    const revision = ++this.revision;
    const cached = await this.deps.read();
    const overlay = (rows: ServerTopic[], slugs?: string[]) => slugs
      ? rows.map(topic => ({ ...topic, following: slugs.includes(topic.slug) }))
      : rows;
    const queued = await this.deps.pending();
    if (revision !== this.revision) return this.topics;
    if (cached && this.topics.length === 0) this.publish(overlay(cached, queued));
    try {
      const rows = await this.deps.fetch();
      const pending = await this.deps.pending();
      if (revision !== this.revision) return this.topics;
      this.publish(overlay(rows, pending));
      await this.deps.write(this.topics);
      return this.topics;
    } catch (error) {
      if (revision !== this.revision || this.topics.length) return this.topics;
      throw error;
    }
  }

  toggle(slug: string): Promise<void> {
    if (!this.topics.some(topic => topic.slug === slug)) return Promise.resolve();
    const before = this.topics;
    const next = before.map(topic => topic.slug === slug
      ? { ...topic, following: !topic.following } : topic);
    const revision = ++this.revision;
    const epoch = this.epoch;
    this.publish(next);
    const write = this.writes.then(async () => {
      if (epoch !== this.epoch) return;
      // All follows use the durable queue, even online. A single replay path
      // preserves order when connectivity changes during rapid taps.
      await this.deps.enqueue(next.filter(topic => topic.following).map(topic => topic.slug));
      if (epoch === this.epoch) await this.deps.write(next);
    });
    this.writes = write.catch(() => {});
    return write.catch(error => {
      if (revision === this.revision) this.publish(before);
      throw error;
    });
  }

  reset(): void {
    this.epoch += 1;
    this.revision += 1;
    this.publish([]);
  }
}
