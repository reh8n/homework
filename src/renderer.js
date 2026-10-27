const COLORS = ['#8FA9C9', '#A9C2A4', '#D3B58C', '#C9A0B4', '#A79CC9', '#9FC4C4', '#C9A09A'];
const DAY = 86400000;
const SETTLE = 550; // let the tick and strike finish drawing before the row leaves its view

let data = { tasks: [], subjects: [], settings: {} };
let view = 'today';
let group = 'date';
let editing = null;
let lastView = null;
const leaving = new Map(); // task id -> timer for a row about to move between the list and Done

const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
const ENTER = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];

const $ = id => document.getElementById(id);
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => localDate(new Date());
const dayDiff = iso => Math.round((new Date(iso + 'T00:00') - new Date(today() + 'T00:00')) / DAY);
const subjectColor = name => (data.subjects.find(s => s.name === name) || {}).color || 'transparent';
const save = () => window.store.save(data);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style') n.style.cssText = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter(k => k != null));
  return n;
}

function tick() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M2.5 6.2 5 8.6 9.6 3.6');
  path.setAttribute('pathLength', '1');
  svg.append(path);
  return svg;
}

// Slide a highlight (.thumb) under the chosen item; jumps without animating the first time
function placeThumb(thumb, target) {
  if (!thumb || !target || !target.offsetWidth) return;
  const instant = !thumb.dataset.ready || !motion();
  if (instant) thumb.style.transition = 'none';
  thumb.style.width = target.offsetWidth + 'px';
  thumb.style.height = target.offsetHeight + 'px';
  thumb.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
  if (instant) { thumb.offsetWidth; thumb.style.transition = ''; thumb.dataset.ready = 1; }
}

function syncThumbs() {
  placeThumb(document.querySelector('.nav-thumb'), document.querySelector('.nav.active'));
  document.querySelectorAll('.pill-toggle').forEach(p => placeThumb(p.querySelector('.thumb'), p.querySelector('button.on')));
}

function dueLabel(iso) {
  const d = dayDiff(iso);
  if (d < 0) return `${-d}d late`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 7) return new Date(iso + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(iso + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function isArchived(t) {
  return t.done;
}

function visibleTasks() {
  const active = data.tasks.filter(t => !isArchived(t));
  if (view === 'today') return active.filter(t => dayDiff(t.due) <= 0);
  if (view === 'upcoming') return active.filter(t => dayDiff(t.due) > 0);
  if (view === 'done') return data.tasks.filter(isArchived);
  return [];
}

function groupTasks(tasks) {
  const groups = new Map();
  const add = (key, t) => (groups.get(key) || groups.set(key, []).get(key)).push(t);
  tasks.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  if (view === 'done') tasks.reverse();

  for (const t of tasks) {
    if (group === 'subject') { add(t.subject || 'No subject', t); continue; }
    if (view === 'done') { add('Completed', t); continue; }
    const d = dayDiff(t.due);
    add(d < 0 ? 'Overdue' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d < 7 ? 'This week' : 'Later', t);
  }
  const order = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later'];
  return [...groups].sort(([a], [b]) => group === 'date' ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b));
}

function taskRow(t) {
  const row = el('div', { class: 'task' + (t.done ? ' done' : ''), 'data-id': t.id, ondblclick: () => openEdit(t) },
    el('button', { class: 'check', title: 'Done', onclick: () => toggle(t, row) }, tick()),
    el('span', { class: 'name' }, el('span', { class: 'strike' }, t.title)),
    el('span', { class: 'meta' },
      t.notes ? el('span', { class: 'note-mark', title: t.notes }, '✎') : null,
      el('span', { class: 'chip' }, t.type),
      t.subject ? el('span', { class: 'dot', style: `background:${subjectColor(t.subject)}`, title: t.subject }) : null,
      el('span', {}, dueLabel(t.due))
    )
  );
  return row;
}

// mode: 'enter' staggers rows in, 'flip' glides kept rows to their new spot and folds removed ones away
function renderList(mode) {
  const list = $('list');
  const before = new Map();
  const oldHeads = new Set([...list.querySelectorAll('h2')].map(h => h.textContent));
  for (const row of list.querySelectorAll('.task[data-id]')) before.set(row.dataset.id, { row, rect: row.getBoundingClientRect() });
  list.replaceChildren();
  build(list);
  if (!motion() || mode === 'none') return;

  const rows = [...list.querySelectorAll('.task[data-id]')];
  if (mode === 'enter') {
    rows.forEach((r, i) => r.animate(ENTER, { duration: 300, easing: EASE, delay: Math.min(i, 12) * 22, fill: 'backwards' }));
    return;
  }
  for (const r of rows) {
    const old = before.get(r.dataset.id);
    before.delete(r.dataset.id);
    if (!old) { r.animate(ENTER, { duration: 280, easing: EASE }); continue; }
    const now = r.getBoundingClientRect();
    const dx = old.rect.left - now.left, dy = old.rect.top - now.top;
    if (dx || dy) r.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: EASE });
  }
  for (const h of list.querySelectorAll('h2')) if (!oldHeads.has(h.textContent)) h.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: EASE });
  const box = list.getBoundingClientRect();
  for (const { row, rect } of before.values()) {
    row.removeAttribute('data-id');
    row.style.cssText = `position:absolute;left:${rect.left - box.left}px;top:${rect.top - box.top}px;width:${rect.width}px;pointer-events:none`;
    list.append(row);
    row.animate([{ opacity: row.classList.contains('done') ? .6 : 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }],
      { duration: 220, easing: EASE, fill: 'forwards' }).onfinish = () => row.remove();
  }
}

