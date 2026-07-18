import {QRCode} from './QRCode.mjs';

const args = new URLSearchParams(location.search);
const info = {};
chrome.tabs.query({
  currentWindow: true,
  active: true
}).then(tabs => {
  if (tabs.length) {
    info.tabId = tabs[0].id;
    info.windowId = tabs[0].windowId;
  }
});

const notify = (msg, revert = true) => {
  document.querySelector('[data-message]').dataset.message = msg === undefined ? notify.DEFALUT : msg;
  clearTimeout(notify.id);
  if (revert) {
    notify.id = setTimeout(() => {
      document.querySelector('[data-message]').dataset.message = notify.DEFALUT;
    }, 10000);
  }
};
{
  let id;
  notify.inline = (msg, timeout = 3000) => {
    self.toast.textContent = msg;
    clearTimeout(id);
    if (timeout !== -1) {
      id = setTimeout(() => {
        self.toast.textContent = '';
      }, timeout);
    }
  };
}

notify.DEFALUT = 'Click "Start" to scan QR codes or barcodes with your webcam.' +
  ' You can also paste images from your clipboard using Ctrl + V or drop local files.';
notify(undefined, false);

if (location.href.indexOf('mode=popup') !== -1) {
  document.body.classList.add('popup');
}

const tabsView = document.querySelector('tabs-view');
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d', {
  willReadFrequently: true
});
const video = document.getElementById('video');
const history = document.getElementById('history');
const qrcode = new QRCode();
// to show notify.DEFALUT after process is done
qrcode.clean = new Proxy(qrcode.clean, {
  apply(target, self, args) {
    args[0].removeAttribute('width');
    args[0].removeAttribute('height');
    return Reflect.apply(target, self, args);
  }
});

const prefs = {
  'history': [],
  'auto-start': false,
  'save': true,
  'max': 100
};

const hashCode = s => Array.from(s).reduce((s, c) => Math.imul(31, s) + c.charCodeAt(0) | 0, 0);

const cache = new Set();

const parse = (results, focus = true) => {
  for (let n = 0; n < results.length; n += 1) {
    const e = results[n];
    if (cache.has(e.data) === false) {
      qrcode.draw(e, canvas);
      cache.add(e.data);
    }

    if (tools.stream && tools.stream.active) {
      tools.vidoe.off();
    }
    // add to update history
    tools.append(e, n === 0 ? focus : false);
  }
};

// focus
document.addEventListener('keydown', e => tabsView.keypress(e));
// tools
const tools = {
  vidoe: {
    async on() {
      try {
        const deviceId = document.getElementById('devices').value;
        const o = deviceId ? {
          video: {
            deviceId
          }
        } : {
          video: {
            facingMode: 'environment'
          }
        };

        const stream = tools.stream = video.srcObject = await navigator.mediaDevices.getUserMedia(o);
        video.style.visibility = 'visible';

        const detect = async () => {
          await tools.detect(video).then(parse);
          if (stream.active) {
            clearTimeout(tools.vidoe.id);
            tools.vidoe.id = setInterval(detect, 200);
          }
        };
        detect();
      }
      catch (e) {
        notify.inline(e.message);
      }
    },
    off() {
      clearTimeout(tools.vidoe.id);
      try {
        for (const track of tools.stream.getTracks()) {
          track.stop();
        }
        video.style.visibility = 'hidden';
        qrcode.clean(canvas);
      }
      catch (e) {}
    }
  },
  async detect(source, progress = () => {}) {
    cache.clear();
    await qrcode.ready();

    if (source.tagName === 'IMG') {
      canvas.width = source.naturalWidth;
      canvas.height = source.naturalHeight;

      if (canvas.width && canvas.height) {
        let percent = 0;

        for (const filter of [
          '', 'invert(1)', 'contrast(200%)', 'grayscale(100%)', 'contrast(50%)', 'grayscale(50%)'
        ]) {
          ctx.filter = filter !== 'break' ? filter : '';
          ctx.drawImage(source, 0, 0);

          const type = filter || 'image';

          const results = [];

          results.push(...await qrcode.native(canvas, canvas.width, canvas.height, type));
          percent += 1 / 6 / 3;
          progress(percent);

          ctx.drawImage(source, 0, 0);
          results.push(...await qrcode.zbar(canvas, canvas.width, canvas.height, type));
          percent += 1 / 6 / 3;
          progress(percent);

          ctx.drawImage(source, 0, 0);
          results.push(...await qrcode.qured(canvas, canvas.width, canvas.height, type));
          percent += 1 / 6 / 3;
          progress(percent);

          if (results.length) {
            progress(1);
            return results;
          }
        }
      }
      progress(1);
      return [];
    }
    else if (source.tagName === 'VIDEO') {
      canvas.width = source.videoWidth;
      canvas.height = source.videoHeight;
      const results = [];
      if (canvas.width && canvas.height) {
        progress(0);
        ctx.drawImage(source, 0, 0);
        results.push(...await qrcode.native(canvas, canvas.width, canvas.height, 'video'));

        progress(0.5);
        ctx.drawImage(source, 0, 0);
        results.push(...await qrcode.zbar(canvas, canvas.width, canvas.height, 'video'));
      }


      progress(1);
      return results;
    }
    else {
      throw Error('source is not supported');
    }
  },
  append(e, focus = true) {
    const id = 'q-' + hashCode(e.data);
    const div = document.getElementById(id);
    if (div) {
      history.insertAdjacentElement('afterbegin', div);
    }
    else {
      const urlify = content => {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return content.replace(urlRegex, '<a href="$1" target=_blank class="link">$1</a>');
      };

      const div = document.createElement('label');
      div.data = e.data;
      div.id = id;
      const input = document.createElement('input');
      input.type = 'checkbox';

      const symbol = document.createElement('span');
      symbol.textContent = 'Type: ' + e.symbol;
      const content = document.createElement('pre');
      content.innerHTML = urlify(e.data);
      div.append(input);
      div.append(symbol);
      div.append(content);
      history.insertAdjacentElement('afterbegin', div);
      if (prefs.save) {
        prefs.history = prefs.history.filter(o => o.data !== e.data);
        prefs.history.unshift({
          data: e.data,
          symbol: e.symbol
        });
        prefs.history = prefs.history.slice(0, prefs.max);
        chrome.storage.local.set({
          history: prefs.history
        });
      }
    }

    if (focus) {
      tabsView.keypress({
        metaKey: true,
        code: 'Digit2',
        key: 2
      });
    }
  }
};

