export class BoundedCache<K, V> {
  private readonly values = new Map<K, { value: V; expiresAt: number }>()

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get size(): number {
    return this.values.size
  }

  has(key: K): boolean {
    return this.get(key) !== undefined
  }

  get(key: K): V | undefined {
    const entry = this.values.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key)
      return undefined
    }
    this.values.delete(key)
    this.values.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    this.values.delete(key)
    this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs })
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as K | undefined
      if (oldest === undefined) break
      this.values.delete(oldest)
    }
  }

  delete(key: K): boolean {
    return this.values.delete(key)
  }
}
