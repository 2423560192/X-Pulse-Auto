'use strict';
// MutationObserver: schedules a re-render when the host page mutates outside our own nodes.

function createObserver({ state, owned, schedule }) {
  function observe() {
    if (state.observer && document.documentElement) {
      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href', 'data-testid']
      });
    }
  }

  function mount() {
    state.observer = new MutationObserver(changes => {
      if (changes.some(c => !owned(c.target))) schedule();
    });
    observe();
    schedule();
  }

  return { observe, mount };
}

module.exports = createObserver;
