import { useContext, useCallback } from 'react';
import { PresenterContext } from '../context/PresenterContext';
import { usePresenter } from './usePresenter';

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
    loadAssets,
  };
}
