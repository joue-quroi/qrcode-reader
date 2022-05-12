/* global QRCode */
'use strict';

const notify = (msg, revert = true) => {
  document.querySelector('[data-message]').dataset.message = msg === undefined ? notify.DEFALUT : msg;
  clearTimeout(notify.id);
  if (revert) {
    notify.id = setTimeout(() => {
      document.querySelector('[data-message]').dataset.message = notify.DEFALUT;
    }, 3000);
  }
};
notify.DEFALUT = 'Click on the "Start" button to scan from webcam or drop a local QR code or Bar code';

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
        tools.vidoe.id = window.setInterval(detect, 200);
        detect();
      }).catch(e => {
        notify(e.message);
      });
    },
    off() {
      window.clearInterval(tools.vidoe.id);
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
        return content.replace(urlRegex, '<a href="$1" target=_blank>$1</a>');
      };

      const div = document.createElement('div');
      div.id = id;
      const symbol = document.createElement('span');
      symbol.textContent = 'Type: ' + e.symbol;
      const content = document.createElement('pre');
      content.innerHTML = urlify(e.data);
      div.appendChild(symbol);
      div.appendChild(content);
      history.insertAdjacentElement('afterbegin', div);
      if (prefs.save) {
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
{
  const next = file => {
    const img = new Image();
    img.onload = function() {
      notify('', false);
      const ctx = canvas.getContext('2d');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      tools.detect(img, img.naturalWidth, img.naturalHeight);
    };
    img.src = URL.createObjectURL(file);
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
}

// init
chrome.storage.local.get(prefs, ps => {
  Object.assign(prefs, ps);
  document.getElementById('auto-start').checked = prefs['auto-start'];
  // tabsView already loaded
  if (prefs['auto-start'] && tabsView.ready && tabsView.active().dataset.tab === 'scan') {
    tools.vidoe.on();
  }
  else {
    notify(undefined, false);
  }
  // history
  for (const e of prefs.history.reverse()) {
    tools.append(e, false);
  }
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
    });
  }
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
