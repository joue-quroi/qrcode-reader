import instantiate from './ZBar/zbar.js';
import * as qured from './qured/qured.mjs';
import {prepareZXingModule, readBarcodesFromImageData} from './zxing/index.mjs';

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

const ZXING_TYPES = {
  AZTEC: 'Aztec',
  CODABAR: 'Codabar',
  CODE39: 'Code 39',
  CODE93: 'Code 93',
  CODE128: 'Code 128',
  DATABAR: 'GS1 DataBar',
  DATABAREXPANDED: 'GS1 DataBar Expanded',
  DATAMATRIX: 'Data Matrix',
  'EAN-8': 'EAN-8',
  'EAN-13': 'EAN-13',
  INDUSTRIAL2OF5: 'Industrial 2 of 5',
  INTERLEAVED2OF5: 'Interleaved 2 of 5',
  ITF: 'ITF',
  MICROQRCODE: 'Micro QR Code',
  PDF417: 'PDF417',
  QRCODE: 'QR Code',
  RMQRCODE: 'Rectangular Micro QR Code',
  'UPC-A': 'UPC-A',
  'UPC-E': 'UPC-E'
};

const FILTERS = [
  '', 'invert(1)', 'contrast(200%)', 'grayscale(100%)', 'contrast(50%)', 'grayscale(50%)'
];

const FILTER_LABELS = {
  '': 'original colors',
  'invert(1)': 'inverted colors',
  'contrast(200%)': 'high contrast',
  'grayscale(100%)': 'grayscale',
  'contrast(50%)': 'low contrast',
  'grayscale(50%)': 'half gray'
};

const canvas = new OffscreenCanvas(1, 1);
const ctx = canvas.getContext('2d', {
  willReadFrequently: true
});

const engine = {
  inst: null, // zbar wasm module
  ptr: null, // ImageScanner
  barcodeDetector: null,
  zxing: false,
  zbar: true
};

// an engine that throws must never lose the other engines' results
const safe = promise => promise.catch(e => {
  console.warn(e);
  return [];
});

// the glue cannot fetch the binaries itself in a module worker (no importScripts);
// fetch them and hand them over
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

  try {
    const zxingBinary = await (await fetch(new URL('zxing/zxing_reader.wasm', import.meta.url))).arrayBuffer();
    await prepareZXingModule({
      overrides: {wasmBinary: zxingBinary},
      fireImmediately: true
    });
    engine.zxing = true;
  }
  catch (e) {
    console.warn('zxing is not available', e);
  }
})();

ready.then(() => {
  self.postMessage({type: 'ready'});
}, e => {
  console.warn(e);
  self.postMessage({type: 'init-error', message: e.message});
});

self.onmessage = async ({data: {id, bitmap, kind}}) => {
  const progress = (value, label) => self.postMessage({id, type: 'progress', value, label});
  try {
    await ready;
    const results = kind === 'video' ? await detectVideo(bitmap, progress) : await detectImage(bitmap, progress);
    bitmap.close();
    self.postMessage({id, type: 'done', results});
  }
  catch (e) {
    console.warn(e);
    bitmap.close();
    self.postMessage({id, type: 'error', message: e.message});
  }
};

// drop codes that are reported by more than one engine or pass
function dedupe(results) {
  const seen = new Set();
  return results.filter(({data}) => !seen.has(data) && seen.add(data));
}

// image: light passes first, then escalate; a tile sweep merges extra codes
// the engines overlook in crowded scenes
async function detectImage(bitmap, progress) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  // every engine completion advances the bar by one unit; the budget covers
  // the whole worst-case pipeline:
  // 19 (filter sweep) + 1 (quredMulti) + 1 (hard zxing) + 4 (2x pass) + 8 (tiles)
  const UNITS = 33;
  let done = 0;
  let max = 0;
  const post = (value, label) => {
    if (value > max) {
      max = value;
      progress(value, label);
    }
  };
  const tick = (n, label) => post((done = Math.min(done + n, UNITS - 1)) / UNITS, label);

  // try one CSS filter after another; the first filter with a match wins.
  // the engines of each filter run in parallel; zxing only runs once (on the
  // unfiltered image) as it detects inverted codes itself
  const ENGINES = [
    [native, 'Native'], [zbar, 'ZBar'], [quredDecode, 'qured'], [zxing, 'ZXing']
  ];
  let results = [];
  for (const filter of FILTERS) {
    ctx.filter = filter;
    ctx.drawImage(bitmap, 0, 0);
    ctx.filter = '';

    const engine = name => `${FILTER_LABELS[filter] || filter} : ${name}`;
    const type = filter || 'image';
    const engines = filter ? ENGINES.slice(0, 3) : ENGINES;
    for (const found of await Promise.all(engines.map(([fn, name]) => safe(fn(type)).then(r => (tick(1, engine(name)), r))))) {
      results.push(...found);
    }

    if (results.length) {
      post(1);
      break;
    }
  }

  // no luck: remove the last filter and run the higher-sensitivity passes
  if (results.length === 0) {
    ctx.drawImage(bitmap, 0, 0);

    // multi-code pass: qured.decodeAll runs its own inversion and downscale
    // passes and reports every code it can find in one go
    results.push(...await safe(quredMulti()));
    tick(1, 'qured · multi-code');

    // zxing pass: adds DataMatrix, Aztec, Micro QR, ... and tries harder
    if (results.length === 0) {
      results.push(...await safe(zxing('image', {tryDownscale: false})));
      tick(1, 'ZXing · hard pass');
    }

    // upscale pass: small codes often need a higher-resolution render
    if (results.length === 0 && Math.max(canvas.width, canvas.height) * 2 <= 6000) {
      canvas.width *= 2;
      canvas.height *= 2;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      results.push(...(await Promise.all([
        safe(native('2x')).then(r => (tick(1, 'Native · 2x upscale'), r)),
        safe(zbar('2x')).then(r => (tick(1, 'ZBar · 2x upscale'), r)),
        safe(quredDecode('2x', {aggressive: true})).then(r => (tick(1, 'qured · 2x upscale'), r)),
        safe(zxing('2x', {tryDownscale: false})).then(r => (tick(1, 'ZXing · 2x upscale'), r))
      ])).flat());
    }
  }

  // tile sweep: engines stop after a family of matches, rescan regions
  results.push(...await safe(tileSweep(tick)));

  post(1);
  return dedupe(results);
}

