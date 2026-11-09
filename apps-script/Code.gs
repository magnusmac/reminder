/**
 * Påminnelser – backend i Google Apps Script.
 *
 * Varje påminnelse blir en UPPGIFT i Google Tasks (listan "Påminnelser"), som syns
 * i Google Kalender och Tasks-appen och kan bockas av där.
 * Påminnelser MED klockslag får dessutom en kalenderhändelse som plingar på exakt tid
 * (Google Tasks API kan inte spara klockslag, bara datum).
 *
 * Installation: se README.md i repot.
 *  1. Klistra in den här filen i ett projekt på script.google.com.
 *  2. Tjänster (+) → lägg till "Google Tasks API" (identifierare: Tasks).
 *  3. Kör funktionen `setup` en gång – den skapar kalender + uppgiftslista och loggar din hemliga kod.
 *  4. Implementera som webbapp: Kör som "Jag", Åtkomst "Alla".
 */

// ▼▼▼ INSTÄLLNING ▼▼▼
// Namnet på Tasks-listan som påminnelserna ska hamna i. Skriv exakt som listan heter
// (kör `setup` så skrivs alla dina listor ut i loggen). Finns listan inte skapas den.
// Skriv '@default' för din standardlista ("Mina uppgifter").
const TASKLIST_NAME = 'Påminnelser';
// ▲▲▲ INSTÄLLNING ▲▲▲

const NAME = 'Påminnelser'; // namnet på kalendern för påminnelser med klockslag
const EVENT_MINUTES = 15;
const TIME_PREFIX = /^⏰ \d{1,2}:\d{2} · /;

/** Kör en gång manuellt. Skapar kalender, uppgiftslista och hemlig kod. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) {
    props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  }
  const cal = getCalendar_();
  const all = (Tasks.Tasklists.list({ maxResults: 100 }).items || []).map(function (l) { return '"' + l.title + '"'; });
  Logger.log('Dina Tasks-listor: ' + all.join(', '));
  const list = getTaskList_();
  const title = Tasks.Tasklists.get(list).title;
  Logger.log('Kalender: ' + cal.getName() + ' | Påminnelserna hamnar i Tasks-listan: "' + title + '"');
  Logger.log('Din hemliga kod (klistra in i appen): ' + props.getProperty('TOKEN'));
}

/** Byt hemlig kod om den läckt. Alla enheter måste då ställas in på nytt. */
function rotateToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  setup();
}

