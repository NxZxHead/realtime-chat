import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ProfileModal from './ProfileModal';

const isDevHost = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '3000';
const API = import.meta.env.VITE_API_URL || (isDevHost ? 'http://localhost:8000' : '');
const WS_URL = import.meta.env.VITE_WS_URL ||
  (isDevHost ? 'ws://localhost:8000' : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

const STATUS_COR = { online: '#3ba55c', idle: '#faa61a', dnd: '#ed4245', invisible: '#80848e' };

export default function Home() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  });
  const token = localStorage.getItem('token');

  const [rooms, setRooms] = useState([]);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [viewingScreen, setViewingScreen] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [presence, setPresence] = useState([]);
  const [connectionState, setConnectionState] = useState('desconectado');
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [screenSender, setScreenSender] = useState(null); // quem está transmitindo
  const [showProfile, setShowProfile] = useState(false);
  const [toast, setToast] = useState(null);

  // refs mutáveis (evitam stale closures)
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const messagesEndRef = useRef(null);
  const accountMenuRef = useRef(null);

  useEffect(() => {
    if (!token) { navigate('/login'); return; }
    loadTokens();
    fetchRooms();
    fetchProfile();
    return () => disconnectAll();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // fecha menus ao clicar fora / ESC
  useEffect(() => {
    const onDown = (e) => {
      if (showAccountMenu && accountMenuRef.current &&
          !accountMenuRef.current.contains(e.target)) {
        setShowAccountMenu(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setShowAccountMenu(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showAccountMenu]);

  const mostrarToast = (texto, cor = '#5865F2') => {
    setToast({ texto, cor });
    setTimeout(() => setToast(null), 3200);
  };

  const loadTokens = async () => {
    try {
      const res = await fetch(`${API}/api/tokens?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      setTokens(data.tokens_left);
    } catch { /* offline */ }
  };

  const fetchProfile = async () => {
    try {
      const res = await fetch(`${API}/api/profile?token=${encodeURIComponent(token)}`);
      if (res.ok) {
        const perfil = await res.json();
        const atualizado = { ...user, ...perfil };
        setUser(atualizado);
        localStorage.setItem('user', JSON.stringify(atualizado));
      }
    } catch { /* offline */ }
  };

  const fetchRooms = async () => {
    try {
      const res = await fetch(`${API}/api/rooms?token=${encodeURIComponent(token)}`);
      setRooms(await res.json());
    } catch { /* offline */ }
  };

  const createRoom = async () => {
    if (!newRoomName.trim()) return;
    try {
      const res = await fetch(`${API}/api/rooms?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoomName, description: `por ${user.display_name || user.username}` }),
      });
      const data = await res.json();
      if (res.ok) {
        setRooms((r) => [data, ...r]);
        setNewRoomName('');
        setShowCreateRoom(false);
        joinRoom(data.room_id);
        mostrarToast(`Sala #${data.name} criada!`, '#3ba55c');
      } else alert(data.detail || 'Erro ao criar sala');
    } catch { alert('Erro de conexão'); }
  };

  // ------------------------------------------------------------- WebSocket
  const joinRoom = (room_id) => {
    disconnectAll();
    setSelectedRoom(room_id);
    setMessages([]);
    setPresence([]);
    setConnectionState('conectando');

    const url = `${WS_URL}/ws/${room_id}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnectionState('conectado');
    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      handleWsMessage(data);
    };
    ws.onclose = (ev) => {
      setConnectionState('desconectado');
      wsRef.current = null;
      if (ev && ev.code === 4401) {
        // servidor reprovou o token (expirou) — sai e pede pra logar de novo
        mostrarToast('Sua sessão expirou — entre novamente 🔄', '#ed4245');
        setTimeout(() => logout(), 1600);
      }
    };
    ws.onerror = () => setConnectionState('erro');
  };

  const handleWsMessage = async (data) => {
    switch (data.type) {
      case 'history':
        setMessages(data.messages.map((m) => ({ ...m, ts: new Date(m.timestamp) })));
        break;
      case 'pong':
        break;
      case 'ping':
        // responde o ping do servidor p/ ele saber que estamos vivos
        sendMessage({ type: 'pong', timestamp: Date.now() });
        break;
      case 'tokens_update':
        setTokens(data.tokens_left);
        break;
      case 'error_tokens':
        mostrarToast(data.error || 'Sem tokens!', '#ed4245');
        break;
      case 'presence':
        setPresence(data.users || []);
        break;
      case 'system':
        setMessages((prev) => [...prev, { ...data, ts: new Date(data.timestamp), type: 'system' }]);
        break;
      case 'screen_start':
        setScreenSender(data.display_name || data.sender_username);
        setMessages((prev) => [...prev, {
          ...data, ts: new Date(data.timestamp), type: 'system',
          content: `${data.display_name || data.sender_username} iniciou a transmissão de tela 🖥️`,
        }]);
        break;
      case 'screen_stop':
        setScreenSender(null);
        closeViewer();
        setMessages((prev) => [...prev, {
          ...data, ts: new Date(data.timestamp), type: 'system',
          content: `${data.display_name || data.sender_username} parou a transmissão`,
        }]);
        break;
      case 'text':
        setMessages((prev) => [...prev, { ...data, ts: new Date(data.timestamp) }]);
        break;
      // ---------------- sinalização WebRTC ----------------
      case 'screen_init':
        await handleScreenOffer(data);
        break;
      case 'screen_answer':
        if (pcRef.current && data.answer) {
          try {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
            setScreenShareActive(true);
          } catch (e) { console.error('setRemoteDescription answer:', e); }
        }
        break;
      case 'screen_candidate':
        if (pcRef.current && data.candidate) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)); }
          catch (e) { console.error('addIceCandidate:', e); }
        }
        break;
      default:
        break;
    }
  };

  const sendMessage = (payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  };

  const sendText = () => {
    const content = inputText.trim();
    if (!content || !selectedRoom) return;
    if (tokens <= 0) {
      mostrarToast('Sem moedas! Recarregue para continuar enviando 🪙', '#ed4245');
      return;
    }
    if (sendMessage({ type: 'text', content })) setInputText('');
  };

  // --------------------------------------------------------- screen share
  const getIceServers = async () => {
    try {
      const r = await fetch(`${API}/api/ice-servers`);
      return (await r.json()).iceServers || [];
    } catch { return []; }
  };

  const startScreenShare = async () => {
    if (screenShareActive || !wsRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 }, audio: true,
      });
      localStreamRef.current = stream;
      const pc = new RTCPeerConnection({ iceServers: await getIceServers() });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'screen_candidate', candidate: e.candidate }));
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setScreenShareActive(false); setViewingScreen(false);
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendMessage({ type: 'screen_init', offer });
      sendMessage({ type: 'screen_start', content: '' });
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getVideoTracks()[0].onended = () => stopScreenShare();
      setScreenShareActive(true);
      mostrarToast('Você está transmitindo sua tela! 🖥️', '#3ba55c');
    } catch (e) {
      if (e.name !== 'NotAllowedError') mostrarToast('Erro ao compartilhar: ' + e.message, '#ed4245');
    }
  };

  const stopScreenShare = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    sendMessage({ type: 'screen_stop', content: '' });
    setScreenShareActive(false);
    setViewingScreen(false);
  };

  const handleScreenOffer = async (data) => {
    if (screenShareActive) return;
    try {
      closeViewer();
      const pc = new RTCPeerConnection({ iceServers: await getIceServers() });
      pcRef.current = pc;
      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0];
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
        setViewingScreen(true);
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'screen_candidate', candidate: e.candidate }));
        }
      };
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendMessage({ type: 'screen_answer', answer });
    } catch (e) { console.error('handleScreenOffer:', e); }
  };

  const closeViewer = () => {
    if (pcRef.current && !localStreamRef.current) {
      pcRef.current.close(); pcRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    remoteStreamRef.current = null;
    setViewingScreen(false);
  };

  const disconnectAll = () => {
    stopScreenShare();
    if (wsRef.current) { try { wsRef.current.close(); } catch { /* noop */ } wsRef.current = null; }
  };

  const logout = () => {
    disconnectAll();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.dispatchEvent(new Event('auth-changed'));
    navigate('/login');
  };

  const savedProfile = (novo) => {
    setUser(novo);
    localStorage.setItem('user', JSON.stringify(novo));
    mostrarToast('Perfil atualizado! ✨', '#3ba55c');
  };

  const meuAvatar = user.avatar || { color: '#5865F2', emoji: '🙂' };
  const meuNome = user.display_name || user.username || '…';
  const myStatus = STATUS_COR[user.status] ? user.status : 'online';

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#313338' }}>
      {/* ============ barra de servidores ============ */}
      <div style={{
        width: '72px', background: '#1e1f22', display: 'flex', flexDirection: 'column',
        alignItems: 'center', paddingTop: '12px', borderRight: '1px solid #202225',
      }}>
        <div title="Início" style={{
          width: '48px', height: '48px', background: '#5865F2', borderRadius: '18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '8px',
          color: '#fff', fontSize: '22px', boxShadow: '0 2px 8px rgba(88,101,242,.4)',
        }}>💬</div>

        <div style={{ width: '32px', height: '2px', background: '#2b2d31', borderRadius: '2px', marginBottom: '8px' }} />

        {showCreateRoom && (
          <div style={{
            position: 'absolute', left: '78px', background: '#111214', padding: '10px',
            borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,.5)', zIndex: 30,
            display: 'flex', flexDirection: 'column', gap: '8px', width: '200px',
          }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: '13px' }}>Criar sala</div>
            <input
              autoFocus value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createRoom()}
              placeholder="nome-da-sala"
              style={{
                background: '#1e1f22', border: '1px solid #2b2d31', color: '#fff',
                padding: '8px', borderRadius: '4px', fontSize: '13px', outline: 'none',
              }}
            />
            <button
              onClick={createRoom}
              style={{
                background: '#5865F2', border: 'none', color: '#fff', padding: '8px',
                borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 700,
              }}
            >✦ Criar sala</button>
          </div>
        )}

        <div
          onClick={() => setShowCreateRoom((v) => !v)}
          title="Criar sala"
          style={{
            width: '48px', height: '48px', background: '#313338', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#52f17b', fontSize: '24px', border: '1px dashed #4e5058',
            transition: 'all .15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3ba55c'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.border = 'none'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#313338'; e.currentTarget.style.color = '#52f17b'; e.currentTarget.style.border = '1px dashed #4e5058'; }}
        >{showCreateRoom ? '✕' : '+'}</div>

        <div style={{ flex: 1 }} />
      </div>

      {/* ============ canais ============ */}
      <div style={{ width: '240px', background: '#2b2d31', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          height: '48px', padding: '12px 16px', fontWeight: 700, fontSize: '15px', color: '#f2f3f5',
          borderBottom: '1px solid #202225', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', boxShadow: '0 1px 0 rgba(0,0,0,.2)',
        }}>
          Meu Servidor
          <span style={{ fontSize: '11px', color: '#949ba4', fontWeight: 400 }}>
            {rooms.length} sala{rooms.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ flex: 1, padding: '8px', overflowY: 'auto' }}>
          {rooms.length === 0 && (
            <div style={{ color: '#80848e', fontSize: '13px', padding: '10px', lineHeight: 1.5 }}>
              Nenhuma sala ainda.<br />Clique no <b style={{ color: '#52f17b' }}>+</b> para criar a primeira!
            </div>
          )}
          {rooms.map((room) => (
            <div
              key={room.id}
              onClick={() => joinRoom(room.room_id)}
              style={{
                padding: '8px 10px', borderRadius: '6px', marginBottom: '2px', cursor: 'pointer',
                color: selectedRoom === room.room_id ? '#f2f3f5' : '#949ba4',
                background: selectedRoom === room.room_id ? '#404249' : 'transparent',
                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px',
                fontWeight: 500, transition: 'background .12s ease, color .12s ease',
              }}
              onMouseEnter={(e) => { if (selectedRoom !== room.room_id) e.currentTarget.style.color = '#dbdee1'; }}
              onMouseLeave={(e) => { if (selectedRoom !== room.room_id) e.currentTarget.style.color = '#949ba4'; }}
            >
              <span style={{ color: '#80848e', fontSize: '16px' }}>#</span>
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room.name}</span>
              {room.users > 0 && (
                <span style={{ fontSize: '10px', background: '#313338', borderRadius: '8px', padding: '1px 6px' }}>
                  {room.users}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* ===== painel da conta (antes era o quadrado vermelho!) ===== */}
        <div
          ref={accountMenuRef}
          style={{ position: 'relative', background: '#232428', padding: '8px' }}
        >
          {showAccountMenu && (
            <div style={{
              position: 'absolute', bottom: '64px', left: '8px', right: '8px',
              background: '#111214', borderRadius: '8px', padding: '6px',
              boxShadow: '0 8px 28px rgba(0,0,0,.6)', zIndex: 40,
              animation: 'pop-in .15s ease', border: '1px solid #2b2d31',
            }}>
              <div style={{
                padding: '8px 10px', fontSize: '12px', color: '#949ba4',
                borderBottom: '1px solid #2b2d31', marginBottom: '4px',
              }}>
                Conectado como <b style={{ color: '#f2f3f5' }}>{user.username}</b>
              </div>
              <button
                onClick={() => { setShowAccountMenu(false); setShowProfile(true); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: '4px',
                  background: 'transparent', border: 'none', color: '#b5bac1', cursor: 'pointer',
                  fontSize: '14px', display: 'flex', gap: '8px', alignItems: 'center',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#5865F2'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#b5bac1'; }}
              >👤 Editar perfil</button>
              <button
                onClick={() => { setShowAccountMenu(false); loadTokens(); fetchProfile(); mostrarToast('Recarregado ♻️', '#3ba55c'); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: '4px',
                  background: 'transparent', border: 'none', color: '#b5bac1', cursor: 'pointer',
                  fontSize: '14px', display: 'flex', gap: '8px', alignItems: 'center',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#5865F2'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#b5bac1'; }}
              >🔄 Atualizar dados</button>
              <div style={{ height: '1px', background: '#2b2d31', margin: '4px 0' }} />
              <button
                onClick={() => { setShowAccountMenu(false); logout(); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: '4px',
                  background: 'transparent', border: 'none', color: '#f23f43', cursor: 'pointer',
                  fontSize: '14px', display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 600,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#ed4245'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#f23f43'; }}
              >⏻ Fazer logout</button>
            </div>
          )}

        {/* clicável = abre o menu da conta */}
        <div
          onClick={() => setShowAccountMenu((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
            borderRadius: '6px', cursor: 'pointer', transition: 'background .12s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#2b2d31'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          title="Clique para opções da conta"
        >
          <div style={{ position: 'relative' }}>
            <Avatar emoji={meuAvatar.emoji} color={meuAvatar.color} size={32} />
            <span style={{
              position: 'absolute', bottom: '-1px', right: '-1px', width: '12px', height: '12px',
              borderRadius: '50%', background: STATUS_COR[myStatus], border: '2.5px solid #232428',
            }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: '#f2f3f5', fontSize: '13px', fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{meuNome}</div>
            <div style={{ color: '#949ba4', fontSize: '11px' }}>
              {user.status === 'idle' ? 'Ausente' : user.status === 'dnd' ? 'Ocupado' : user.status === 'invisible' ? 'Invisível' : 'Online'}
            </div>
          </div>
          <div style={{
            background: '#1e1f22', borderRadius: '10px', padding: '3px 8px', fontSize: '12px',
            color: '#f0b232', fontWeight: 'bold', flexShrink: 0,
          }} title="Moedas">🪙 {tokens}</div>
        </div>
        </div>
      </div>

      {/* ============ chat principal ============ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* header */}
        <div style={{
          height: '48px', padding: '0 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', borderBottom: '1px solid #202225', background: '#313338',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f2f3f5' }}>
            <span style={{ color: '#80848e', fontSize: '20px' }}>#</span>
            <b style={{ fontSize: '15px' }}>{rooms.find((r) => r.room_id === selectedRoom)?.name || 'Selecione uma sala'}</b>
            <span style={{
              fontSize: '11px', marginLeft: '10px', display: 'flex', alignItems: 'center', gap: '5px',
              background: '#2b2d31', padding: '3px 10px', borderRadius: '10px', color: '#949ba4',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: connectionState === 'conectado' ? '#3ba55c' : connectionState === 'conectando' ? '#faa61a' : '#ed4245' }} />
              {connectionState}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={screenShareActive ? stopScreenShare : startScreenShare}
              disabled={!selectedRoom}
              style={{
                padding: '7px 14px', borderRadius: '6px', border: 'none',
                background: screenShareActive ? '#ed4245' : '#3ba55c', color: '#fff',
                cursor: 'pointer', fontSize: '13px', fontWeight: 700,
                boxShadow: screenShareActive ? '0 0 12px rgba(237,66,69,.5)' : 'none',
              }}
            >
              {screenShareActive ? '⏹ Parar transmissão' : '🖥 Transmitir tela'}
            </button>
            <div style={{
              padding: '6px 12px', borderRadius: '6px', background: '#2b2d31', color: '#f0b232',
              fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px',
            }} title="Moedas para enviar mensagens">
              🪙 {tokens}
            </div>
          </div>
        </div>

        {/* área de vídeo */}
        {(screenShareActive || viewingScreen) && (
          <div style={{ position: 'relative', background: '#000', height: '44vh', minHeight: '240px' }}>
            <video
              ref={(el) => {
                if (screenShareActive) {
                  localVideoRef.current = el;
                  if (el && localStreamRef.current) el.srcObject = localStreamRef.current;
                } else {
                  remoteVideoRef.current = el;
                  if (el && remoteStreamRef.current) el.srcObject = remoteStreamRef.current;
                }
              }}
              autoPlay playsInline muted={screenShareActive}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            <div style={{
              position: 'absolute', bottom: '10px', left: '10px', padding: '5px 12px',
              borderRadius: '6px', fontSize: '12px', fontWeight: 700, display: 'flex',
              alignItems: 'center', gap: '7px',
              background: screenShareActive ? 'rgba(59,165,92,.9)' : 'rgba(88,101,242,.9)',
              color: '#fff',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />
              {screenShareActive
                ? 'Você está transmitindo'
                : `Vendo a tela de ${screenSender || 'outro usuário'}`}
            </div>
          </div>
        )}

        {/* mensagens */}
        <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
          {!selectedRoom && (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#80848e', flexDirection: 'column', gap: '10px',
            }}>
              <div style={{ fontSize: '42px' }}>👋</div>
              <div style={{ fontSize: '15px' }}>Selecione ou crie uma sala para começar</div>
            </div>
          )}
          {messages.map((msg, i) => {
            const key = msg.id || `m${i}`;
            if (msg.type === 'system' || msg.sender_id === 'system') {
              return (
                <div key={key} style={{
                  color: '#949ba4', fontSize: '13px', marginBottom: '2px', padding: '3px 0',
                  display: 'flex', gap: '8px', alignItems: 'center',
                }}>
                  <span style={{
                    color: '#80848e', background: '#2b2d31', borderRadius: '4px',
                    padding: '1px 7px', fontSize: '13px',
                  }}>ℹ</span>
                  {msg.content}
                </div>
              );
            }
            const isMine = msg.sender_id === user.user_id;
            const av = msg.avatar || {};
            const nome = msg.display_name || msg.sender_username;
            return (
              <div key={key} style={{ display: 'flex', gap: '12px', marginBottom: '14px', marginTop: '6px' }}>
                <Avatar emoji={av.emoji || '🙂'} color={av.color || '#5865F2'} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', marginBottom: '3px' }}>
                    <b style={{ color: isMine ? '#5865F2' : '#f2f3f5' }}>{nome}</b>
                    <span style={{ fontSize: '11px', color: '#949ba4' }}>
                      {new Date(msg.ts || msg.timestamp).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="msg-body" style={{
                    background: '#2b2d31', padding: '9px 14px', borderRadius: '8px',
                    color: '#dbdee1', fontSize: '15px', wordBreak: 'break-word', lineHeight: 1.45,
                    display: 'inline-block', maxWidth: '100%',
                  }}>
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* input */}
        <div style={{ padding: '0 16px 16px', background: '#313338' }}>
          <div style={{
            background: '#383a40', borderRadius: '8px', padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendText()}
              placeholder={
                selectedRoom
                  ? `Conversar em #${rooms.find((r) => r.room_id === selectedRoom)?.name || ''}`
                  : 'Entre em uma sala para conversar…'
              }
              disabled={!selectedRoom}
              style={{
                flex: 1, background: 'transparent', border: 'none', color: '#dbdee1',
                outline: 'none', fontSize: '15px',
              }}
            />
            <button
              onClick={sendText} disabled={!selectedRoom} title="Enviar (Enter)"
              style={{
                background: 'transparent', border: 'none', color: '#5865F2',
                cursor: 'pointer', fontSize: '17px', fontWeight: 700,
              }}
            >➤</button>
          </div>
          <div style={{
            fontSize: '11px', color: '#80848e', marginTop: '5px',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Enter para enviar · cada mensagem custa 1 🪙</span>
            <span>{tokens} moedas</span>
          </div>
        </div>
      </div>

      {/* ============ membros ============ */}
      <div style={{ width: '240px', background: '#2b2d31', padding: '16px', overflowY: 'auto' }}>
        <h3 style={{ color: '#949ba4', fontSize: '12px', fontWeight: 700, marginBottom: '12px', letterSpacing: '.5px' }}>
          MEMBROS — {presence.length || '—'}
        </h3>
        {presence.map((p, i) => {
          const pav = p.avatar || {};
          const pid = p.user_id || p.username;
          const pstatus = STATUS_COR[p.status] ? p.status : 'online';
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px',
              opacity: pstatus === 'invisible' ? .55 : 1,
            }}>
              <div style={{ position: 'relative' }}>
                <Avatar emoji={pav.emoji || '🙂'} color={pav.color || '#949ba4'} size={34} />
                <span style={{
                  position: 'absolute', bottom: '-1px', right: '-1px', width: '11px', height: '11px',
                  borderRadius: '50%', background: STATUS_COR[pstatus], border: '2.5px solid #2b2d31',
                }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#dbdee1', fontSize: '14px', fontWeight: 500 }}>
                  {p.display_name || p.username}
                </div>
                <div style={{ color: '#80848e', fontSize: '11px' }}>
                  {pstatus === 'idle' ? 'Ausente' : pstatus === 'dnd' ? 'Ocupado' : pstatus === 'invisible' ? 'Invisível' : 'Online'}
                </div>
              </div>
            </div>
          );
        })}
        {!presence.length && (
          <div style={{ color: '#80848e', fontSize: '13px' }}>
            Só você por enquanto… compartilhe o link da sala!
          </div>
        )}
        {screenSender && (
          <div style={{
            marginTop: '18px', background: 'rgba(88,101,242,.14)', padding: '10px',
            borderRadius: '8px', fontSize: '12px', color: '#8b9eff', fontWeight: 600,
            border: '1px solid rgba(88,101,242,.35)',
          }}>
            🖥️ {screenSender} está transmitindo
          </div>
        )}
      </div>

      {/* ============ toasts ============ */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: '#111214', color: '#fff', padding: '12px 22px', borderRadius: '10px',
          boxShadow: '0 8px 30px rgba(0,0,0,.55)', fontSize: '14px', fontWeight: 600,
          borderLeft: `4px solid ${toast.cor}`, zIndex: 999, animation: 'toast-in .2s ease',
        }}>
          {toast.texto}
        </div>
      )}

      {/* ============ modal de perfil ============ */}
      {showProfile && (
        <ProfileModal
          user={{ ...user, display_name: meuNome, avatar: meuAvatar, status: myStatus }}
          token={token}
          onClose={() => setShowProfile(false)}
          onSaved={savedProfile}
        />
      )}
    </div>
  );
}

function Avatar({ emoji = '🙂', color = '#5865F2', size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.5, flexShrink: 0, lineHeight: 1,
    }}>
      {emoji}
    </div>
  );
}