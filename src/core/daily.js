/**
 * Daily challenge identity uses UTC so every player receives the same seed for
 * the whole calendar day, regardless of their local time zone.
 */
export function dailyId(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('dailyId expects a valid Date');
  }
  return date.toISOString().slice(0, 10);
}

export function dailySeed(themeId, date = new Date()) {
  return dailySeedForDay(themeId, dailyId(date));
}

export function dailySeedForDay(themeId, day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new TypeError('dailySeedForDay expects a UTC day in YYYY-MM-DD form');
  }
  return `daily:${day}:${themeId}`;
}
