export function localDateTimeToUtc(value: string, timezoneOffset = new Date(value).getTimezoneOffset()) {
  if (!value) return "";
  const localTime = new Date(`${value}Z`);
  if (Number.isNaN(localTime.getTime())) return value;
  return new Date(localTime.getTime() + timezoneOffset * 60000).toISOString();
}

export function nextLocalDateTimeMinute(value: Date) {
  const nextMinute = new Date(value);
  nextMinute.setSeconds(0, 0);
  nextMinute.setMinutes(nextMinute.getMinutes() + 1);
  return utcToLocalDateTime(nextMinute.toISOString());
}

export function utcToLocalDateTime(value: string | null, timezoneOffset?: number) {
  if (!value) return "";
  const date = new Date(value);
  const offset = timezoneOffset ?? date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}