// tab change
tabsView.addEventListener('tabs-view::change', ({detail}) => {
  if (detail.dataset.tab === 'scan' && document.getElementById('auto-start').checked) {
    tools.vidoe.on();
  }
  if (detail.dataset.tab === 'results' && tools.stream && tools.stream.active) {
    tools.vidoe.off();
  }
});

// on image
const listen = () => {
  const jobs = [];
  let counter = 0;
  const errors = [];
  let total = 0;

  const add = (...files) => {
    if (files.length) {
      total += files.length;
      jobs.push(...files);
      next();
    }
  };

  const next = async () => {
    if (next.busy) {
      return;
    }
    next.busy = true;

    const file = jobs.shift();
    if (file) {
      const delta = 1 / total * 100;
      const pv = (total - jobs.length - 1) / total * 100;
      self.progress.value = pv;

      notify.inline(`Working on Image ${total - jobs.length}/${total}...`, -1);
      await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() {
          // works on transparent codes
          tools.detect(img, progress => self.progress.value = pv + delta * progress).then(results => {
            parse(results, counter === 0);
            counter += results.length;
          }).catch(e => errors.push(e)).finally(resolve);
        };
        img.onerror = e => {
          errors.push('Cannot load this image');
          resolve();
        };
        img.src = typeof file === 'string' ? file : URL.createObjectURL(file);
      });
      next.busy = false;
      next();
    }
    else {
      if (counter === 0) {
        if (errors.length === 0) {
          qrcode.clean(canvas);
          notify.inline('Cannot detect any type of barcode in this image');
        }
        else {
          notify.inline(
            errors.find(e => e) ||
            'Loading failed. Use right-click context menu over the toolbar button to allow cross-origin access'
          );
        }
      }
      else {
        notify.inline('', -1);
      }

      total = 0;
      counter = 0;
      errors.length = 0;
      self.progress.value = 100;
      next.busy = false;
    }
  };
  document.querySelector('input[type=file]').addEventListener('change', e => {
    tools.vidoe.off();
    add(...e.target.files);
    e.target.value = '';
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', async e => {
    e.preventDefault();

    const files = new Set();
    const images = new Set();

    for (const file of e.dataTransfer.items) {
      if (file.kind === 'file' && file.type.startsWith('image/')) {
        files.add(file.getAsFile());
      }
      if (file.type === 'text/html') {
        let found = false;
        const html = e.dataTransfer.getData('text/html');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        for (const img of doc.querySelectorAll('img')) {
          const base = e.dataTransfer.getData('text/uri-list') || location.href;
          images.add(new URL(img.getAttribute('src'), base).href);
          found = true;
        }
        if (!found) {
          const a = doc.querySelector('a[href]');
          if (a) {
            images.add(a.href);
            found = true;
          }
        }
        if (!found) {
          const url = (e.dataTransfer.getData('text/uri-list') || '').trim();
          if (url) {
            images.add(url);
            found = true;
          }
        }
      }
    }
    const origins = [...images].filter(a => a.startsWith('http'));
    if (origins.size) {
      await chrome.permissions.request({
        origins
      }).catch(() => {});
    }

    add(...files);
    add(...images);
  });
  document.addEventListener('paste', e => {
    const items = [...e.clipboardData.items].filter(o => o.type.includes('image'));

    for (const item of items) {
      add(item.getAsFile());
    }
    if (items.length === 0) {
      notify.inline('No image found in the clipboard');
    }
  });

  if (args.has('href')) {
    add(args.get('href'));
  }
  if (args.get('mode') === 'sidebar') {
    chrome.runtime.sendMessage({
      method: 'args'
    }, o => {
      if (o && o.href) {
        add(o.href);
      }
    });
    chrome.runtime.onMessage.addListener(request => {
      if (request.href && request.method === 'sidebar-action' && request.windowId === info.windowId) {
        // clean
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        notify.inline('Preparing...', false);
        // proceed
        if (tabsView.active().dataset.tab === 'results') {
          tabsView.addEventListener('tabs-view::change', () => {
            add(request.href);
          }, {once: true});

          tabsView.keypress({
            metaKey: true,
            code: 'Digit1',
            key: 1
          });
        }
        else {
          add(request.href);
        }
      }
    });
  }
};

