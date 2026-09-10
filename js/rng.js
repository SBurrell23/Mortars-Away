// Deterministic PRNG shared by both peers.
// mulberry32: fast, tiny, and identical across every JS engine because it
// uses only integer bit ops and a single float divide.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
  }
  float() { return this.next(); }
  range(lo, hi) { return lo + (hi - lo) * this.next(); }
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  bool(p = 0.5) { return this.next() < p; }
  // Triangular-ish distribution centred on 0, range [-1,1]. Favours small values.
  signedSoft() { return (this.next() + this.next() + this.next() - 1.5) / 1.5; }
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
