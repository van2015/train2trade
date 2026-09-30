import { useState, useEffect, useContext, useCallback } from 'react';
import { PresenterContext } from '../context/PresenterContext';
import { Timeframe as TimeframeType } from '../../shared/timeframe/Timeframe';
import { IndicatorId } from '../../shared/types/asset';
import { Interval } from '../../shared/utils/Interval';

export function useAppPresenter() {
  const presenter = useContext(PresenterContext);
  if (!presenter) {
    throw new Error('Must be inside PresenterProvider');
  }

  const [state, setState] = useState(() => presenter.getState());

  useEffect(() => {
    const unsubscribe = presenter.subscribe(setState);
    return unsubscribe;
  }, [presenter]);

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

  const addIndicator = useCallback(
    (id: IndicatorId) => presenter.addIndicator(id),
    [presenter]
  );

  const removeIndicator = useCallback(
    (key: string) => presenter.removeIndicator(key),
    [presenter]
  );

  const updateIndicator = useCallback(
    (key: string, params: Record<string, number>) => presenter.updateIndicator(key, params),
    [presenter]
  );

  const priceSample = useCallback(
    (assetId: string, tf: TimeframeType) => presenter.priceSample(assetId, tf),
    [presenter]
  );

  const requestRange = useCallback(
    (assetId: string, interval: Interval) => presenter.requestRange(assetId, interval),
    [presenter]
  );

  const getCurrentRange = useCallback(
    () => presenter.getCurrentRange(),
    [presenter]
  );

  const hasCompleteData = useCallback(
    (interval: Interval) => presenter.hasCompleteData(interval),
    [presenter]
  );

  const clearWarnings = useCallback(
    () => presenter.clearWarnings(),
    [presenter]
  );

  const getAssetList = useCallback(
    () => presenter.getAssetList(),
    [presenter]
  );

  return {
    state,
    getAssetList,
    importAsset,
    selectAsset,
    removeAsset,
    changeChartType,
    changeTimeframe,
    addIndicator,
    removeIndicator,
    updateIndicator,
    priceSample,
    requestRange,
    getCurrentRange,
    hasCompleteData,
    clearWarnings,
  };
}
