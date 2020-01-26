/* global QRCode */
'use strict';

const tabsView = document.querySelector('tabs-view');
const canvas = document.querySelector('canvas');
const video = document.getElementById('video');
const history = document.getElementById('history');
const qrcode = new QRCode();

const prefs = {
  'history': [],
  'auto-start': true,
  'save': true,
  'max': 30
};

const hashCode = s => Array.from(s).reduce((s, c) => Math.imul(31, s) + c.charCodeAt(0) | 0, 0);

qrcode.on('detect', e => {
  qrcode.draw(e, canvas);
  // add to update history
  tools.append(e);
});

// focus
document.addEventListener('keydown', e => tabsView.keypress(e));
// tools
const tools = {
  vidoe: {
    on() {
      navigator.mediaDevices.getUserMedia({
        video: true
      }).then(stream => {
        tools.stream = stream;
        document.querySelector('[data-id="scan"]').dataset.message = '';
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
        document.querySelector('[data-id="scan"]').dataset.message = e.message;
      });
    },
    off() {
      document.querySelector('[data-id="scan"]').dataset.message = 'Click on the "Start" button to scan from webcam or drop a local QR code or Bar code';
      window.clearInterval(tools.vidoe.id);
      try {
        for (const track of tools.stream.getTracks()) {
          track.stop();
        }
        video.style.visibility = 'hidden';
      }
      catch (e) {}
    }
  },
  async detect(source, width, height) {
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
      const div = document.createElement('div');
      div.id = id;
      const symbol = document.createElement('span');
      symbol.textContent = e.symbol;
      const content = document.createElement('pre');
      content.textContent = e.data;
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
      window.setTimeout(() => tabsView.keypress({
        metaKey: true,
        code: 'Digit2',
        key: 2
      }), 1000);
    }
  }
};

// tab change
tabsView.addEventListener('tabs-view::change', ({detail}) => {
  if (detail.dataset.id === 'scan' && document.getElementById('auto-start').checked) {
    tools.vidoe.on();
  }
  else {
    tools.vidoe.off();
  }
});

// on image
{
  const next = file => {
    const img = new Image();
    img.onload = function() {
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
    next(e.target.files[0]);
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
  if (prefs['auto-start'] && tabsView.ready && tabsView.active().dataset.id === 'scan') {
    tools.vidoe.on();
  }
  else {
    tools.vidoe.off();
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
  document.getElementById('toggle').value = 'Stop';
});
video.addEventListener('suspend', () => {
  document.getElementById('toggle').value = 'Start';
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