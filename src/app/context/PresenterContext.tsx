import { createContext } from 'react';
import type AppPresenter from '../../chart/presenters/AppPresenter';

export const PresenterContext = createContext<AppPresenter | null>(null);
