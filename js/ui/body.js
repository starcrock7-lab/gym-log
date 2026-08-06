import { h, icon, screen, empty, sheet, closeSheet, confirmSheet, toast, relativeDay } from '../dom.js';
import { state, logBodyWeight, removeBodyWeight } from '../store.js';
import { formatWeight } from '../calc.js';
import { lineChart } from '../charts.js';
import { isoDay } from '../schema.js';

const RANGES = [['30d', 30], ['90d', 90], ['1y', 365], ['All', Infinity]];

export function bodyScreen() {
  const rows = [...state.bodyWeights].sort((a, b) => b.date.localeCompare(a.date));
  const chartBox = h('div', {});
  let rangeDays = 90;

  const draw = () => {
    const cutoff = rangeDays === Infinity ? 0 : Date.now() - rangeDays * 86400000;
    const points = rows
      .map((row) => ({ x: Date.parse(`${row.date}T12:00:00`), y: row.weightLb }))
      .filter((p) => p.x >= cutoff);
    chartBox.replaceChildren(lineChart(points, { format: (v) => v.toFixed(0) }));
  };

  const tabs = h('div', { class: 'range-tabs' },
    RANGES.map(([label, days]) =>
      h('button', {
        class: days === rangeDays ? 'on' : '',
        onclick: (e) => {
          rangeDays = days;
          for (const b of tabs.children) b.classList.remove('on');
          e.currentTarget.classList.add('on');
          draw();
        },
      }, label)),
  );
  draw();

  const latest = rows[0];
  const monthAgo = rows.find((r) => Date.parse(`${r.date}T12:00:00`) <= Date.now() - 30 * 86400000);
  const change = latest && monthAgo ? latest.weightLb - monthAgo.weightLb : null;

  return screen('Body weight', {
    subtitle: latest ? `Last logged ${relativeDay(`${latest.date}T12:00:00`).toLowerCase()}` : 'Nothing logged yet',
    action: h('button', { class: 'icon-btn', 'aria-label': 'Log weight', onclick: () => logSheet() }, icon('plus')),
  },
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Current'), h('div', { class: 'v' }, latest ? `${formatWeight(latest.weightLb)} lb` : '—')),
      h('div', { class: 'stat' },
        h('div', { class: 'k' }, '30-day change'),
        h('div', { class: 'v', style: change ? { color: change > 0 ? 'var(--warn)' : 'var(--good)' } : {} },
          change == null ? '—' : `${change > 0 ? '+' : ''}${formatWeight(change)} lb`)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Entries'), h('div', { class: 'v' }, String(rows.length))),
    ),

    rows.length ? h('div', { class: 'card stack-sm' }, tabs, chartBox) : null,

    h('button', { class: 'btn btn-primary btn-block', onclick: () => logSheet() }, icon('plus'), "Log today's weight"),

    rows.length
      ? h('div', { class: 'stack-sm' },
          h('p', { class: 'section-title' }, 'Entries'),
          h('div', { class: 'card' },
            h('div', { class: 'list' },
              rows.map((row) =>
                h('button', {
                  class: 'list-item',
                  onclick: () => logSheet(row),
                },
                  h('span', { class: 'grow' }, new Date(`${row.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })),
                  h('span', { class: 'mono' }, `${formatWeight(row.weightLb)} lb`),
                )),
            )),
        )
      : empty('No weigh-ins yet', 'Logging even once a week makes the chart useful.'),
  );
}

function logSheet(existing = null) {
  const weight = h('input', {
    class: 'input', type: 'number', inputmode: 'decimal', step: '0.1',
    placeholder: 'lb', value: existing?.weightLb ?? '',
  });
  const date = h('input', { class: 'input', type: 'date', value: existing?.date || isoDay() });

  sheet(existing ? 'Edit weigh-in' : 'Log body weight', h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', {}, 'Weight (lb)'), weight),
    h('div', { class: 'field' }, h('label', {}, 'Date'), date),
    existing
      ? h('button', {
          class: 'btn btn-danger btn-block',
          onclick: async () => {
            closeSheet();
            if (!await confirmSheet('Delete this weigh-in?', `${formatWeight(existing.weightLb)} lb on ${existing.date}.`, { confirmLabel: 'Delete', danger: true })) return;
            await removeBodyWeight(existing.date);
            toast('Deleted');
          },
        }, 'Delete')
      : null,
  ), {
    actions: [
      h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const value = Number(weight.value);
          if (!value || value <= 0) { weight.focus(); toast('Enter a weight', { error: true }); return; }
          await logBodyWeight(value, date.value || isoDay());
          closeSheet();
          toast('Logged');
        },
      }, 'Save'),
    ],
  });
  setTimeout(() => weight.focus(), 120);
}
