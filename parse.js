/*
 * Tolkar svenska påminnelser i fri text, t.ex.
 *   "påminn mig imorgon kl 9 att ringa tandläkaren"
 *   "om 20 minuter ta ut tvätten"
 *   "varje måndag kl 8.15 veckomöte"
 *   "15 december handla julklappar"
 * Returnerar { title, date (Date|null), repeat }.
 */
(function (root) {
  'use strict';

  var WEEKDAYS = { 'söndag': 0, 'måndag': 1, 'tisdag': 2, 'onsdag': 3, 'torsdag': 4, 'fredag': 5, 'lördag': 6 };
  var MONTHS = {
    'januari': 0, 'jan': 0, 'februari': 1, 'feb': 1, 'mars': 2, 'mar': 2, 'april': 3, 'apr': 3,
    'maj': 4, 'juni': 5, 'jun': 5, 'juli': 6, 'jul': 6, 'augusti': 7, 'aug': 7,
    'september': 8, 'sep': 8, 'sept': 8, 'oktober': 9, 'okt': 9, 'november': 10, 'nov': 10, 'december': 11, 'dec': 11
  };
  var NUMBERS = {
    'en': 1, 'ett': 1, 'två': 2, 'tre': 3, 'fyra': 4, 'fem': 5, 'sex': 6, 'sju': 7, 'åtta': 8,
    'nio': 9, 'tio': 10, 'elva': 11, 'tolv': 12, 'femton': 15, 'tjugo': 20, 'trettio': 30, 'fyrtio': 40, 'femtio': 50
  };
  var NUM = '(\\d+|' + Object.keys(NUMBERS).join('|') + ')';
  var WD = '(' + Object.keys(WEEKDAYS).join('|') + ')(?:en)?';
  var MON = '(' + Object.keys(MONTHS).sort(function (a, b) { return b.length - a.length; }).join('|') + ')\\.?';
  var B = '(?=$|[\\s,.!?])'; // ordgräns som fungerar med å/ä/ö
  var A = '(?:^|\\s)';

  function num(s) { return /^\d+$/.test(s) ? parseInt(s, 10) : NUMBERS[s]; }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function parse(input, nowArg) {
    var now = nowArg ? new Date(nowArg) : new Date();
    var text = ' ' + String(input || '').replace(/\s+/g, ' ').trim() + ' ';
    var lower = text.toLowerCase();
    var day = null;      // Date (midnatt) för dagen
    var time = null;     // {h, m}
    var exact = null;    // exakt Date (från "om X minuter")
    var repeat = 'none';
    var cuts = [];

    function take(re, fn) {
      var m = re.exec(lower);
      if (!m) return false;
      if (fn(m) === false) return false;
      cuts.push([m.index, m.index + m[0].length]);
      lower = lower.slice(0, m.index) + ' '.repeat(m[0].length) + lower.slice(m.index + m[0].length);
      return true;
    }

    // Inledande fraser
    take(new RegExp('^\\s*(?:hej\\s+)?(?:kan du\\s+)?(?:påminn(?:a|er)?|kom ihåg)(?: mig)?(?: om)?(?: att)?' + B), function () {});

    // Upprepning
    take(new RegExp(A + '(?:varje|alla) vardag(?:ar)?' + B), function () { repeat = 'weekdays'; });
    take(new RegExp(A + '(?:varje|alla) ' + WD + '(?:ar)?' + B), function (m) {
      repeat = 'weekly'; day = nextWeekday(now, WEEKDAYS[m[1]], true);
    });
    take(new RegExp(A + '(?:varje dag|dagligen|alla dagar)' + B), function () { repeat = 'daily'; });
    take(new RegExp(A + '(?:varje vecka|veckovis)' + B), function () { repeat = 'weekly'; });
    take(new RegExp(A + '(?:varje månad|månadsvis)' + B), function () { repeat = 'monthly'; });
    take(new RegExp(A + '(?:varje år|årligen)' + B), function () { repeat = 'yearly'; });

    // Relativ tid: "om 10 minuter", "om en halvtimme", "om 2 timmar", "om 3 dagar"
    take(new RegExp(A + 'om (?:en )?halvtimme' + B), function () { exact = new Date(now.getTime() + 30 * 60000); });
    take(new RegExp(A + 'om ' + NUM + ' (minut|minuter|min|timme|timmar|tim|h|dag|dagar|vecka|veckor)' + B), function (m) {
      var n = num(m[1]); var u = m[2];
      if (/^min/.test(u)) exact = new Date(now.getTime() + n * 60000);
      else if (/^(tim|h)/.test(u)) exact = new Date(now.getTime() + n * 3600000);
      else if (/^dag/.test(u)) day = startOfDay(addDays(now, n));
      else day = startOfDay(addDays(now, n * 7));
    });

    // Dagar
    take(new RegExp(A + '(?:i )?övermorgon' + B), function () { day = startOfDay(addDays(now, 2)); });
    take(new RegExp(A + 'i ?morgon(?: bitti)?' + B), function (m) {
      day = startOfDay(addDays(now, 1)); if (/bitti/.test(m[0])) time = { h: 7, m: 0 };
    });
    take(new RegExp(A + 'i ?(?:dag|kväll|eftermiddag)' + B), function (m) {
      day = startOfDay(now);
      if (/kväll/.test(m[0])) time = time || { h: 19, m: 0 };
      if (/eftermiddag/.test(m[0])) time = time || { h: 15, m: 0 };
    });
    take(new RegExp(A + '(?:på |nästa |nu på )?' + WD + B), function (m) {
      day = nextWeekday(now, WEEKDAYS[m[1]], false);
    });
    take(new RegExp(A + 'nästa vecka' + B), function () { day = nextWeekday(now, 1, false); });

    // Datum: 2026-12-24, 24/12, 24/12/2026, "den 24 december", "24 dec 2027"
    take(/(?:^|\s)(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[\s,.!?])/, function (m) {
      day = new Date(+m[1], +m[2] - 1, +m[3]);
    });
    take(/(?:^|\s)(?:den )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=$|[\s,!?])/, function (m) {
      day = fixYear(now, +m[1], +m[2] - 1, m[3]);
    });
    take(new RegExp(A + '(?:den |på )?(\\d{1,2}):?(?:e|a)? ' + MON + '(?: (\\d{4}))?' + B), function (m) {
      day = fixYear(now, +m[1], MONTHS[m[2]], m[3]);
    });

    // Klockslag: "kl 9", "kl. 14:30", "klockan 8.15", "18:45", "halv 9", "kvart över 7"
    take(new RegExp(A + '(?:kl\\.?|klockan) (?:halv) ' + NUM + B), function (m) { time = { h: fixHour(num(m[1]) - 1, now), m: 30 }; });
    take(new RegExp(A + '(?:kl\\.?|klockan )?kvart (över|i) ' + NUM + B), function (m) {
      var h = num(m[2]); time = m[1] === 'över' ? { h: fixHour(h, now), m: 15 } : { h: fixHour(h - 1, now), m: 45 };
    });
    take(new RegExp(A + 'halv ' + NUM + B), function (m) { time = { h: fixHour(num(m[1]) - 1, now), m: 30 }; });
    take(new RegExp(A + '(?:kl\\.?|klockan) ?(\\d{1,2})(?:[:.](\\d{2}))?' + B), function (m) {
      time = { h: +m[1], m: m[2] ? +m[2] : 0 };
    });
    take(new RegExp(A + '(?:kl\\.?|klockan) ' + NUM + B), function (m) { time = { h: fixHour(num(m[1]), now), m: 0 }; });
    take(/(?:^|\s)(\d{1,2})[:.](\d{2})(?=$|[\s,!?])/, function (m) {
      if (+m[1] > 23 || +m[2] > 59) return false;
      time = { h: +m[1], m: +m[2] };
    });

    // Tid på dygnet
    take(new RegExp(A + '(?:(?:på |i )?(morgon(?:en)?|förmiddag(?:en)?|eftermiddag(?:en)?|kväll(?:en)?|natt(?:en)?)|(?:på|vid|till|efter) (lunch(?:en)?))' + B), function (m) {
      if (time) return;
      var w = m[1] || m[2];
      if (w === 'morgon') return false; // "i morgon" hanteras ovan
      time = /^morgon/.test(w) ? { h: 8, m: 0 } : /^förmiddag/.test(w) ? { h: 10, m: 0 } :
             /^lunch/.test(w) ? { h: 12, m: 0 } : /^eftermiddag/.test(w) ? { h: 15, m: 0 } :
             /^kväll/.test(w) ? { h: 19, m: 0 } : { h: 22, m: 0 };
    });

    // Sätt ihop resultat
    var date = null;
    if (exact) {
      date = exact;
      if (time) { date = new Date(exact); date.setHours(time.h, time.m, 0, 0); }
    } else if (day || time) {
      date = new Date(day || startOfDay(now));
      if (time) date.setHours(time.h, time.m, 0, 0); else date.setHours(9, 0, 0, 0);
      if (!day && date <= now) date = addDays(date, 1); // "kl 7" som redan passerat = imorgon
    } else if (repeat !== 'none') {
      date = new Date(startOfDay(now)); date.setHours(9, 0, 0, 0);
      if (date <= now) date = addDays(date, 1);
    }

    if (repeat === 'weekdays' && date) {
      while (date.getDay() === 0 || date.getDay() === 6) date = addDays(date, 1);
    }

    // Titel = det som blev kvar av originaltexten
    var title = text;
    cuts.sort(function (a, b) { return b[0] - a[0]; }).forEach(function (c) {
      title = title.slice(0, c[0]) + ' ' + title.slice(c[1]);
    });
    title = title.replace(/\s+/g, ' ')
      .replace(/^[\s,.:;-]*(?:att|om|och)\s+/i, '')
      .replace(/\s+(?:att|om|och)$/i, '')
      .replace(/^(?:att|om)\s+/i, '')
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
      .replace(/^(?:att)\s+/i, '');
    if (title) title = title.charAt(0).toUpperCase() + title.slice(1);

    return { title: title, date: date, repeat: repeat };
  }

  function nextWeekday(now, wd, allowToday) {
    var d = startOfDay(now);
    var diff = (wd - d.getDay() + 7) % 7;
    if (diff === 0 && !allowToday) diff = 7;
    return addDays(d, diff);
  }
  function fixYear(now, d, mo, y) {
    if (y) { y = +y; if (y < 100) y += 2000; return new Date(y, mo, d); }
    var x = new Date(now.getFullYear(), mo, d);
    if (x < startOfDay(now)) x.setFullYear(x.getFullYear() + 1);
    return x;
  }
  // "kl tre" utan dygnsangivelse: 1–6 tolkas som eftermiddag
  function fixHour(h, now) { return (h >= 1 && h <= 6) ? h + 12 : h; }

  root.parseReminder = parse;
  if (typeof module !== 'undefined') module.exports = parse;
})(typeof window !== 'undefined' ? window : globalThis);
