'use strict';

chrome.browserAction.onClicked.addListener(() => {
  chrome.storage.local.get({
    mode: 'window'
  }, prefs => {
    if (prefs.mode === 'tab') {
      chrome.tabs.create({
        url: 'data/window/index.html?mode=tab'
      });
    }
    else {
      chrome.storage.local.get({
        'window.width': 400,
        'window.height': 600,
        'window.left': screen.availLeft + Math.round((screen.availWidth - 400) / 2),
        'window.top': screen.availTop + Math.round((screen.availHeight - 600) / 2)
      }, prefs => {
        chrome.windows.create({
          url: chrome.extension.getURL('data/window/index.html?mode=window'),
          width: prefs['window.width'],
          height: prefs['window.height'],
          left: prefs['window.left'],
          top: prefs['window.top'],
          type: 'popup'
        });
      });
    }
  });
});

const startup = () => chrome.storage.local.get({
  mode: 'window'
}, prefs => {
  chrome.contextMenus.create({
    title: 'Open in Window',
    id: 'window',
    contexts: ['browser_action'],
    type: 'radio',
    checked: prefs.mode === 'window'
  });
  chrome.contextMenus.create({
    title: 'Open in Tab',
    id: 'tab',
    contexts: ['browser_action'],
    type: 'radio',
    checked: prefs.mode === 'tab'
  });
  chrome.contextMenus.create({
    title: 'Open in Popup',
    id: 'popup',
    contexts: ['browser_action'],
    type: 'radio',
    checked: prefs.mode === 'popup'
  });
  chrome.browserAction.setPopup({
    popup: prefs.mode === 'popup' ? 'data/window/index.html?mode=popup' : ''
  });
});
chrome.runtime.onInstalled.addListener(startup);
chrome.runtime.onStartup.addListener(startup);

chrome.contextMenus.onClicked.addListener(info => chrome.storage.local.set({
  mode: info.menuItemId
}));

chrome.storage.onChanged.addListener(prefs => {
  if (prefs.mode) {
    chrome.browserAction.setPopup({
      popup: prefs.mode.newValue === 'popup' ? 'data/window/index.html?mode=popup' : ''
    });
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
