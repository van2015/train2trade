export interface ChartThemeColors {
  chartBg: string;
  chartText: string;
  chartGrid: string;
}

export function getChartThemeColors(): ChartThemeColors {
  const styles = getComputedStyle(document.documentElement);
  return {
    chartBg: styles.getPropertyValue('--chart-bg').trim() || '#ffffff',
    chartText: styles.getPropertyValue('--chart-text').trim() || '#666680',
    chartGrid: styles.getPropertyValue('--chart-grid').trim() || '#e8e8e8',
  };
}
