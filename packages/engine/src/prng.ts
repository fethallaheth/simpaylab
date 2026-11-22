/**
 * Seeded PRNG (mulberry32 + xfnv1a string hash).
 * One instance per scenario run. No Math.random / Date.now in the engine.
 */

export function hashSeed(seed: string | number): number {
  if (typeof seed === "number") return seed >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  bool(p: number): boolean;
  /** deterministic hex string of n bytes */
  hex(n: number): string;
}

export function createRng(seed: string | number): Rng {
  let a = hashSeed(seed);
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error("rng.pick of empty array");
      return arr[Math.floor(next() * arr.length)];
    },
    bool(p: number): boolean {
      return next() < p;
    },
    hex(n: number): string {
      let s = "";
      const chars = "0123456789abcdef";
      for (let i = 0; i < n * 2; i++) s += chars[Math.floor(next() * 16)];
      return s;
    }
  };
}
