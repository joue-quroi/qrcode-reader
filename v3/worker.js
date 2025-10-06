'use strict';

const onCommand = async (tab, o = {}) => {
  const prefs = await chrome.storage.local.get({
    mode: 'window'
  });

  const args = new URLSearchParams();
  for (const [key, value] of Object.entries(o)) {
    args.set(key, value);
  }
  onCommand.args = o;

  if (prefs.mode === 'tab') {
    args.set('mode', 'tab');
    chrome.tabs.create({
      url: 'data/window/index.html?' + args.toString()
    });
  }
  else if (prefs.mode === 'sidebar') {
    chrome.runtime.sendMessage({
      method: 'sidebar-action',
      windowId: tab.windowId,
      ...o
    }).catch(() => {});
    chrome.sidePanel.open({
      windowId: tab.windowId
    });
  }
  else {
    const win = await chrome.windows.getCurrent();
    args.set('mode', 'window');
    const prefs = await chrome.storage.local.get({
      'window.width': 400,
      'window.height': 600,
      'window.left': win.left + Math.round((win.width - 400) / 2),
      'window.top': win.top + Math.round((win.height - 600) / 2)
    });
    chrome.windows.create({
      url: '/data/window/index.html?' + args.toString(),
      width: prefs['window.width'],
      height: prefs['window.height'],
      left: prefs['window.left'],
      top: prefs['window.top'],
      type: 'popup'
    });
  }
};

chrome.action.onClicked.addListener(tab => onCommand(tab, {}));

const startup = async () => {
  if (startup.done) {
    return;
  }
  startup.done = true;

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
  chrome.contextMenus.create({
    title: 'Allow Cross Origin Image Rendering',
    id: 'cors',
    parentId: 'options',
    contexts: ['action']
  });

  const prefs = await chrome.storage.local.get({
    'mode': 'window',
    'show-on-image': true,
    'open-links-windows': false,
    'save': true
  });
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
  chrome.contextMenus.create({
    title: 'Open in Side Panel',
    id: 'sidebar',
    contexts: ['action'],
    type: 'radio',
    checked: prefs.mode === 'sidebar',
    parentId: 'mode',
    enabled: navigator.userAgent.includes('Edg/') === false && navigator.userAgent.includes('Firefox/') === false
  });
  chrome.action.setPopup({
    popup: prefs.mode === 'popup' ? 'data/window/index.html?mode=popup' : ''
  });
  chrome.sidePanel?.setOptions({
    path: 'data/window/index.html?mode=sidebar',
    enabled: prefs.mode === 'sidebar'
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
    title: 'Open Links in New Windows',
    id: 'open-links-windows',
    contexts: ['action'],
    type: 'checkbox',
    checked: prefs['open-links-windows'],
    parentId: 'options'
  });
  chrome.contextMenus.create({
    title: 'Save Scanned Codes',
    id: 'save',
    contexts: ['action'],
    type: 'checkbox',
    checked: prefs['save'],
    parentId: 'options'
  });
  chrome.contextMenus.create({
    title: 'Open with QR Code Reader',
    id: 'open-with',
    contexts: ['image'],
    visible: prefs['show-on-image']
  });
};
chrome.runtime.onInstalled.addListener(startup);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'cors') {
    chrome.permissions.request({
      origins: ['*://*/*']
    }, () => chrome.runtime.reload());
  }
  else if (info.menuItemId === 'open-with') {
    onCommand(tab, {
      href: info.srcUrl
    });
  }
  else if (info.menuItemId === 'open-links-windows') {
    chrome.storage.local.set({
      'open-links-windows': info.checked
    });
  }
  else if (info.menuItemId === 'save') {
    chrome.storage.local.set({
      'save': info.checked
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
    if (info.menuItemId === 'sidebar') {
      chrome.permissions.request({
        permissions: ['sidePanel']
      }, g => {
        if (g) {
          chrome.storage.local.set({
            mode: info.menuItemId
          });
        }
        else {
          chrome.storage.local.get({
            'mode': 'window'
          }, prefs => chrome.contextMenus.update(prefs.mode, {
            checked: true
          }));
        }
      });
    }
    else {
      chrome.storage.local.set({
        mode: info.menuItemId
      });
    }
  }
});

chrome.storage.onChanged.addListener(prefs => {
  if (prefs.mode) {
    chrome.action.setPopup({
      popup: prefs.mode.newValue === 'popup' ? 'data/window/index.html?mode=popup' : ''
    });
    chrome.sidePanel?.setOptions({
      enabled: prefs.mode.newValue === 'sidebar'
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
  else if (request.method === 'args') {
    response(onCommand.args || {});
  }
});

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const {homepage_url: page, name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, lastFocusedWindow: true}, tbs => tabs.create({
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
