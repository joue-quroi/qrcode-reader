'use strict';

const onCommand = (o = {}) => chrome.storage.local.get({
  mode: 'window'
}, async prefs => {
  const args = new URLSearchParams();
  for (const [key, value] of Object.entries(o)) {
    args.set(key, value);
  }

  if (prefs.mode === 'tab') {
    args.set('mode', 'tab');
    chrome.tabs.create({
      url: 'data/window/index.html?' + args.toString()
    });
  }
  else {
    const win = await chrome.windows.getCurrent();

    args.set('mode', 'window');
    chrome.storage.local.get({
      'window.width': 400,
      'window.height': 600,
      'window.left': win.left + Math.round((win.width - 400) / 2),
      'window.top': win.top + Math.round((win.height - 600) / 2)
    }, prefs => {
      chrome.windows.create({
        url: '/data/window/index.html?' + args.toString(),
        width: prefs['window.width'],
        height: prefs['window.height'],
        left: prefs['window.left'],
        top: prefs['window.top'],
        type: 'popup'
      });
    });
  }
});

chrome.action.onClicked.addListener(() => onCommand());

const startup = () => {
  chrome.contextMenus.create({
    title: 'Mode',
    id: 'mode',
    contexts: ['action']
  });
  chrome.contextMenus.create({
    title: 'Options',
    id: 'options',
    contexts: ['action']
  });
  if (/Firefox/.test(navigator.userAgent) === false) {
    chrome.contextMenus.create({
      title: 'Allow Cross Origin Image Rendering',
      id: 'cors',
      parentId: 'options',
      contexts: ['action']
    });
  }

  chrome.storage.local.get({
    'mode': 'window',
    'show-on-image': true
  }, prefs => {
    chrome.contextMenus.create({
      title: 'Open in Window',
      id: 'window',
      contexts: ['action'],
      type: 'radio',
      checked: prefs.mode === 'window',
      parentId: 'mode'
    });
    chrome.contextMenus.create({
      title: 'Open in Tab',
      id: 'tab',
      contexts: ['action'],
      type: 'radio',
      checked: prefs.mode === 'tab',
      parentId: 'mode'
    });
    chrome.contextMenus.create({
      title: 'Open in Popup',
      id: 'popup',
      contexts: ['action'],
      type: 'radio',
      checked: prefs.mode === 'popup',
      parentId: 'mode'
    });
    chrome.action.setPopup({
      popup: prefs.mode === 'popup' ? 'data/window/index.html?mode=popup' : ''
    });
    chrome.contextMenus.create({
      title: 'Show Image Context Menu',
      id: 'show-on-image',
      contexts: ['action'],
      type: 'checkbox',
      checked: prefs['show-on-image'],
      parentId: 'options'
    });
    chrome.contextMenus.create({
      title: 'Open with QR Code Reader',
      id: 'open-with',
      contexts: ['image'],
      visible: prefs['show-on-image']
    });
  });
};
chrome.runtime.onInstalled.addListener(startup);
chrome.runtime.onStartup.addListener(startup);

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'cors') {
    chrome.permissions.request({
      permissions: ['declarativeNetRequestWithHostAccess'],
      origins: ['*://*/*']
    }, () => chrome.runtime.reload());
  }
  else if (info.menuItemId === 'open-with') {
    onCommand({
      href: info.srcUrl
    });
  }
  else if (info.menuItemId === 'show-on-image') {
    chrome.storage.local.set({
      'show-on-image': info.checked
    });
    chrome.contextMenus.update('open-with', {
      visible: info.checked
    });
  }
  else {
    chrome.storage.local.set({
      mode: info.menuItemId
    });
  }
});

chrome.storage.onChanged.addListener(prefs => {
  if (prefs.mode) {
    chrome.action.setPopup({
      popup: prefs.mode.newValue === 'popup' ? 'data/window/index.html?mode=popup' : ''
    });
  }
});

if (chrome.declarativeNetRequest) {
  chrome.tabs.onRemoved.addListener(tabId => chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId]
  }).catch(() => {}));
}

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'me') {
    response(sender?.tab?.id);
  }
});

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const page = getManifest().homepage_url;
    const {name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, currentWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
