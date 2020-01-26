'use strict';

chrome.browserAction.onClicked.addListener(() => chrome.tabs.create({
  url: 'data/window/index.html'
}));
