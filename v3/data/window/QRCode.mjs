export class QRCode {
  constructor() {
    this.id = 0;
    this.jobs = new Map();
    this.worker = null;
    this.failed = false;
  }
  ready() {
    if (this.workerReady) {
      return this.workerReady;
    }
    const worker = this.worker = new Worker(new URL('./engine.worker.mjs', import.meta.url), {
      type: 'module'
    });
    worker.onmessage = ({data}) => {
      if (data.type === 'ready') {
        this.readyResolve();
      }
      else if (data.type === 'init-error') {
        this.readyReject(new Error(data.message));
      }
      else if (this.jobs.has(data.id)) {
        const job = this.jobs.get(data.id);
        if (data.type === 'progress') {
          job.progress(data.value);
        }
        else if (data.type === 'done') {
          this.jobs.delete(data.id);
          job.resolve([data.results, data.bitmap]);
        }
        else if (data.type === 'error') {
          this.jobs.delete(data.id);
          job.reject(new Error(data.message));
        }
      }
    };
    worker.onerror = e => {
      e.preventDefault();
      this.failed = true;
      this.fail(e.message || 'Engine worker error');
    };
    this.workerReady = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    return this.workerReady;
  }
  fail(message) {
    const error = new Error(message);
    this.readyReject(error);
    for (const [, job] of this.jobs) {
      job.reject(error);
    }
    this.jobs.clear();
  }
  run(bitmap, kind, progress = () => {}) {
    if (this.failed) {
      return Promise.reject(new Error('Engine worker failed to load'));
    }
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, {resolve, reject, progress});
      this.worker.postMessage({id, kind, bitmap}, [bitmap]);
    });
  }
  draw(e, canvas) {
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
}
