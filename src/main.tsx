import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PresenterContext } from './chart/context/PresenterContext';
import AppPresenter from './chart/presenters/AppPresenter';
import './index.css';

const presenter = AppPresenter.getInstance();

function AppWrapper() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    presenter
      .init()
      .then(() => setInitialized(true))
      .catch(err => {
        console.error('Failed to initialize:', err);
        setInitialized(true);
      });
  }, []);

  if (!initialized) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <PresenterContext.Provider value={presenter}>
      <App />
    </PresenterContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWrapper />
  </StrictMode>
);