function build(list) {
  const groups = groupTasks(visibleTasks());
  if (!groups.length) {
    const msg = { today: 'Nothing due today.', upcoming: 'Nothing coming up.', done: 'No finished tasks yet.' }[view];
    list.append(el('p', { class: 'empty' }, msg));
    return;
  }
  for (const [name, tasks] of groups) {
    list.append(el('div', { class: 'group' },
      el('h2', { class: name === 'Overdue' ? 'late' : '' }, name),
      ...tasks.map(taskRow)
    ));
  }
}

function renderSubjects() {
  const box = $('subjectsView');
  box.replaceChildren();
  for (const s of data.subjects) {
    const count = data.tasks.filter(t => t.subject === s.name && !t.done).length;
    box.append(el('div', { class: 'subject-row' },
      el('span', { class: 'dot', style: `background:${s.color}` }),
      el('input', { class: 'name rename', value: s.name, title: 'Click to rename', onchange: e => renameSubject(s, e.target) }),
      el('span', { class: 'meta' }, `${count} open`),
      el('div', { class: 'swatches' }, ...COLORS.map(c =>
        el('button', { class: c === s.color ? 'sel' : '', style: `background:${c}`, onclick: () => { s.color = c; save(); render(); } })
      )),
      el('button', { class: 'soft', onclick: () => removeSubject(s) }, 'Remove')
    ));
  }
  const input = el('input', { class: 'field grow', placeholder: 'New subject, e.g. Maths' });
  const form = el('form', { class: 'add-subject', onsubmit: e => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name || data.subjects.some(s => s.name.toLowerCase() === name.toLowerCase())) return;
    data.subjects.push({ name, color: COLORS[data.subjects.length % COLORS.length] });
    save(); render();
  } }, input, el('button', { class: 'round', type: 'submit', title: 'Add subject' }, '+'));
  box.append(form);
  if (!data.subjects.length) input.focus();
}

function renameSubject(s, input) {
  const name = input.value.trim();
  if (!name || data.subjects.some(x => x !== s && x.name.toLowerCase() === name.toLowerCase())) { input.value = s.name; return; }
  data.tasks.forEach(t => { if (t.subject === s.name) t.subject = name; });
  s.name = name;
  save(); render();
}

function applyTheme() {
  const mode = data.settings.theme || 'system';
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  window.store.setTheme(mode);
  document.querySelectorAll('#themeToggle button').forEach(b => b.classList.toggle('on', b.dataset.theme === mode));
  syncThumbs();
}

function removeSubject(s) {
  if (!confirm(`Remove "${s.name}"? Its tasks will keep their titles but lose the subject.`)) return;
  data.subjects = data.subjects.filter(x => x !== s);
  data.tasks.forEach(t => { if (t.subject === s.name) t.subject = ''; });
  save(); render();
}

function fillSubjectSelect(select, value = '') {
  select.replaceChildren(el('option', { value: '' }, 'No subject'),
    ...data.subjects.map(s => el('option', { value: s.name }, s.name)));
  select.value = value;
}

