import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './api';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Queue from './pages/Queue';
import Approved from './pages/Approved';
import Search from './pages/Search';
import Health from './pages/Health';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <div className="app-layout">
            <Sidebar />
            <main className="main-content">
              <Routes>
                <Route path="/" element={<Navigate to="/queue" replace />} />
                <Route path="/queue" element={<Queue />} />
                <Route path="/approved" element={<Approved />} />
                <Route path="/search" element={<Search />} />
                <Route path="/health" element={<Health />} />
              </Routes>
            </main>
          </div>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
