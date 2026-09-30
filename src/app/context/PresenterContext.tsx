import { createContext } from 'react';
import AppPresenter from '../../chart/presenters/AppPresenter';

export const PresenterContext = createContext<AppPresenter | null>(null);
