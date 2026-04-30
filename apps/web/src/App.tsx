import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/projects/goose-hub-self" replace />} />
        <Route
          path="/projects/:slug"
          element={
            <div className="flex h-full items-center justify-center text-fg-2">
              <span className="text-xl">Goose Hub</span>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
