'use strict';

// Source de vérité temporelle de COPEC : le serveur et PostgreSQL restent maîtres de l'heure.
// L'école est à Madagascar ; tous les calculs métier qui dépendent de l'heure utilisent
// explicitement ce fuseau au lieu du fuseau implicite de Windows/Chrome/Docker.
const TIMEZONE = process.env.APP_TIMEZONE || 'Indian/Antananarivo';
const LOCALE = process.env.APP_LOCALE || 'fr-FR';

function parts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') out[p.type] = p.value;
  return out;
}

function localDateString(date = new Date()) {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function localTimeString(date = new Date()) {
  const p = parts(date);
  return `${p.hour}:${p.minute}:${p.second}`;
}

function localMinutes(date = new Date()) {
  const p = parts(date);
  return Number(p.hour) * 60 + Number(p.minute);
}

function localDayName(date = new Date()) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, weekday: 'long' })
    .format(date)
    .replace(/^./, (c) => c.toUpperCase());
}

function localMonthYear(date = new Date()) {
  const p = parts(date);
  return { mois: Number(p.month), annee: Number(p.year) };
}

function formatDateTime(date = new Date()) {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TIMEZONE, dateStyle: 'short', timeStyle: 'medium',
  }).format(date);
}

module.exports = { TIMEZONE, LOCALE, parts, localDateString, localTimeString, localMinutes, localDayName, localMonthYear, formatDateTime };
