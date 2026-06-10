// Generate placeholder PNG and ICO icons for Tauri without external dependencies
// Uses only Node.js built-in modules: zlib, crypto, fs, path

import { createWriteStream } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ICONS_DIR = join(__dirname, '..', 'src-tauri', 'icons')

// CRC32 implementation matching PNG specification
function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBytes, data])
  const crcVal = Buffer.alloc(4)
  crcVal.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([len, typeBytes, data, crcVal])
}

function makePNG(width, height, r, g, b) {
  // RGBA raw pixel data (Tauri requires RGBA PNGs)
  const rawRowSize = 1 + width * 4 // filter byte + RGBA pixels
  const rawData = Buffer.alloc(rawRowSize * height)
  for (let y = 0; y < height; y++) {
    const offset = y * rawRowSize
    rawData[offset] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 4
      rawData[px] = r
      rawData[px + 1] = g
      rawData[px + 2] = b
      rawData[px + 3] = 255 // alpha: fully opaque
    }
  }
  const compressed = deflateSync(rawData)

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8  // bit depth
  ihdrData[9] = 6  // color type: RGBA
  ihdrData[10] = 0 // compression
  ihdrData[11] = 0 // filter
  ihdrData[12] = 0 // interlace

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// Create a valid ICO file by embedding a 32x32 PNG (ICO supports PNG format natively)
function makeICO(pngData) {
  // ICO file structure:
  //   6 bytes:  ICO header (reserved + type + count)
  //  16 bytes:  directory entry (per image)
  //   N bytes:  embedded PNG data
  const ICO_HEADER_SIZE = 6
  const ICO_ENTRY_SIZE = 16
  const imgOffset = ICO_HEADER_SIZE + ICO_ENTRY_SIZE // 22
  const fileSize = imgOffset + pngData.length

  const buf = Buffer.alloc(fileSize)

  let offset = 0
  // ICO header
  offset = buf.writeUInt16LE(0, offset)   // reserved, must be 0
  offset = buf.writeUInt16LE(1, offset)   // type: ICO = 1
  offset = buf.writeUInt16LE(1, offset)   // count: 1 image

  // ICO directory entry (16 bytes)
  offset = buf.writeUInt8(32, offset)     // width (0 means 256; 32 = 32)
  offset = buf.writeUInt8(32, offset)     // height
  offset = buf.writeUInt8(0, offset)      // color palette size (0 = no palette)
  offset = buf.writeUInt8(0, offset)      // reserved, must be 0
  offset = buf.writeUInt16LE(1, offset)   // color planes (set to 1 for PNG)
  offset = buf.writeUInt16LE(32, offset)  // bits per pixel
  offset = buf.writeUInt32LE(pngData.length, offset) // size of embedded image data
  offset = buf.writeUInt32LE(imgOffset, offset)      // offset to image data from file start

  // Embed PNG data directly
  pngData.copy(buf, offset)

  return buf
}

// Run
mkdirSync(ICONS_DIR, { recursive: true })

const blue = { r: 59, g: 130, b: 246 } // Tailwind blue-500

// 32x32 PNG
const png32 = makePNG(32, 32, blue.r, blue.g, blue.b)
createWriteStream(join(ICONS_DIR, '32x32.png')).end(png32)
console.log('Created: 32x32.png')

// 128x128 PNG
const png128 = makePNG(128, 128, blue.r, blue.g, blue.b)
createWriteStream(join(ICONS_DIR, '128x128.png')).end(png128)
console.log('Created: 128x128.png')

// 256x256 PNG (128x128@2x)
const png256 = makePNG(256, 256, blue.r, blue.g, blue.b)
createWriteStream(join(ICONS_DIR, '128x128@2x.png')).end(png256)
console.log('Created: 128x128@2x.png')

// icon.ico (embeds 32x32 PNG)
const ico = makeICO(png32)
createWriteStream(join(ICONS_DIR, 'icon.ico')).end(ico)
console.log('Created: icon.ico')

console.log('\nAll icons generated successfully!')
