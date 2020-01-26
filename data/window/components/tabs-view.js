class TabsView extends HTMLElement {
  constructor() {
    super();
    this.config = {
      patch: 30, // number of entries on each step request
      timeout: 500 // ms to click the panel on scroll
    };
    this.ready = false;
    const shadow = this.attachShadow({
      mode: 'closed'
    });
    shadow.innerHTML = `
      <style>
        :host {
          --bg-white: #fff;
          --bg-dark: #f3f3f3;
          --border: #cdcdcd;

          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
        }
        #tabs-container {
          display: flex;
          background-color: var(--bg-dark);
          outline: none;
          margin-bottom: -1px;
          z-index: 1;
        }
        #tabs {
          flex: 1;
          white-space: nowrap;
          overflow: auto;
        }
        #tabs > span {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 80px;
          cursor: pointer;
          padding: 8px 10px;
          margin-right: -1px;
          border: solid 1px var(--border);
          border-left-color: transparent;
          border-top-color: transparent;
        }
        #tabs > span[data-active="true"] {
          background-color: var(--bg-white);
          border-bottom-color: var(--bg-white);
        }
        #tabs > span[data-active="true"]:not(:first-child) {
          border-left-color: var(--border);
        }
        #extra {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        slot {
          flex: 1;
          white-space: nowrap;
          display: block;
          scroll-snap-type: x mandatory;
          overflow-x: hidden;
          overflow-y: hidden;
          scroll-behavior: auto;
        }
        ::slotted(*) {
          display: inline-block;
          width: 100%;
          height: 100%;
          overflow: hidden;
          scroll-snap-align: center;
        }
      </style>
      <div id="tabs-container" tabindex=-1 title="Ctrl + Number or Command + Number (e.g.: Ctrl + 1 or Command + 1)">
        <div id="tabs"></div>
        <div id="extra"></div>
      </div>
      <slot id="contents"></slot>
    `;
    this.elements = {
      tabs: shadow.getElementById('tabs'),
      contents: shadow.getElementById('contents')
    };
  }
  keypress(e) {
    const meta = e.metaKey || e.ctrlKey;
    if (e.code.startsWith('Digit') && meta) {
      if (e.preventDefault) {
        e.preventDefault();
      }
      const input = this.elements.tabs.children[Number(e.key) - 1];
      if (input) {
        input.click();
      }
    }
  }
  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, {
      bubbles: true,
      detail
    }));
  }
  scroll(e) {
    e.scrollIntoView({
      block: 'nearest',
      inline: 'start'
    });
  }
  navigate(panel) {
    const {tabs} = this.elements;
    for (const i of [...tabs.children]) {
      i.dataset.active = panel.tab === i;
      if (panel.tab === i) {
        this.scroll(i);
        this.emit('tabs-view::change', panel);
      }
    }
    // focus the panel
    window.clearTimeout(this.timeout);
    this.timeout = window.setTimeout(() => panel.click(), this.config.timeout);
  }
  active() {
    const {tabs} = this.elements;
    return [...tabs.children].filter(t => t.dataset.active === 'true').shift().panel;
  }
  connectedCallback() {
    const {tabs, contents} = this.elements;
    // keypress
    this.addEventListener('keydown', this.keypress);
    // tabs on click

    tabs.addEventListener('click', e => {
      const panel = e.target.panel;
      if (panel) {
        this.scroll(panel);
      }
    });
    // resize
    const resize = new ResizeObserver(() => {
      for (const i of [...tabs.children]) {
        if (i.dataset.active === 'true') {
          i.click();
        }
      }
    });
    resize.observe(this);
    // observe
    const observe = entries => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRect.width) {
          this.navigate(e.target);
        }
      }
    };
    const observer = new IntersectionObserver(observe, {
      root: this,
      threshold: 0.9
    });
    // slot change
    contents.addEventListener('slotchange', () => {
      for (const panel of contents.assignedElements().filter(p => !p.tab)) {
        // scroll into view of dataset.active === true
        const span = document.createElement('span');
        if (panel.dataset.active) {
          this.scroll(panel);
          span.dataset.active = true;
        }
        span.textContent = panel.title || 'unknown';
        span.panel = panel;
        panel.tab = span;
        tabs.appendChild(span);
        observer.observe(panel);
      }
      this.ready = true;
    });
  }
}
window.customElements.define('tabs-view', TabsView);
