/**
 * Påminnelser – backend i Google Apps Script.
 *
 * Sparar påminnelser som händelser i en egen Google-kalender ("Påminnelser").
 * Google Kalender sköter sedan notiserna på alla enheter (iPhone, Android,
 * dator, Chromebook) – ingen egen server och ingen API-nyckel behövs.
 *
 * Installation: se README.md i repot.
 *  1. Klistra in den här filen i ett nytt projekt på script.google.com.
 *  2. Kör funktionen `setup` en gång – den skapar kalendern och loggar din hemliga kod.
 *  3. Distribuera som webbapp: Kör som "Jag", Åtkomst "Alla".
 */

const CALENDAR_NAME = 'Påminnelser';
const EVENT_MINUTES = 15;

/** Kör en gång manuellt. Skapar kalender + hemlig kod och skriver ut dem i loggen. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) {
    props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  }
  const cal = getCalendar_();
  Logger.log('Kalender: ' + cal.getName() + ' (' + cal.getId() + ')');
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
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || req.token !== token) return json_({ ok: false, error: 'Fel hemlig kod' });

    switch (req.action) {
      case 'ping':   return json_({ ok: true });
      case 'list':   return json_({ ok: true, items: list_() });
      case 'add':    return json_({ ok: true, item: add_(req) });
      case 'done':   done_(req);   return json_({ ok: true });
      case 'delete': delete_(req); return json_({ ok: true });
      default:       return json_({ ok: false, error: 'Okänd åtgärd' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------------------

function getCalendar_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CALENDAR_ID');
  let cal = id && CalendarApp.getCalendarById(id);
  if (!cal) {
    cal = CalendarApp.getCalendarsByName(CALENDAR_NAME)[0] ||
          CalendarApp.createCalendar(CALENDAR_NAME, { color: CalendarApp.Color.RED });
    props.setProperty('CALENDAR_ID', cal.getId());
  }
  return cal;
}

function list_() {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600 * 1000);
  const to = new Date(now.getTime() + 366 * 24 * 3600 * 1000);
  return getCalendar_().getEvents(from, to).slice(0, 300).map(function (ev) {
    return {
      id: ev.getId(),
      title: ev.getTitle(),
      start: ev.getStartTime().toISOString(),
      recurring: ev.isRecurringEvent(),
      note: ev.getDescription() || ''
    };
  });
}

function add_(req) {
  const title = String(req.title || '').trim().slice(0, 500);
  const start = new Date(req.start);
  if (!title) throw new Error('Titel saknas');
  if (isNaN(start.getTime())) throw new Error('Ogiltig tid');
  const end = new Date(start.getTime() + EVENT_MINUTES * 60 * 1000);
  const minutesBefore = Math.max(0, Math.min(40320, Number(req.minutesBefore) || 0));
  const opts = { description: String(req.note || '').slice(0, 2000) };
  const cal = getCalendar_();

  let ev;
  const repeat = req.repeat || 'none';
  if (repeat !== 'none') {
    const rule = CalendarApp.newRecurrence();
    if (repeat === 'daily') rule.addDailyRule();
    else if (repeat === 'weekdays') rule.addWeeklyRule().onlyOnWeekdays([
      CalendarApp.Weekday.MONDAY, CalendarApp.Weekday.TUESDAY, CalendarApp.Weekday.WEDNESDAY,
      CalendarApp.Weekday.THURSDAY, CalendarApp.Weekday.FRIDAY]);
    else if (repeat === 'weekly') rule.addWeeklyRule();
    else if (repeat === 'monthly') rule.addMonthlyRule();
    else if (repeat === 'yearly') rule.addYearlyRule();
    const series = cal.createEventSeries(title, start, end, rule, opts);
    series.removeAllReminders();
    series.addPopupReminder(minutesBefore);
    ev = cal.getEvents(start, end).filter(function (x) { return x.getId() === series.getId(); })[0];
  } else {
    ev = cal.createEvent(title, start, end, opts);
    ev.removeAllReminders();
    ev.addPopupReminder(minutesBefore);
  }
  return { id: ev ? ev.getId() : '', title: title, start: start.toISOString(), recurring: repeat !== 'none' };
}

/** Markera klar: tar bort just den förekomsten (för upprepade: bara den gången). */
function done_(req) {
  const start = new Date(req.start);
  const cal = getCalendar_();
  if (!isNaN(start.getTime())) {
    const hits = cal.getEvents(new Date(start.getTime() - 60000), new Date(start.getTime() + 60000))
      .filter(function (x) { return x.getId() === req.id; });
    if (hits.length) { hits[0].deleteEvent(); return; }
  }
  const ev = cal.getEventById(req.id);
  if (ev) ev.deleteEvent();
}

/** Ta bort helt (för upprepade: hela serien). */
function delete_(req) {
  const cal = getCalendar_();
  const series = cal.getEventSeriesById(req.id);
  if (series) { series.deleteEventSeries(); return; }
  const ev = cal.getEventById(req.id);
  if (ev) ev.deleteEvent();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
