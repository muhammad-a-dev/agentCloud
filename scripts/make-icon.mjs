// Renders the agentCloud icon (orange agent blob on a dark tile) to PNG + ICO without extra deps.
import fs from 'fs'
import zlib from 'zlib'

function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
function sdTriangle(px, py, p0, p1, p2) {
  const e0 = [p1[0] - p0[0], p1[1] - p0[1]], e1 = [p2[0] - p1[0], p2[1] - p1[1]], e2 = [p0[0] - p2[0], p0[1] - p2[1]]
  const v0 = [px - p0[0], py - p0[1]], v1 = [px - p1[0], py - p1[1]], v2 = [px - p2[0], py - p2[1]]
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
  const clamp = (x) => Math.min(1, Math.max(0, x))
  const pq = (v, e) => { const t = clamp(dot(v, e) / dot(e, e)); return [v[0] - e[0] * t, v[1] - e[1] * t] }
  const pq0 = pq(v0, e0), pq1 = pq(v1, e1), pq2 = pq(v2, e2)
  const s = Math.sign(e0[0] * e2[1] - e0[1] * e2[0])
  const d0 = [dot(pq0, pq0), s * (v0[0] * e0[1] - v0[1] * e0[0])]
  const d1 = [dot(pq1, pq1), s * (v1[0] * e1[1] - v1[1] * e1[0])]
  const d2 = [dot(pq2, pq2), s * (v2[0] * e2[1] - v2[1] * e2[0])]
  const dmin = Math.min(d0[0], d1[0], d2[0]), smin = Math.min(d0[1], d1[1], d2[1])
  return -Math.sqrt(dmin) * Math.sign(smin)
}

function render(N) {
  const px = Buffer.alloc(N * N * 4)
  const SS = 4
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + 0.5) / SS) / N, v = (y + (sy + 0.5) / SS) / N
      let cr = 0, cg = 0, cb = 0, ca = 0
      if (sdRoundBox(u, v, 0.5, 0.5, 0.47, 0.47, 0.22) < 0) { cr = 20; cg = 20; cb = 20; ca = 255 }
      const blob = sdTriangle(u, v, [0.5, 0.25], [0.8, 0.74], [0.2, 0.74]) - 0.075
      if (blob < 0) { cr = 247; cg = 165; cb = 28; ca = 255 }
      const eye = Math.min(sdRoundBox(u, v, 0.43, 0.6, 0.028, 0.075, 0.028), sdRoundBox(u, v, 0.57, 0.6, 0.028, 0.075, 0.028))
      if (eye < 0) { cr = 26; cg = 18; cb = 6; ca = 255 }
      r += cr; g += cg; b += cb; a += ca
    }
    const n = SS * SS, i = (y * N + x) * 4
    const al = a / n
    px[i] = al ? r / n * 255 / al : 0; px[i + 1] = al ? g / n * 255 / al : 0; px[i + 2] = al ? b / n * 255 / al : 0; px[i + 3] = al
  }
  return px
}

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(N) {
  const raw = render(N)
  const rows = Buffer.alloc((N * 4 + 1) * N)
  for (let y = 0; y < N; y++) { rows[y * (N * 4 + 1)] = 0; raw.copy(rows, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

fs.mkdirSync('resources', { recursive: true })
fs.writeFileSync('resources/icon.png', png(512))
const sizes = [16, 24, 32, 48, 64, 128, 256]
const imgs = sizes.map((s) => png(s))
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(offset, 12); offset += imgs[i].length
  return e
})
fs.writeFileSync('resources/icon.ico', Buffer.concat([header, ...dir, ...imgs]))
console.log('icons written')
