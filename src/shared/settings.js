'use strict';
// User settings schema: defaults plus validation of untrusted stored values.

const defaults = {
  enabled: true,
  layout: 'auto',
  format: 'compact',
  tierColors: true,
  hoverCard: true,
  showRelation: true,
  debug: false
};

function settings(input = {}) {
  const out = { ...defaults };
  for (const key of ['enabled', 'tierColors', 'hoverCard', 'showRelation', 'debug']) {
    if (typeof input?.[key] === 'boolean') out[key] = input[key];
  }
  if (['auto', 'inline', 'below'].includes(input?.layout)) out.layout = input.layout;
  if (['compact', 'exact'].includes(input?.format)) out.format = input.format;
  return out;
}

module.exports = { defaults, settings };
