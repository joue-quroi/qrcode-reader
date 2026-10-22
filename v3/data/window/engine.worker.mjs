import instantiate from './ZBar/zbar.js';
import * as qured from './qured/qured.mjs';

const TYPES = {
  8: 'EAN-8',
  9: 'UPC-E',
  10: 'ISBN-10',
  12: 'UPC-A',
  13: 'EAN-13',
  14: 'ISBN-13',
  25: 'Interleaved 2 of 5',
  39: 'Code 39',
  57: 'PDF417',
  64: 'QR Code',
  128: 'Code 128'
};

const FILTERS = [
  '', 'invert(1)', 'contrast(200%)', 'grayscale(100%)', 'contrast(50%)', 'grayscale(50%)'
];

const canvas = new OffscreenCanvas(1, 1);
const ctx = canvas.getContext('2d', {
  willReadFrequently: true
});

const engine = {
  inst: null, // zbar wasm module
  ptr: null, // ImageScanner
  barcodeDetector: null
};

// the glue cannot fetch the binary itself in a module worker (no importScripts);
// fetch it and hand it over
const ready = (async () => {
  const wasmBinary = await (await fetch(new URL('ZBar/zbar.wasm', import.meta.url))).arrayBuffer();
  engine.inst = await instantiate({wasmBinary});
  engine.ptr = engine.inst._ImageScanner_create();

  if (typeof BarcodeDetector !== 'undefined') {
    try {
      const supportedFormats = await BarcodeDetector.getSupportedFormats();
      if (supportedFormats.length) {
        engine.barcodeDetector = new BarcodeDetector({formats: supportedFormats});
      }
    }
    catch (e) {}
  }
})();

ready.then(() => {
  self.postMessage({type: 'ready'});
}, e => {
  console.warn(e);
  self.postMessage({type: 'init-error', message: e.message});
});

self.onmessage = async ({data: {id, bitmap, kind}}) => {
  const progress = value => self.postMessage({id, type: 'progress', value});
  try {
    await ready;
    if (kind === 'video') {
      const results = await detectVideo(bitmap, progress);
      const message = {id, type: 'done', results};
      if (results.length) {
        // hand the scanned frame back so the UI can freeze on it
        self.postMessage({id, type: 'done', results, bitmap}, [bitmap]);
      }
      else {
        bitmap.close();
        self.postMessage(message);
      }
    }
    else {
      const results = await detectImage(bitmap, progress);
      bitmap.close();
      self.postMessage({id, type: 'done', results});
    }
  }
  catch (e) {
    console.warn(e);
    bitmap.close();
    self.postMessage({id, type: 'error', message: e.message});
  }
};

// image: try one CSS filter after another; the first filter with a match wins.
// the engines of each filter run in parallel
async function detectImage(bitmap, progress) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  let percent = 0;
  for (const filter of FILTERS) {
    ctx.filter = filter;
    ctx.drawImage(bitmap, 0, 0);
    ctx.filter = '';

    const type = filter || 'image';
    const results = [];
    for (const found of await Promise.all([native(type), zbar(type), quredDecode(type)])) {
      percent += 1 / 6 / 3;
      progress(percent);
      results.push(...found);
    }

    if (results.length) {
      progress(1);
      return results;
    }
  }
  progress(1);
  return [];
}

// video: one frame, native + zbar in parallel
async function detectVideo(bitmap, progress) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  ctx.drawImage(bitmap, 0, 0);
  progress(0);

  let done = 0;
  const step = () => progress(++done === 1 ? 0.5 : 1);
  const results = (await Promise.all([
    native('video').then(r => (step(), r)),
    zbar('video').then(r => (step(), r))
  ])).flat();
  return results;
}

async function native(type) {
  if (!engine.barcodeDetector) {
    return [];
  }
  const barcodes = await engine.barcodeDetector.detect(canvas);
  console.info('native count', barcodes.length, type);
  return barcodes.map(barcode => ({
    origin: 'native',
    type,
    symbol: barcode.format.toUpperCase().replace('_', '-'),
    data: barcode.rawValue,
    polygon: barcode.cornerPoints.map(p => ({x: p.x, y: p.y}))
  }));
}