// scan 4 overlapping corner-region crops; big images get downscaled tiles
async function tileSweep(tick = () => {}) {
  const w = canvas.width;
  const h = canvas.height;
  if (Math.max(w, h) < 300) {
    return [];
  }
  const results = [];
  for (const [k, [i, j]] of [[0, 0], [1, 0], [0, 1], [1, 1]].entries()) {
    const x = Math.round(w * 0.4 * i);
    const y = Math.round(h * 0.4 * j);
    const width = Math.min(Math.round(w * 0.6), w - x);
    const height = Math.min(Math.round(h * 0.6), h - y);
    if (width < 1 || height < 1) {
      continue;
    }
    const scale = Math.min(1, 900 / Math.max(width, height));
    const imageData = raster2(x, y, Math.round(width * scale), Math.round(height * scale));
    const region = `region ${k + 1}/4`;
    for (const found of await Promise.all([
      safe(zbarOn(imageData, 'tile')).then(r => (tick(1, `ZBar · ${region}`), r)),
      safe(zxingOn(imageData, 'tile', {tryDownscale: false})).then(r => (tick(1, `ZXing · ${region}`), r))
    ])) {
      results.push(...found);
    }
  }
  return results;
}

// video: one frame, native + zbar + zxing in parallel
async function detectVideo(bitmap, progress) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  ctx.drawImage(bitmap, 0, 0);
  progress(0);

  let done = 0;
  const step = () => progress(++done === 3 ? 1 : done / 3);
  const results = (await Promise.all([
    safe(native('video')).then(r => (step(), r)),
    safe(zbar('video')).then(r => (step(), r)),
    safe(zxing('video')).then(r => (step(), r))
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
  if (engine.zbar === false) {
    return [];
  }
  return zbarOn(ctx.getImageData(0, 0, canvas.width, canvas.height), type);
}

async function zbarOn(imageData, type) {
  if (engine.zbar === false) {
    return [];
  }
  try {
    const {inst} = engine;
    const width = imageData.width;
    const height = imageData.height;
    const dataBuf = imageData.data;
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
    inst._free(buf);

    return results;
  }
  catch (e) {
    if (e instanceof WebAssembly.RuntimeError) {
      // a wasm fault can corrupt the module state; stop using zbar from now on
      engine.zbar = false;
    }
    console.warn(e);
    return [];
  }
}

async function quredDecode(type, options = {}) {
  // qured.decode() downscales to at most 1400px before decoding; replicate it
  const scale = Math.min(1, 1400 / Math.max(canvas.width, canvas.height));
  const imageData = raster(Math.round(canvas.width * scale), Math.round(canvas.height * scale));

  const barcode = await qured.decodeFromImageData(imageData, options);
  if (barcode) {
    console.info('qured count', 1, type);
    return [{
      origin: 'qured',
      type,
      symbol: barcode.format.toUpperCase().replace('_', '-'),
      data: barcode.text,
      polygon: barcode.points || []
    }];
  }
  console.info('qured count', 0, type);
  return [];
}

// qured multi-code pass; decodeAll() takes a Blob (not ImageData) and reports
// every code it can find, running its own inversion and downscale passes
async function quredMulti() {
  const blob = await canvas.convertToBlob({
    type: 'image/png'
  });
  const barcodes = await qured.decodeAll(blob, {aggressive: true}) || [];
  console.info('qured multi count', barcodes.length);
  return barcodes.map(barcode => ({
    origin: 'qured',
    type: 'image',
    symbol: barcode.format.toUpperCase().replace('_', '-'),
    data: barcode.text,
    polygon: barcode.points || []
  }));
}

async function zxing(type, options) {
  if (!engine.zxing) {
    return [];
  }
  return zxingOn(ctx.getImageData(0, 0, canvas.width, canvas.height), type, {
    ...options
  });
}

async function zxingOn(imageData, type, options = {}) {
  if (!engine.zxing) {
    return [];
  }
  const barcodes = await readBarcodesFromImageData(imageData, {
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 20,
    ...options
  });
  console.info('zxing count', barcodes.length, type);
  const results = [];
  for (const barcode of barcodes) {
    if (!barcode.text) {
      continue;
    }
    const format = barcode.format.toUpperCase();
    results.push({
      origin: 'zxing',
      type,
      symbol: ZXING_TYPES[format] || format,
      data: barcode.text,
      polygon: [
        barcode.position.topLeft,
        barcode.position.topRight,
        barcode.position.bottomRight,
        barcode.position.bottomLeft
      ]
    });
  }
  return results;
}

function raster2(x, y, width, height) {
  const c = new OffscreenCanvas(width, height);
  const cx = c.getContext('2d', {
    willReadFrequently: true
  });
  cx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return cx.getImageData(0, 0, width, height);
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