function render() {
  const subjects = view === 'subjects';
  const settings = view === 'settings';
  const page = subjects || settings;
  $('title').textContent = { today: 'Today', upcoming: 'Upcoming', done: 'Done', subjects: 'Subjects', settings: 'Settings' }[view];
  $('eyebrow').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('list').hidden = page;
  $('subjectsView').hidden = !subjects;
  $('settingsView').hidden = !settings;
  $('groupToggle').classList.toggle('gone', page);
  $('addForm').classList.toggle('gone', page || view === 'done');
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('#groupToggle button').forEach(b => b.classList.toggle('on', b.dataset.group === group));

  const keep = $('fSubject').value;
  fillSubjectSelect($('fSubject'), keep);
  const first = lastView === null, moved = !first && view !== lastView;
  lastView = view;
  if (subjects) renderSubjects();
  else if (!settings) renderList(first ? 'enter' : moved ? 'none' : 'flip');
  syncThumbs();
  // Changing views: the new page eases in
  if (moved && motion()) {
    const pane = subjects ? $('subjectsView') : settings ? $('settingsView') : $('list');
    for (const n of [pane, $('title')]) n.animate(ENTER, { duration: 280, easing: EASE });
  }
}

function toggle(t, row) {
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  save();
  // Flip the class so CSS animates the tick, then fold the row out once it has drawn.
  // Ticking again before then cancels the move and the row just stays.
  row.classList.toggle('done', t.done);
  if (leaving.has(t.id)) { clearTimeout(leaving.get(t.id)); leaving.delete(t.id); return; }
  leaving.set(t.id, setTimeout(() => { leaving.delete(t.id); render(); }, motion() ? SETTLE : 0));
}

function openEdit(t) {
  editing = t;
  $('eTitle').value = t.title;
  fillSubjectSelect($('eSubject'), t.subject);
  $('eType').value = t.type;
  $('eDue').value = t.due;
  $('eNotes').value = t.notes || '';
  // Esc closes without setting returnValue, so clear it or the last Save/Delete would repeat
  $('editDialog').returnValue = '';
  $('editDialog').showModal();
}

function closeEdit(value) {
  const dlg = $('editDialog');
  if (!motion()) return dlg.close(value);
  dlg.classList.add('closing');
  dlg.addEventListener('animationend', function done(e) {
    if (e.target !== dlg) return;
    dlg.removeEventListener('animationend', done);
    dlg.classList.remove('closing');
    dlg.close(value);
  });
}
$('editForm').addEventListener('submit', e => { e.preventDefault(); closeEdit(e.submitter ? e.submitter.value : ''); });
$('editDialog').addEventListener('cancel', e => { e.preventDefault(); closeEdit('cancel'); });

$('editDialog').addEventListener('close', () => {
  const action = $('editDialog').returnValue;
  if (action === 'save') {
    Object.assign(editing, {
      title: $('eTitle').value.trim() || editing.title,
      subject: $('eSubject').value,
      type: $('eType').value,
      due: $('eDue').value || editing.due,
      notes: $('eNotes').value.trim()
    });
  } else if (action === 'delete') {
    data.tasks = data.tasks.filter(t => t !== editing);
  }
  if (action === 'save' || action === 'delete') { save(); render(); }
  editing = null;
});

$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  data.tasks.push({
    id: crypto.randomUUID(),
    title: $('fTitle').value.trim(),
    subject: $('fSubject').value,
    type: $('fType').value,
    due: $('fDue').value,
    notes: '',
    done: false,
    doneAt: null
  });
  $('fTitle').value = '';
  save(); render();
  $('fTitle').focus();
});

document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; render(); }));
document.querySelectorAll('#groupToggle button').forEach(b => b.addEventListener('click', () => {
  group = b.dataset.group;
  data.settings.group = group;
  save(); render();
}));

document.querySelectorAll('#themeToggle button').forEach(b => b.addEventListener('click', () => {
  data.settings.theme = b.dataset.theme;
  save();
  if (document.startViewTransition && motion()) document.startViewTransition(applyTheme);
  else applyTheme();
}));
function applyLogin() {
  const on = data.settings.openAtLogin !== false;
  document.querySelectorAll('#loginToggle button').forEach(b => b.classList.toggle('on', (b.dataset.login === 'on') === on));
  syncThumbs();
}
document.querySelectorAll('#loginToggle button').forEach(b => b.addEventListener('click', () => {
  data.settings.openAtLogin = b.dataset.login === 'on';
  window.store.setOpenAtLogin(data.settings.openAtLogin);
  save(); applyLogin();
}));
window.store.onFocusAdd(() => {
  if (view === 'subjects' || view === 'settings' || view === 'done') { view = 'today'; render(); }
  $('fTitle').focus();
});
$('goSubjects').addEventListener('click', () => { view = 'subjects'; render(); });

(async () => {
  data = Object.assign(data, await window.store.load());
  group = data.settings.group || 'date';
  applyTheme();
  applyLogin();
  $('fDue').value = today();
  render();
  setInterval(() => { if (view !== 'subjects' && view !== 'settings' && !editing) render(); }, 60 * 1000); // roll groups over at midnight
})();
