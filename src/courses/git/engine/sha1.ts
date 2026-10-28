/** SHA-1, synchronous (crypto.subtle is async). Git names every object by the SHA-1 of its bytes. */

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function sha1(data: Uint8Array): string {
  const len = data.length;
  const words = ((len + 8) >> 6) + 1;
  const w = new Uint32Array(words * 16);
  for (let i = 0; i < len; i++) w[i >> 2] |= data[i] << (24 - (i % 4) * 8);
  w[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  // Message length in bits, big-endian (fits in 32 bits for anything a course repo holds).
  w[words * 16 - 1] = len * 8;
  w[words * 16 - 2] = Math.floor(len / 0x20000000);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const m = new Uint32Array(80);
  for (let b = 0; b < words * 16; b += 16) {
    for (let i = 0; i < 16; i++) m[i] = w[b + i];
    for (let i = 16; i < 80; i++) {
      const x = m[i - 3] ^ m[i - 8] ^ m[i - 14] ^ m[i - 16];
      m[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let bb = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + m[i]) >>> 0;
      e = d;
      d = c;
      c = (bb << 30) | (bb >>> 2);
      bb = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + bb) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}
