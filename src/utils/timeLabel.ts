import { Timeframe } from '../timeframe/Timeframe';

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'UTC',
};

function formatOptionsFor(timeframe: Timeframe): Intl.DateTimeFormatOptions {
  const minutes = Timeframe.getMinutes(timeframe);

  if (minutes < 60) {
    return { ...DATE_OPTIONS, hour: '2-digit', minute: '2-digit' };
  }

  if (minutes < 1440) {
    return { ...DATE_OPTIONS, hour: '2-digit' };
  }

  return DATE_OPTIONS;
}

export function createTimeLabelFormatter(
  timeframe: Timeframe,
  locale?: string
): (time: number) => string {
  const resolvedLocale = locale ?? (typeof navigator !== 'undefined' ? navigator.language : undefined);
  const formatter = new Intl.DateTimeFormat(resolvedLocale, formatOptionsFor(timeframe));

  return (time: number) => formatter.format(new Date(time * 1000));
}
