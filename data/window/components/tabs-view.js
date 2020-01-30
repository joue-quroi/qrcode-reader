class TabsView extends HTMLElement {
  constructor() {
    super();
    this.ready = false;
    const shadow = this.attachShadow({
      mode: 'closed'
    });
    shadow.innerHTML = `
      <style>
        :host {
          --bg-white: #fff;
          --bg-dark: #f6f6f6;
          --fg-dark: #000;
          --fg-white: #cacaca;

          display: flex;
          flex-direction: column;
        }
        #tabs-container {
          display: flex;
          background-color: var(--bg-dark);
          outline: none;
          z-index: 1;
        }
        #tabs {
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
        }
        #tabs > span {
          color: var(--fg-white);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 80px;
          cursor: pointer;
          padding: 8px 10px;
          -webkit-tap-highlight-color: transparent;
        }
        #tabs > span[data-active="true"] {
          color: var(--fg-dark);
        }
        @media screen and (max-width: 600px)  {
          #tabs {
            display: flex;
          }
          #tabs > span {
            flex: 1;
            padding: 15px 10px;
          }
        }
        #extra {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        slot {
          flex: 1;
          white-space: nowrap;
          display: flex;
          overflow-x: auto;
          overflow-y: hidden;
          scroll-behavior: smooth;
          scroll-snap-stop: always;
          scroll-snap-type: x mandatory;
        }
        :host([data-smooth=false]) slot {
          scroll-behavior: auto;
        }
        ::slotted(*) {
          display: inline-block;
          min-width: 100%;
          max-width: 10px;
          overflow: hidden;
          scroll-snap-align: start;
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
  active() {
    const {tabs} = this.elements;
    return [...tabs.children].filter(t => t.dataset.active === 'true').shift().panel;
  }
  navigate(e, type = 'tab', smooth = true) {
    this.dataset.smooth = smooth;
    if (type === 'tab') {
      const {tabs} = this.elements;
      if (e.offsetLeft + e.offsetWidth > tabs.scrollLeft + tabs.offsetWidth) {
        tabs.scrollLeft = e.offsetLeft + e.offsetWidth - tabs.offsetWidth;
      }
      else if (e.offsetLeft < tabs.scrollLeft) {
        tabs.scrollLeft = e.offsetLeft;
      }
    }
    else if (type === 'panel') {
      this.elements.contents.scrollLeft = e.offsetLeft;
    }
  }
  connectedCallback() {
    const {tabs, contents} = this.elements;
    // keypress
    this.addEventListener('keydown', this.keypress);
    // tabs on click

    tabs.addEventListener('click', e => {
      const panel = e.target.panel;
      if (panel && e.target.dataset.active !== 'true') {
        this.navigate(panel, 'panel');
      }
    });
    // resize
    const resize = new ResizeObserver(() => {
      const panel = [...tabs.children].filter(i => i.dataset.active === 'true').shift().panel;
      this.navigate(panel, 'panel', false);
    });
    resize.observe(this);
    // IntersectionObserver
    const intersect = entries => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRect.width) {
          const {tabs} = this.elements;
          const {tab} = e.target;
          for (const i of [...tabs.children]) {
            i.dataset.active = tab === i;
          }
          this.navigate(tab, 'tab');
          this.emit('tabs-view::change', e.target);
        }
      }
    };
    const observer = new IntersectionObserver(intersect, {
      root: this,
      threshold: 0.9
    });
    // slot change
    contents.addEventListener('slotchange', () => {
      for (const panel of contents.assignedElements().filter(p => !p.tab)) {
        // scroll into view of dataset.active === true
        const span = document.createElement('span');
        if (panel.dataset.active) {
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
