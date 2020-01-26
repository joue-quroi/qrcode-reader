/* global Module */
'use strict';

window.Module = {

  onRuntimeInitialized() {
    Module.onReady = () => Promise.resolve();
    for (const resolve of Module.onReadyCache) {
      resolve();
    }
    delete Module.onReadyCache;
  },
  onReadyCache: [],
  onReady() {
    return new Promise(resolve => {
      Module.onReadyCache.push(resolve);
    });
  }
};

class QRCode {
  constructor(canvas) {
    canvas = canvas || document.createElement('canvas');
    Object.assign(this, {
      ctx: canvas.getContext('2d'),
      canvas
    });
    this.events = {};
  }
  async ready() {
    await Module.onReady();
    this.api = {
      scanImage: Module.cwrap('scan_image', '', ['number', 'number', 'number']),
      createBuffer: Module.cwrap('create_buffer', 'number', ['number', 'number']),
      destroyBuffer: Module.cwrap('destroy_buffer', '', ['number'])
    };
    // set the function that should be called whenever a barcode is detected
    Module['processResult'] = (symbol, data, polygon) => this.emit('detect', {
      symbol,
      data,
      polygon
    });
    this.ready = () => Promise.resolve();
  }
  detect(source, width, height) {
    const {api, canvas, ctx} = this;
    Object.assign(canvas, {
      width,
      height
    });
    // grab a frame from the media source and draw it to the canvas
    ctx.drawImage(source, 0, 0, width, height);
    // get the image data from the canvas
    const image = ctx.getImageData(0, 0, width, height);

    // convert the image data to grayscale
    const grayData = [];
    const d = image.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      grayData[j] = (d[i] * 66 + d[i + 1] * 129 + d[i + 2] * 25 + 4096) >> 8;
    }
    // put the data into the allocated buffer
    const p = this.api.createBuffer(image.width, image.height);
    Module.HEAP8.set(grayData, p);
    // call the scanner function
    api.scanImage(p, image.width, image.height);
    // destroy
    api.destroyBuffer(p);
  }
  rect(e) {
    const xs = [
      Math.min(...e.polygon.filter((a, i) => i % 2 === 0)),
      Math.max(...e.polygon.filter((a, i) => i % 2 === 0))
    ];
    const ys = [
      Math.min(...e.polygon.filter((a, i) => i % 2 === 1)),
      Math.max(...e.polygon.filter((a, i) => i % 2 === 1))
    ];
    if (e.symbol === 'QR-Code') {
      return [e.polygon[0], e.polygon[1], xs[1] - e.polygon[0], ys[1] - e.polygon[1]];
    }
    else {
      return [e.polygon[0], e.polygon[1], xs[0] - e.polygon[0], ys[1] - e.polygon[1]];
    }
  }
  draw(e, canvas = this.canvas) {
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 1;
    ctx.setLineDash([6]);
    ctx.strokeStyle = 'blue';
    ctx.strokeRect(...this.rect(e));
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
