import { useContext, useCallback } from 'react';
import { PresenterContext } from '../context/PresenterContext';
import { usePresenter } from './usePresenter';
import { Timeframe as TimeframeType } from '../timeframe/Timeframe';

export interface ViewportRange {
  from: string;
  to: string;
}

export function useAppPresenter() {
  const presenter = useContext(PresenterContext);
  if (!presenter) {
    throw new Error('Must be inside PresenterProvider');
  }

  const state = usePresenter(presenter);

  const importAsset = useCallback(
    (name: string, file: File) => presenter.importAsset(name, file),
    [presenter]
  );

  const selectAsset = useCallback(
    (id: string) => presenter.selectAsset(id),
    [presenter]
  );

  const removeAsset = useCallback(
    (id: string) => presenter.removeAsset(id),
    [presenter]
  );

  const changeChartType = useCallback(
    (type: Parameters<typeof presenter.changeChartType>[0]) => presenter.changeChartType(type),
    [presenter]
  );

  const changeTimeframe = useCallback(
    (tf: TimeframeType) => presenter.changeTimeframe(tf),
    [presenter]
  );

  const getTimeframeData = useCallback(
    (assetId: string, tf: TimeframeType) => presenter.getTimeframeData(assetId, tf),
    [presenter]
  );

  const getChartData = useCallback(
    (assetId: string, tf: TimeframeType) => presenter.getChartData(assetId, tf),
    [presenter]
  );

  const onViewportChange = useCallback(
    (range: ViewportRange) => presenter.onViewportChange(range),
    [presenter]
  );

  const resetViewport = useCallback(
    () => presenter.resetViewport(),
    [presenter]
  );

  const clearWarnings = useCallback(
    () => presenter.clearWarnings(),
    [presenter]
  );

  const loadAssets = useCallback(
    () => presenter.loadAssets(),
    [presenter]
  );

  return {
    state,
    importAsset,
    selectAsset,
    removeAsset,
    changeChartType,
    changeTimeframe,
    getTimeframeData,
    getChartData,
    onViewportChange,
    resetViewport,
    clearWarnings,
    loadAssets,
  };
}