function doGet() {
  return json_({ ok: true, app: 'paminnelser', hint: 'Använd POST från appen.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || req.token !== token) return json_({ ok: false, error: 'Fel hemlig kod' });
    lock.waitLock(20000);

    switch (req.action) {
      case 'ping':   getTaskList_(); return json_({ ok: true });
      case 'list':   return json_({ ok: true, items: list_() });
      case 'add':    return json_({ ok: true, item: add_(req) });
      case 'done':   done_(req);   return json_({ ok: true });
      case 'delete': delete_(req); return json_({ ok: true });
      default:       return json_({ ok: false, error: 'Okänd åtgärd' });
    }
  } catch (err) {
    let msg = String(err && err.message || err);
    if (/Tasks is not defined/.test(msg)) msg = 'Google Tasks API är inte tillagt under Tjänster i Apps Script';
    return json_({ ok: false, error: msg });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// --- Kalender och uppgiftslista ----------------------------------------------

function getCalendar_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CALENDAR_ID');
  let cal = id && CalendarApp.getCalendarById(id);
  if (!cal) {
    cal = CalendarApp.getCalendarsByName(NAME)[0] ||
          CalendarApp.createCalendar(NAME, { color: CalendarApp.Color.RED });
    props.setProperty('CALENDAR_ID', cal.getId());
  }
  return cal;
}

let taskListId_ = null;
function getTaskList_() {
  if (taskListId_) return taskListId_;
  const props = PropertiesService.getScriptProperties();
  const want = String(TASKLIST_NAME || '@default').trim();
  const saved = JSON.parse(props.getProperty('TASKLIST') || '{}');
  if (saved.id && saved.name === want) {
    try { Tasks.Tasklists.get(saved.id); return (taskListId_ = saved.id); } catch (e) {}
  }
  let id;
  if (want === '@default') id = Tasks.Tasklists.get('@default').id;
  else {
    const lists = (Tasks.Tasklists.list({ maxResults: 100 }).items || []);
    const found = lists.filter(function (l) { return l.title.trim().toLowerCase() === want.toLowerCase(); })[0];
    id = found ? found.id : Tasks.Tasklists.insert({ title: want }).id;
  }
  props.setProperty('TASKLIST', JSON.stringify({ name: want, id: id }));
  return (taskListId_ = id);
}

// Metadata per uppgift: { e: kalenderhändelse-id, s: start (ISO) eller null, r: upprepning }
let metaCache_ = null;
function getMeta_(taskId) {
  if (!metaCache_) metaCache_ = PropertiesService.getScriptProperties().getProperties();
  const v = metaCache_['M_' + taskId];
  return v ? JSON.parse(v) : null;
}
function setMeta_(taskId, meta) {
  if (metaCache_) metaCache_['M_' + taskId] = JSON.stringify(meta);
  PropertiesService.getScriptProperties().setProperty('M_' + taskId, JSON.stringify(meta));
}
function delMeta_(taskId) {
  if (metaCache_) delete metaCache_['M_' + taskId];
  PropertiesService.getScriptProperties().deleteProperty('M_' + taskId);
}

// --- Åtgärder ----------------------------------------------------------------

function list_() {
  getMeta_('');
  const listId = getTaskList_();
  const tz = getCalendar_().getTimeZone();
  const items = [];
  const created = [];
  let pageToken;
  do {
    const res = Tasks.Tasks.list(listId, { showCompleted: true, showHidden: true, maxResults: 100, pageToken: pageToken });
    (res.items || []).forEach(function (t) {
      if (!t.title && !t.due) return;
      const meta = getMeta_(t.id);
      if (t.status === 'completed') {
        // Avbockad i Tasks/Kalender: städa bort händelsen och skapa nästa upprepning
        if (meta) { const n = finish_(t, meta, listId, tz); if (n) created.push(n); }
        return;
      }
      items.push(taskItem_(t, meta));
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  created.forEach(function (t) { items.push(taskItem_(t, getMeta_(t.id))); });

  // Händelser som hör till en uppgift
  const linkedEvents = {};
  Object.keys(metaCache_ || {}).forEach(function (k) {
    if (k.indexOf('M_') !== 0) return;
    try { const m = JSON.parse(metaCache_[k]); if (m.e) linkedEvents[m.e] = true; } catch (e) {}
  });

  // Äldre kalenderhändelser utan kopplad uppgift (skapade innan uppgifter infördes)
  const now = new Date();
  getCalendar_().getEvents(new Date(now.getTime() - 86400000), new Date(now.getTime() + 366 * 86400000))
    .slice(0, 300).forEach(function (ev) {
      if (linkedEvents[ev.getId()]) return;
      items.push({ id: ev.getId(), kind: 'event', title: ev.getTitle(), start: ev.getStartTime().toISOString(),
                   allDay: false, recurring: ev.isRecurringEvent(), note: ev.getDescription() || '' });
    });
  return items;
}

function add_(req) {
  const title = String(req.title || '').trim().slice(0, 500);
  if (!title) throw new Error('Titel saknas');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date || '')) throw new Error('Ogiltigt datum');
  const repeat = req.repeat || 'none';
  const allDay = !!req.allDay;
  const listId = getTaskList_();
  const cal = getCalendar_();
  const tz = cal.getTimeZone();

  let eventId = null, start = null;
  if (!allDay) {
    start = new Date(req.start);
    if (isNaN(start.getTime())) throw new Error('Ogiltig tid');
    eventId = createEvent_(cal, title, start, repeat, Number(req.minutesBefore) || 0, req.note);
  }
  const task = insertTask_(listId, title, req.date, start, tz, req.note, repeat);
  setMeta_(task.id, { e: eventId, s: start ? start.toISOString() : null, r: repeat });
  return { id: task.id, kind: 'task', title: title, start: allDay ? req.date : start.toISOString(), allDay: allDay, recurring: repeat !== 'none' };
}

function done_(req) {
  if (req.kind === 'event') { deleteEventInstance_(req.id, req.start); return; }
  const listId = getTaskList_();
  const t = Tasks.Tasks.patch({ status: 'completed' }, listId, req.id);
  const meta = getMeta_(req.id);
  if (meta) finish_(t, meta, listId, getCalendar_().getTimeZone());
}

function delete_(req) {
  const cal = getCalendar_();
  if (req.kind === 'event') { deleteEventOrSeries_(cal, req.id); return; }
  const meta = getMeta_(req.id);
  if (meta && meta.e) deleteEventOrSeries_(cal, meta.e);
  try { Tasks.Tasks.remove(getTaskList_(), req.id); } catch (e) {}
  delMeta_(req.id);
}

// --- Hjälpfunktioner ---------------------------------------------------------

function taskItem_(t, meta) {
  const allDay = !(meta && meta.s);
  return {
    id: t.id,
    kind: 'task',
    title: String(t.title || '').replace(TIME_PREFIX, ''),
    start: allDay ? (t.due ? t.due.slice(0, 10) : null) : meta.s,
    allDay: allDay,
    recurring: !!(meta && meta.r && meta.r !== 'none'),
    note: t.notes || ''
  };
}

/** Uppgiften är klar: ta bort händelsen (eller just den förekomsten) och skapa nästa uppgift om den upprepas. */
function finish_(task, meta, listId, tz) {
  const recurring = meta.r && meta.r !== 'none';
  if (meta.e) {
    if (recurring && meta.s) deleteEventInstance_(meta.e, meta.s);
    else if (!recurring) deleteEventOrSeries_(getCalendar_(), meta.e);
  }
  delMeta_(task.id);
  if (!recurring) return null;

  const base = meta.s ? new Date(meta.s) : parseDate_(task.due ? task.due.slice(0, 10) : null, tz);
  if (!base) return null;
  const next = nextOccurrence_(base, meta.r);
  const date = Utilities.formatDate(next, tz, 'yyyy-MM-dd');
  const title = String(task.title || '').replace(TIME_PREFIX, '');
  const t = insertTask_(listId, title, date, meta.s ? next : null, tz, task.notes, meta.r);
  setMeta_(t.id, { e: meta.e, s: meta.s ? next.toISOString() : null, r: meta.r });
  return t;
}

function insertTask_(listId, title, date, start, tz, note, repeat) {
  const prefix = start ? '⏰ ' + Utilities.formatDate(start, tz, 'HH:mm') + ' · ' : '';
  const rep = { daily: 'varje dag', weekdays: 'vardagar', weekly: 'varje vecka', monthly: 'varje månad', yearly: 'varje år' }[repeat];
  note = String(note || '').replace(/\n?Upprepas .* \(via Påminnelser-appen\)$/, '');
  const notes = [note.slice(0, 2000), rep ? 'Upprepas ' + rep + ' (via Påminnelser-appen)' : '']
    .filter(String).join('\n');
  return Tasks.Tasks.insert({ title: prefix + title, notes: notes, due: date + 'T00:00:00.000Z' }, listId);
}

function createEvent_(cal, title, start, repeat, minutesBefore, note) {
  const end = new Date(start.getTime() + EVENT_MINUTES * 60000);
  const opts = { description: String(note || '').slice(0, 2000) };
  minutesBefore = Math.max(0, Math.min(40320, minutesBefore));
  if (repeat === 'none') {
    const ev = cal.createEvent(title, start, end, opts);
    ev.removeAllReminders(); ev.addPopupReminder(minutesBefore);
    return ev.getId();
  }
  const rule = CalendarApp.newRecurrence();
  if (repeat === 'daily') rule.addDailyRule();
  else if (repeat === 'weekdays') rule.addWeeklyRule().onlyOnWeekdays([
    CalendarApp.Weekday.MONDAY, CalendarApp.Weekday.TUESDAY, CalendarApp.Weekday.WEDNESDAY,
    CalendarApp.Weekday.THURSDAY, CalendarApp.Weekday.FRIDAY]);
  else if (repeat === 'weekly') rule.addWeeklyRule();
  else if (repeat === 'monthly') rule.addMonthlyRule();
  else if (repeat === 'yearly') rule.addYearlyRule();
  const series = cal.createEventSeries(title, start, end, rule, opts);
  series.removeAllReminders(); series.addPopupReminder(minutesBefore);
  return series.getId();
}

function deleteEventInstance_(eventId, startIso) {
  const cal = getCalendar_();
  const start = new Date(startIso);
  if (!isNaN(start.getTime())) {
    const hits = cal.getEvents(new Date(start.getTime() - 60000), new Date(start.getTime() + 60000))
      .filter(function (x) { return x.getId() === eventId; });
    if (hits.length) { hits[0].deleteEvent(); return; }
  }
  const ev = cal.getEventById(eventId);
  if (ev && !ev.isRecurringEvent()) ev.deleteEvent();
}

function deleteEventOrSeries_(cal, eventId) {
  try {
    const series = cal.getEventSeriesById(eventId);
    if (series) { series.deleteEventSeries(); return; }
  } catch (e) {}
  const ev = cal.getEventById(eventId);
  if (ev) ev.deleteEvent();
}

function nextOccurrence_(d, rep) {
  const n = new Date(d);
  const now = new Date();
  do {
    if (rep === 'daily') n.setDate(n.getDate() + 1);
    else if (rep === 'weekdays') { do { n.setDate(n.getDate() + 1); } while (n.getDay() === 0 || n.getDay() === 6); }
    else if (rep === 'weekly') n.setDate(n.getDate() + 7);
    else if (rep === 'monthly') n.setMonth(n.getMonth() + 1);
    else if (rep === 'yearly') n.setFullYear(n.getFullYear() + 1);
    else return n;
  } while (n < now && (n.getTime() + 86400000) < now.getTime());
  return n;
}

function parseDate_(ymd, tz) {
  if (!ymd) return null;
  return Utilities.parseDate(ymd + ' 12:00', tz, 'yyyy-MM-dd HH:mm');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