async function zbar(type) {
  const {inst} = engine;
  const width = canvas.width;
  const height = canvas.height;
  const dataBuf = ctx.getImageData(0, 0, width, height).data;
  // write to WASM
  const heap = inst.HEAPU8;
  const data = new Uint8Array(dataBuf);
  const len = width * height;
  if (len * 4 !== data.byteLength) {
    throw Error('dataBuf does not match width and height');
  }
  const buf = inst._malloc(len);
  for (let i = 0; i < len; ++i) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    heap[buf + i] = (r * 19595 + g * 38469 + b * 7472) >> 16;
  }
  const imagePtr = inst._Image_create(width, height, 0x30303859 /* Y800 */, buf, len, 1);
  // scan
  const count = inst._ImageScanner_scan(engine.ptr, imagePtr);
  console.info('zbar count', count, type);
  // read results
  const res = inst._Image_get_symbols(imagePtr);
  const results = [];
  if (res !== 0) {
    const set = new SymbolSetPtr(res, inst.HEAPU8.buffer);
    const decoder = new TextDecoder();
    let symbol = set.head;

    while (symbol !== null) {
      // Find centroid
      const center = {
        x: symbol.points.reduce((sum, p) => sum + p.x, 0) / symbol.points.length,
        y: symbol.points.reduce((sum, p) => sum + p.y, 0) / symbol.points.length
      };

      results.push({
        origin: 'zbar',
        type,
        symbol: TYPES[symbol.type],
        data: decoder.decode(symbol.data),
        polygon: [...symbol.points].sort((a, b) => {
          const angleA = Math.atan2(a.y - center.y, a.x - center.x);
          const angleB = Math.atan2(b.y - center.y, b.x - center.x);
          return angleA - angleB;
        })
      });

      symbol = symbol.next;
    }
  }
  // destroy
  inst._Image_destory(imagePtr);

  return results;
}

async function quredDecode(type) {
  // qured.decode() downscales to at most 1400px before decoding; replicate it
  const scale = Math.min(1, 1400 / Math.max(canvas.width, canvas.height));
  const imageData = raster(Math.round(canvas.width * scale), Math.round(canvas.height * scale));

  const barcode = await qured.decodeFromImageData(imageData);
  if (barcode) {
    console.info('qured count', 1, type);
    return [{
      origin: 'qured',
      type,
      symbol: barcode.format.toUpperCase().replace('_', '-'),
      data: barcode.text,
      polygon: barcode.points
    }];
  }
  console.info('qured count', 0, type);
  return [];
}

function raster(width, height) {
  if (width === canvas.width && height === canvas.height) {
    return ctx.getImageData(0, 0, width, height);
  }
  const c = new OffscreenCanvas(width, height);
  const cx = c.getContext('2d', {
    willReadFrequently: true
  });
  cx.drawImage(canvas, 0, 0, width, height);
  return cx.getImageData(0, 0, width, height);
}

class TypePointer {
  constructor(ptr, buf) {
    this.ptr = ptr;
    this.ptr32 = ptr >> 2;
    this.buf = buf;
    this.HEAP8 = new Int8Array(buf);
    this.HEAPU32 = new Uint32Array(buf);
    this.HEAP32 = new Int32Array(buf);
  }
}
class SymbolPtr extends TypePointer {
  get type() {
    return this.HEAPU32[this.ptr32];
  }
  get data() {
    const len = this.HEAPU32[this.ptr32 + 4];
    const ptr = this.HEAPU32[this.ptr32 + 5];
    return Int8Array.from(this.HEAP8.subarray(ptr, ptr + len));
  }
  get points() {
    const len = this.HEAPU32[this.ptr32 + 7];
    const ptr = this.HEAPU32[this.ptr32 + 8];
    const ptr32 = ptr >> 2;
    const res = [];
    for (let i = 0; i < len; ++i) {
      const x = this.HEAP32[ptr32 + i * 2];
      const y = this.HEAP32[ptr32 + i * 2 + 1];
      res.push({x, y});
    }
    return res;
  }
  get next() {
    const ptr = this.HEAPU32[this.ptr32 + 11];
    if (!ptr) {
      return null;
    }
    return new SymbolPtr(ptr, this.buf);
  }
  get time() {
    return this.HEAPU32[this.ptr32 + 13];
  }
  get cacheCount() {
    return this.HEAP32[this.ptr32 + 14];
  }
  get quality() {
    return this.HEAP32[this.ptr32 + 15];
  }
}
class SymbolSetPtr extends TypePointer {
  get head() {
    const ptr = this.HEAPU32[this.ptr32 + 2];
    if (!ptr) {
      return null;
    }
    return new SymbolPtr(ptr, this.buf);
  }
}
