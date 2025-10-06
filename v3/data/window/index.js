/* global QRCode */
'use strict';

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
notify.DEFALUT = 'Click "Start" to scan QR codes or barcodes with your webcam.' +
  ' You can also paste images from your clipboard using Ctrl + V or drop local files.';

if (location.href.indexOf('mode=popup') !== -1) {
  document.body.classList.add('popup');
}

const tabsView = document.querySelector('tabs-view');
const canvas = document.querySelector('canvas');
const video = document.getElementById('video');
const history = document.getElementById('history');
const qrcode = new QRCode();

const prefs = {
  'history': [],
  'auto-start': false,
  'save': true,
  'max': 100
};

const hashCode = s => Array.from(s).reduce((s, c) => Math.imul(31, s) + c.charCodeAt(0) | 0, 0);

const cache = new Set();

qrcode.on('detect', e => {
  if (cache.has(e.data) === false) {
    qrcode.draw(e, canvas);
    cache.add(e.data);
  }

  if (tools.stream && tools.stream.active) {
    tools.vidoe.off();
  }
  // add to update history
  tools.append(e);
});

// focus
document.addEventListener('keydown', e => tabsView.keypress(e));
// tools
const tools = {
  vidoe: {
    on() {
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

      navigator.mediaDevices.getUserMedia(o).then(stream => {
        tools.stream = stream;

        notify('', false);
        video.srcObject = stream;
        video.style.visibility = 'visible';
        const detect = () => {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          if (canvas.width && canvas.height) {
            tools.detect(video, canvas.width, canvas.height);
          }
        };
        tools.vidoe.id = setInterval(detect, 200);
        detect();
      }).catch(e => {
        notify(e.message);
      });
    },
    off() {
      clearInterval(tools.vidoe.id);
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
  async detect(source, width, height) {
    cache.clear();
    await qrcode.ready();
    qrcode.detect(source, width, height);
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
  const next = file => {
    console.log(file);
    document.title = 'Loading Image ...';
    notify('Loading...', false);

    const img = new Image();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      document.title = chrome.runtime.getManifest().name;
      notify('', false);
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.fillStyle = '#fff';
      // works on transparent codes
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      tools.detect(canvas, img.naturalWidth, img.naturalHeight);
    };
    img.onerror = e => {
      document.title = 'Loading Failed!';
      notify(
        e.message ||
        'Loading failed. Use right-click context menu over the toolbar button to allow cross-origin access'
      );
    };
    img.src = typeof file === 'string' ? file : URL.createObjectURL(file);
  };
  document.querySelector('input[type=file]').addEventListener('change', e => {
    tools.vidoe.off();

    next(e.target.files[0]);
    e.target.value = '';
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    for (const file of e.dataTransfer.items) {
      if (file.kind === 'file' && file.type.startsWith('image/')) {
        return next(file.getAsFile());
      }
    }
  });
  document.addEventListener('paste', e => {
    const items = [...e.clipboardData.items].filter(o => o.type.includes('image'));

    for (const item of items) {
      console.log(item, item.getAsFile());
      next(item.getAsFile());
    }
    if (items.length === 0) {
      notify('No image found in the clipboard');
    }
  });

  if (args.has('href')) {
    next(args.get('href'));
  }
  if (args.get('mode') === 'sidebar') {
    chrome.runtime.sendMessage({
      method: 'args'
    }, o => {
      if (o && o.href) {
        next(o.href);
      }
    });
    chrome.runtime.onMessage.addListener(request => {
      if (request.href && request.method === 'sidebar-action' && request.windowId === info.windowId) {
        // clean
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        notify('Preparing...', false);
        // proceed
        if (tabsView.active().dataset.tab === 'results') {
          tabsView.addEventListener('tabs-view::change', () => {
            next(request.href);
          }, {once: true});

          tabsView.keypress({
            metaKey: true,
            code: 'Digit1',
            key: 1
          });
        }
        else {
          next(request.href);
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
    else {
      notify(undefined, false);
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
  notify(undefined, false);
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
      notify(undefined, false);
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
