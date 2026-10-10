'use strict';
// Diagnostics: the debug HUD and the xp-status reply consumed by the popup.

function createDiagnostics({ state, version, el }) {
  function updateHud() {
    if (state.settings.debug) {
      if (!state.hud) {
        state.hud = el('div', '');
        state.hud.id = 'xp-inline-hud';
        document.documentElement.append(state.hud);
      }
      const text = 'X Pulse ' + version + ' · 响应 ' + state.stats.packets + ' / 解析 ' + state.stats.parsed + ' / 用户 ' + state.cache.size + ' / 徽标 ' + state.placed.size + (state.stats.lastError ? ' / 错误：' + state.stats.lastError : '');
      if (state.hud.textContent !== text) state.hud.textContent = text;
    } else if (state.hud) {
      state.hud.remove();
      state.hud = null;
    }
  }

  function statusReply() {
    const s = state.stats;
    return {
      version,
      bridgeVersion: s.bridgeVersion,
      packets: s.packets,
      parsed: s.parsed,
      accepted: s.accepted,
      users: state.cache.size,
      badges: state.placed.size,
      lastError: s.lastError,
      lastPacket: s.lastPacket
    };
  }

  return { updateHud, statusReply };
}

module.exports = createDiagnostics;
