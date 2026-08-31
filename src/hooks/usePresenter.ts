import { useState, useEffect } from 'react';
import AppPresenter, { AppState } from '../presenters/AppPresenter';

export function usePresenter(presenter: AppPresenter) {
  const [state, setState] = useState<AppState>(presenter.getState());

  useEffect(() => {
    const unsubscribe = presenter.subscribe(setState);
    return unsubscribe;
  }, [presenter]);

  return state;
}
