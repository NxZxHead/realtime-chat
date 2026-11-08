import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || ''; // mesma origem quando servido pelo backend

function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        // entrou direto — sem precisar logar de novo
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('user', JSON.stringify({
          id: data.user_id,
          user_id: data.user_id,
          username,
          display_name: username,
        }));
        window.dispatchEvent(new Event('auth-changed'));
        navigate('/');
      } else {
        alert(data.detail || 'Erro no cadastro');
      }
    } catch (err) {
      alert('Erro de conexão');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #5865F2 0%, #404EED 100%)',
    }}>
      <div style={{
        background: '#2f3136',
        padding: '40px',
        borderRadius: '10px',
        width: '400px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
      }}>
        <h1 style={{ color: '#fff', marginBottom: '30px', textAlign: 'center' }}>Criar Conta</h1>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', color: '#b5bac1', marginBottom: '8px' }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%', padding: '12px', borderRadius: '5px', border: 'none',
                backgroundColor: '#40444b', color: '#fff',
              }}
              required
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', color: '#b5bac1', marginBottom: '8px' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%', padding: '12px', borderRadius: '5px', border: 'none',
                backgroundColor: '#40444b', color: '#fff',
              }}
              required
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', color: '#b5bac1', marginBottom: '8px' }}>Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%', padding: '12px', borderRadius: '5px', border: 'none',
                backgroundColor: '#40444b', color: '#fff',
              }}
              required
            />
          </div>
          <button
            type="submit"
            style={{
              width: '100%', padding: '12px', borderRadius: '5px', border: 'none',
              backgroundColor: '#5865F2', color: '#fff', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer',
            }}
          >
            Criar Conta
          </button>
        </form>
        <p style={{ marginTop: '20px', color: '#b5bac1', textAlign: 'center' }}>
          Já tem conta?{' '}
          <Link to="/login" style={{ color: '#5865F2', textDecoration: 'none' }}>Entre</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
