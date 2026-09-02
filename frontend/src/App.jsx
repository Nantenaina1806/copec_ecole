import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { LoadingScreen } from './components/Feedback';

const Login = lazy(() => import('./pages/Login'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Actualites = lazy(() => import('./pages/Actualites'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const ScanAbsence = lazy(() => import('./pages/ScanAbsence'));
const PointageSalle = lazy(() => import('./pages/PointageSalle'));
const ConfirmerCompte = lazy(() => import('./pages/ConfirmerCompte'));
const VerificationSelfiePointage = lazy(() => import('./pages/VerificationSelfiePointage'));
const VerificationBulletin = lazy(() => import('./pages/VerificationBulletin'));
const EspaceEtudiant = lazy(() => import('./pages/EspaceEtudiant'));
const EspaceEnseignant = lazy(() => import('./pages/EspaceEnseignant'));
const EspaceAgent = lazy(() => import('./pages/EspaceAgent'));

const STAFF_ROLES = ['admin', 'enseignant', 'secretaire', 'economie', 'surveillant', 'accueil'];

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen label="Chargement de l'application…" />}>
      <Routes>
        <Route path="/" element={<Navigate to="/actualites" replace />} />
        <Route path="/actualites" element={<Actualites />} />
        <Route path="/login" element={<Login />} />
        <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verification-bulletin/:token" element={<VerificationBulletin />} />

        <Route path="/admin/*" element={
          <ProtectedRoute roles={STAFF_ROLES}><AdminDashboard /></ProtectedRoute>
        } />

        <Route path="/scan" element={
          <ProtectedRoute roles={['enseignant']}><ScanAbsence /></ProtectedRoute>
        } />

        <Route path="/confirmer-compte" element={
          <ProtectedRoute roles={['enseignant']}><ConfirmerCompte /></ProtectedRoute>
        } />

        <Route path="/pointage-verification" element={
          <ProtectedRoute roles={['enseignant']}><VerificationSelfiePointage /></ProtectedRoute>
        } />

        <Route path="/pointage-salle" element={
          <ProtectedRoute roles={['enseignant']}><PointageSalle /></ProtectedRoute>
        } />

        <Route path="/espace-etudiant" element={
          <ProtectedRoute roles={['eleve']}><EspaceEtudiant /></ProtectedRoute>
        } />

        <Route path="/mon-espace" element={
          <ProtectedRoute roles={['enseignant']}><EspaceEnseignant /></ProtectedRoute>
        } />

        <Route path="/admin/enseignants/:id/espace" element={
          <ProtectedRoute roles={['admin']}><EspaceEnseignant adminView /></ProtectedRoute>
        } />

        <Route path="/admin/agents/:id/espace" element={
          <ProtectedRoute roles={['admin']}><EspaceAgent /></ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/actualites" replace />} />
      </Routes>
    </Suspense>
  );
}