// init
document.addEventListener('DOMContentLoaded', () => {
  // next
  const next = () => chrome.storage.local.get(prefs, ps => {
    Object.assign(prefs, ps);
    document.getElementById('auto-start').checked = prefs['auto-start'];
    // tabsView already loaded
    if (
      prefs['auto-start'] && tabsView.ready && tabsView.active().dataset.tab === 'scan' && args.has('href') === false
    ) {
      tools.vidoe.on();
    }
    // history
    if (prefs.save) {
      for (const e of prefs.history.reverse()) {
        tools.append(e, false);
      }
    }
    //
    listen();
  });

  chrome.runtime.sendMessage({
    method: 'me'
  }, tabId => {
    // install network
    if (chrome.declarativeNetRequest && /Firefox/.test(navigator.userAgent) === false) {
      if (tabId) {
        chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [tabId],
          addRules: [{
            'id': tabId,
            'priority': 1,
            'action': {
              'type': 'modifyHeaders',
              'requestHeaders': [{
                'operation': 'remove',
                'header': 'origin'
              }],
              'responseHeaders': [{
                'operation': 'set',
                'header': 'Access-Control-Allow-Origin',
                'value': '*'
              }]
            },
            'condition': {
              'resourceTypes': ['image'],
              'tabIds': [tabId]
            }
          }]
        }, next);
      }
      else {
        next();
      }
    }
    else {
      next();
    }
  });
});

// prefs
document.getElementById('auto-start').addEventListener('change', e => {
  chrome.storage.local.set({
    'auto-start': e.target.checked
  });
  tools.vidoe[e.target.checked ? 'on' : 'off']();
});
// video
video.addEventListener('play', () => {
  document.getElementById('display').dataset.mode = 'video';
  document.getElementById('toggle').textContent = 'Stop';
});
video.addEventListener('suspend', () => {
  document.getElementById('display').dataset.mode = 'image';
  document.getElementById('toggle').textContent = 'Start';
});
// toggle
document.getElementById('toggle').addEventListener('click', () => {
  if (tools.stream && tools.stream.active) {
    tools.vidoe.off();
  }
  else {
    tools.vidoe.on();
  }
});
// clean
document.getElementById('clean').addEventListener('click', () => {
  if (window.confirm('Delete the entire history?')) {
    chrome.storage.local.remove('history', () => {
      history.textContent = '';
      qrcode.clean(canvas);
      // tools.vidoe.off();
      tabsView.keypress({
        metaKey: true,
        code: 'Digit1',
        key: 1
      });
    });
  }
});

document.getElementById('history').onchange = () => {
  const b = Boolean(document.querySelector('#history input:checked'));

  document.getElementById('copy').disabled = !b;
  document.getElementById('delete').disabled = !b;
};


document.getElementById('copy').addEventListener('click', e => {
  const content = [...document.querySelectorAll('#history input:checked')]
    .map(e => e.closest('label').data)
    .join('\n\n');

  navigator.clipboard.writeText(content).then(() => {
    e.target.value = 'Done!';
    setTimeout(() => e.target.value = 'Copy', 750);
  });
});

document.getElementById('delete').addEventListener('click', () => {
  const ds = [...document.querySelectorAll('#history input:checked')]
    .map(e => {
      const div = e.closest('label');
      const content = div.data;
      div.remove();

      return content;
    });

  chrome.storage.local.get({
    history: []
  }, prefs => {
    prefs.history = prefs.history.filter(o => ds.includes(o.data) === false);
    chrome.storage.local.set(prefs);
  });
});

// Camera selector
chrome.storage.local.get({
  camera: 0
}, prefs => {
  navigator.mediaDevices.enumerateDevices().then(devices => {
    const videoinputs = devices.filter(d => d.kind === 'videoinput');

    const parent = document.getElementById('devices');
    for (const device of videoinputs) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${parent.length + 1}`;
      parent.appendChild(option);
    }
    parent.selectedIndex = prefs.camera;
  }).catch(e => console.warn(e));
});
document.getElementById('devices').addEventListener('change', e => chrome.storage.local.set({
  camera: e.target.selectedIndex
}, () => {
  tools.vidoe.off();
  tools.vidoe.on();
}));

// link opening
document.addEventListener('click', e => {
  if (e.target.classList.contains('link') && e.isTrusted) {
    e.preventDefault();
    chrome.storage.local.get({
      'open-links-windows': false
    }, prefs => {
      if (prefs['open-links-windows']) {
        chrome.windows.create({
          url: e.target.href
        });
      }
      else {
        e.target.click();
      }
    });
  }
}, true);
