// A body-weight field that accepts kilos or pounds and always hands back
// pounds. Shared by the Body screen and the workout's "body weight today" so
// the two cannot drift apart.

import { h } from '../dom.js';
import { state, saveSettings } from '../store.js';
import { parseBodyWeight, formatWeight, lbToKg } from '../calc.js';

const round1 = (n) => Math.round(n * 10) / 10;

// `value` is a stored weight in pounds, or null. Returns { node, input, read };
// read() gives back { ok, lb, unit } for whatever is currently typed.
export function bodyWeightField({ value = null, placeholder = 'Body weight' } = {}) {
  let unit = state.settings.bodyWeightEntryUnit === 'kg' ? 'kg' : 'lb';

  const shown = (lb) => String(round1(unit === 'kg' ? lbToKg(lb) : lb));

  // Text rather than number, so a suffix like "80kg" can be typed where the
  // keyboard has letters. inputmode keeps the numeric keypad on a phone, where
  // the toggle is the way in.
  const input = h('input', {
    class: 'input', type: 'text', inputmode: 'decimal',
    placeholder, value: value == null || value === '' ? '' : shown(Number(value)),
    oninput: () => refresh(),
  });

  const hint = h('p', { class: 'muted small' });

  const chip = (u, label) => h('button', {
    class: 'chip', type: 'button', 'aria-label': u === 'kg' ? 'Kilograms' : 'Pounds',
    onclick: () => {
      // Switching units converts whatever is already in the box rather than
      // silently reinterpreting the number as the other unit.
      const before = parseBodyWeight(input.value, unit);
      unit = u;
      if (before.ok) input.value = shown(before.lb);
      sync();
      refresh();
      input.focus();
    },
  }, label);

  const lbChip = chip('lb', 'LB');
  const kgChip = chip('kg', 'KG');
  const toggle = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Weight unit' }, lbChip, kgChip);

  function sync() {
    lbChip.classList.toggle('on', unit === 'lb');
    kgChip.classList.toggle('on', unit === 'kg');
  }

  function refresh() {
    const typed = input.value.trim();
    if (!typed) { hint.textContent = unit === 'kg' ? 'Type kilos — saved as pounds.' : ''; return; }
    const parsed = parseBodyWeight(typed, unit);
    if (!parsed.ok) { hint.textContent = 'Enter a number.'; return; }
    // Only worth saying when it is actually a conversion.
    hint.textContent = parsed.unit === 'kg' ? `= ${formatWeight(parsed.lb)} lb` : '';
  }

  sync();
  refresh();

  const read = () => {
    const parsed = parseBodyWeight(input.value, unit);
    // Remember how you type, but only once something valid has been entered.
    if (parsed.ok && parsed.unit !== state.settings.bodyWeightEntryUnit) {
      saveSettings({ bodyWeightEntryUnit: parsed.unit }).catch(() => {});
    }
    return parsed;
  };

  return { node: h('div', { class: 'stack-sm' }, toggle, input, hint), input, read };
}
