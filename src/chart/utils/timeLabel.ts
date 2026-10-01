import { Timeframe } from '../../backtest/timeframe/Timeframe';

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'UTC',
};

export class TimeLabelFormatter {
  private readonly formatter: Intl.DateTimeFormat;

  constructor(timeframe: Timeframe, locale?: string) {
    const resolvedLocale = locale ?? (typeof navigator !== 'undefined' ? navigator.language : undefined);
    this.formatter = new Intl.DateTimeFormat(resolvedLocale, this.formatOptionsFor(timeframe));
  }

  private formatOptionsFor(timeframe: Timeframe): Intl.DateTimeFormatOptions {
    const minutes = Timeframe.getMinutes(timeframe);

    if (minutes < 60) {
      return { ...DATE_OPTIONS, hour: '2-digit', minute: '2-digit' };
    }

    if (minutes < 1440) {
      return { ...DATE_OPTIONS, hour: '2-digit' };
    }

    return DATE_OPTIONS;
  }

  format(time: number): string {
    return this.formatter.format(new Date(time * 1000));
  }
}

export function createTimeLabelFormatter(
  timeframe: Timeframe,
  locale?: string
): (time: number) => string {
  const formatter = new TimeLabelFormatter(timeframe, locale);
  return (time: number) => formatter.format(time);
}
