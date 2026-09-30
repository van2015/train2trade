import { createContext } from 'react';
import AppPresenter from '../presenters/AppPresenter';

export const PresenterContext = createContext<AppPresenter | null>(null);
