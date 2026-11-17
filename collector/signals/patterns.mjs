// Tendances de réassort : à partir des signalements accumulés, quels jours et créneaux reviennent par enseigne.

const DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long' });
const HOUR = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' });
export const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export function slotOf(date) {
  const hour = parseInt(HOUR.format(date), 10); // « 09 h » en français
  return hour < 6 ? 'nuit' : hour < 12 ? 'matin' : hour < 18 ? 'après-midi' : 'soir';
}

export function patterns(signals, { now = Date.now(), days = 60 } = {}) {
  const since = now - days * 86400000;
  const byRetailer = {};
  for (const signal of signals) {
    if (!signal.tcg || !signal.retailer) continue;
    const time = Date.parse(signal.at);
    if (!(time >= since)) continue;
    const date = new Date(time);
    const entry = byRetailer[signal.retailer] ??= { n: 0, magasin: 0, idf: 0, days: {}, slots: {}, last: null, big: false };
    if (signal.big) entry.big = true;
    entry.n += 1;
    if (signal.kind === 'magasin') entry.magasin += 1;
    if (signal.zone === 'IDF') entry.idf += 1;
    const day = DAY.format(date);
    entry.days[day] = (entry.days[day] ?? 0) + 1;
    const slot = slotOf(date);
    entry.slots[slot] = (entry.slots[slot] ?? 0) + 1;
    if (!entry.last || signal.at > entry.last) entry.last = signal.at;
  }
  const result = {};
  for (const [retailer, entry] of Object.entries(byRetailer)) {
    const topDays = Object.entries(entry.days).sort((a, b) => b[1] - a[1] || DAYS.indexOf(a[0]) - DAYS.indexOf(b[0]));
    const topSlot = Object.entries(entry.slots).sort((a, b) => b[1] - a[1])[0];
    result[retailer] = {
      n: entry.n, magasin: entry.magasin, idf: entry.idf, last: entry.last, big: entry.big,
      days: DAYS.map(day => entry.days[day] ?? 0),
      bestDays: topDays.slice(0, 2).filter(([, count]) => count >= 2).map(([day]) => day),
      bestSlot: topSlot && topSlot[1] >= 2 ? topSlot[0] : ''
    };
  }
  // Grandes enseignes d'abord (ce sont elles qu'on visite), puis par nombre de signaux.
  return Object.fromEntries(Object.entries(result).sort((a, b) => Number(b[1].big) - Number(a[1].big) || b[1].magasin - a[1].magasin || b[1].n - a[1].n));
}
