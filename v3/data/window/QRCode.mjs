/* global instantiate, BarcodeDetector */

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

class WasmQRCode {
  constructor(canvas) {
    canvas = canvas || document.createElement('canvas');
    Object.assign(this, {
      ctx: canvas.getContext('2d', {
        willReadFrequently: true
      }),
      canvas
    });
    this.events = {};
  }
  ready() {
    if (this.inst) {
      return Promise.resolve();
    }
    return instantiate().then(o => {
      this.inst = o;
      this.ptr = o._ImageScanner_create();
    });
  }
  async qured(source, width, height, type) {
    const {canvas, ctx} = this;
    Object.assign(canvas, {
      width,
      height
    });
    ctx.drawImage(source, 0, 0, width, height);

    const barcode = await qured.decode(canvas.toDataURL());
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
  zbar(source, width, height, type) {
    const {canvas, ctx} = this;
    Object.assign(canvas, {
      width,
      height
    });
    ctx.drawImage(source, 0, 0, width, height);
    const dataBuf = ctx.getImageData(0, 0, width, height).data;
    // write to WASM
    const heap = this.inst.HEAPU8;
    const data = new Uint8Array(dataBuf);
    const len = width * height;
    if (len * 4 !== data.byteLength) {
      throw Error('dataBuf does not match width and height');
    }
    const buf = this.inst._malloc(len);
    for (let i = 0; i < len; ++i) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      heap[buf + i] = (r * 19595 + g * 38469 + b * 7472) >> 16;
    }
    const imagePtr = this.inst._Image_create(width, height, 0x30303859 /* Y800 */, buf, len, 1);
    // scan
    const count = this.inst._ImageScanner_scan(this.ptr, imagePtr);
    console.info('zbar count', count, type);
    // read results
    const res = this.inst._Image_get_symbols(imagePtr);
    const results = [];
    if (res !== 0) {
      const set = new SymbolSetPtr(res, this.inst.HEAPU8.buffer);
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
    this.inst._Image_destory(imagePtr);

    return Promise.resolve(results);
  }
  draw(e, canvas = this.canvas) {
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = ctx.fillStyle = {
      'zbar': 'blue',
      'qured': 'green'
    }[e.origin] || 'red';
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 5;

    if (e.polygon.length === 2) {
      const xmin = Math.min(...e.polygon.map(o => o.x));
      const xmax = Math.max(...e.polygon.map(o => o.x));
      const ymin = Math.min(...e.polygon.map(o => o.y));
      const ymax = Math.max(...e.polygon.map(o => o.y));
      ctx.fillRect(xmin, ymin, (xmax - xmin) || 10, (ymax - ymin) || 10);
    }
    else {
      ctx.beginPath();
      ctx.moveTo(e.polygon[0].x, e.polygon[0].y);
      for (let i = 1; i < e.polygon.length; i++) {
        ctx.lineTo(e.polygon[i].x, e.polygon[i].y);
      }
      ctx.closePath(); // connects last vertex to first
      ctx.fill();
    }
  }
  clean(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  on(name, c) {
    this.events[name] = this.events[name] || [];
    this.events[name].push(c);
  }
  emit(name, ...args) {
    for (const c of (this.events[name] || [])) {
      c(...args);
    }
  }
}

export class QRCode extends WasmQRCode {
  constructor(...args) {
    super(...args);

    if (typeof BarcodeDetector !== 'undefined') {
      BarcodeDetector.getSupportedFormats().then(supportedFormats => {
        if (supportedFormats.length) {
          this.barcodeDetector = new BarcodeDetector({formats: supportedFormats});
        }
      });
    }
  }
  native(source, width, height, type) {
    if (this.barcodeDetector) {
      // use native
      const {canvas, ctx} = this;
      Object.assign(canvas, {
        width,
        height
      });
      ctx.drawImage(source, 0, 0, width, height);

      return this.barcodeDetector.detect(canvas).then(barcodes => {
        const results = [];
        for (const barcode of barcodes) {
          results.push({
            origin: 'native',
            type,
            symbol: barcode.format.toUpperCase().replace('_', '-'),
            data: barcode.rawValue,
            polygon: barcode.cornerPoints
          });
        }
        console.info('native count', barcodes.length, type);

        return results;
      });
    }

    return [];
  }
}
