import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const CORES = [
  '#5865F2', '#57F287', '#FEE75C', '#ED4245', '#EB459E',
  '#949BA4', '#3ba55c', '#faa61a', '#00b0f4', '#8b5cf6',
];

const EMOJIS = [
  '😀', '😎', '🥳', '🤖', '👻', '🧙', '🦊', '🐼',
  '🐸', '👑', '🔥', '⚡', '🎮', '🎧', '🚀', '🌙',
  '😺', '🧋', '🍩', '🎸', '🎭', '🌵', '🥝', '🌟',
];

const STATUS = [
  { id: 'online', label: 'Online', cor: '#3ba55c', desc: 'Está disponível' },
  { id: 'idle', label: 'Ausente', cor: '#faa61a', desc: 'Ausente há algum tempo' },
  { id: 'dnd', label: 'Não perturbe', cor: '#ed4245', desc: 'Não recebe alertas' },
  { id: 'invisible', label: 'Invisível', cor: '#80848e', desc: 'Aparece offline' },
];

export default function ProfileModal({ user, onClose, onSaved, token }) {
  const [displayName, setDisplayName] = useState(user.display_name || user.username || '');
  const [emoji, setEmoji] = useState(user.avatar?.emoji || '🙂');
  const [color, setColor] = useState(user.avatar?.color || '#5865F2');
  const [status, setStatus] = useState(user.status || 'online');
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  // fecha com ESC
  const onKey = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const salvar = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/profile?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName.trim() || user.username,
          avatar_emoji: emoji,
          avatar_color: color,
          status,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedTick(true);
        onSaved({
          ...user,
          display_name: data.display_name,
          avatar: data.avatar,
          status: data.status,
        });
        setTimeout(() => { setSavedTick(false); onClose(); }, 650);
      } else {
        alert(data.detail || 'Erro ao salvar perfil');
      }
    } catch {
      alert('Erro de conexão com o servidor');
    }
    setSaving(false);
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, animation: 'fade-in .15s ease',
      }}
    >
      <div style={{
        background: '#2b2d31', width: '440px', maxWidth: '94vw',
        borderRadius: '8px', boxShadow: '0 12px 40px rgba(0,0,0,.5)',
        animation: 'pop-in .18s ease', overflow: 'hidden', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* header */}
        <div style={{
          padding: '18px 20px 12px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ fontSize: '18px', color: '#fff', fontWeight: 700 }}>
            Editar perfil
          </h2>
          <button
            onClick={onClose} title="Fechar (ESC)"
            style={{
              background: 'transparent', border: 'none', color: '#949ba4',
              fontSize: '20px', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px',
            }}
          >✕</button>
        </div>

        <div style={{ padding: '4px 20px 20px', overflowY: 'auto' }}>
          {/* preview do avatar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '16px',
            padding: '16px', background: '#1e1f22', borderRadius: '8px', marginBottom: '16px',
          }}>
            <div style={{
              width: '72px', height: '72px', borderRadius: '50%', background: color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '34px', border: '3px solid #1e1f22', flexShrink: 0,
            }}>{emoji}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '17px' }}>
                {displayName || user.username}
              </div>
              <div style={{ color: '#949ba4', fontSize: '13px', marginTop: '2px' }}>
                @{user.username}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                {STATUS.map((s) => (
                  <span key={s.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    fontSize: '11px', color: status === s.id ? '#fff' : '#80848e',
                    background: status === s.id ? 'rgba(255,255,255,.08)' : 'transparent',
                    padding: '2px 8px', borderRadius: '10px',
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.cor }} />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* nome */}
          <label style={lbl}>NOME DE EXIBIÇÃO</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
            placeholder={user.username}
            style={inp}
          />
          <div style={{ fontSize: '11px', color: '#80848e', margin: '4px 0 16px' }}>
            Como os outros te veem no chat (máx. 40 caracteres)
          </div>

          {/* emoji do avatar */}
          <label style={lbl}>ÍCONE DO AVATAR</label>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '6px',
            marginBottom: '16px',
          }}>
            {EMOJIS.map((em) => (
              <button
                key={em}
                onClick={() => setEmoji(em)}
                style={{
                  aspectRatio: '1', fontSize: '16px', cursor: 'pointer',
                  background: emoji === em ? color : '#1e1f22',
                  border: emoji === em ? '2px solid #fff' : '2px solid transparent',
                  borderRadius: '6px',
                }}
              >{em}</button>
            ))}
          </div>

          {/* cor */}
          <label style={lbl}>COR DO AVATAR</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {CORES.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                style={{
                  width: '30px', height: '30px', borderRadius: '50%',
                  background: c, cursor: 'pointer',
                  border: color === c ? '3px solid #fff' : '3px solid transparent',
                  outline: color === c ? 'none' : '1px solid rgba(255,255,255,.15)',
                }}
              />
            ))}
          </div>

          {/* status */}
          <label style={lbl}>STATUS</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {STATUS.map((s) => (
              <button
                key={s.id}
                onClick={() => setStatus(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  background: status === s.id ? 'rgba(88,101,242,.18)' : '#1e1f22',
                  border: status === s.id ? '1px solid #5865F2' : '1px solid transparent',
                  borderRadius: '6px', padding: '8px 12px', cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.cor, flexShrink: 0 }} />
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '13px' }}>{s.label}</span>
                <span style={{ color: '#80848e', fontSize: '12px' }}>{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* footer */}
        <div style={{
          padding: '14px 20px', background: '#232428', display: 'flex',
          alignItems: 'center', justifyContent: 'flex-end', gap: '10px',
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: '#fff',
              cursor: 'pointer', fontSize: '14px', padding: '8px 14px', borderRadius: '4px',
            }}
          >Cancelar</button>
          <button
            onClick={salvar} disabled={saving}
            style={{
              background: savedTick ? '#3ba55c' : '#5865F2', color: '#fff',
              border: 'none', padding: '9px 22px', borderRadius: '4px',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            {saving ? 'Salvando…' : savedTick ? '✓ Salvo!' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

const lbl = {
  display: 'block', fontSize: '12px', fontWeight: 700,
  letterSpacing: '.4px', color: '#b5bac1', marginBottom: '8px',
};
const inp = {
  width: '100%', background: '#1e1f22', border: '1px solid #1e1f22',
  color: '#fff', padding: '10px 12px', borderRadius: '6px',
  fontSize: '15px', outline: 'none', marginBottom: '4px',
};