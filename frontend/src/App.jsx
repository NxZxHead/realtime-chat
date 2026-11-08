import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Login from './components/Login';
import Register from './components/Register';
import Home from './components/Home';

/* Lê o token SEMPRE de forma fresca — o problema antigo era capturar
   localStorage na montagem do App e nunca mais atualizar (por isso logar
   "não funcionava": após sucesso o app te mandava pro login de novo). */
const temToken = () => !!localStorage.getItem('token');

function ExigeLogin({ children }) {
  return temToken() ? children : <Navigate to="/login" replace />;
}

function SemLogin({ children }) {
  return temToken() ? <Navigate to="/" replace /> : children;
}

function Rotas() {
  const location = useLocation();
  // dispara re-render das rotas a cada navegação (força releitura do token)
  useEffect(() => { /* location mudou → elementos re-avaliados */ }, [location]);
  return (
    <Routes location={location}>
      <Route path="/login" element={<SemLogin><Login /></SemLogin>} />
      <Route path="/register" element={<SemLogin><Register /></SemLogin>} />
      <Route path="/*" element={<ExigeLogin><Home /></ExigeLogin>} />
    </Routes>
  );
}

export default function App() {
  // escuta eventos de mudança de auth (login/logout feitos dentro das telas)
  const [, setTick] = useState(0);
  useEffect(() => {
    const onAuth = () => setTick((t) => t + 1);
    window.addEventListener('auth-changed', onAuth);
    window.addEventListener('storage', onAuth); // outra aba logar/deslogar
    return () => {
      window.removeEventListener('auth-changed', onAuth);
      window.removeEventListener('storage', onAuth);
    };
  }, []);

  return (
    <BrowserRouter>
      <Rotas />
    </BrowserRouter>
  );
}