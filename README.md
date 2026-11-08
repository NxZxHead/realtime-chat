# 💬 Chat RealTime — clone do Discord com transmissão de tela

Aplicativo de comunicação em tempo real com **chat, avatares de perfil,
moedas (tokens) para mensagens e transmissão de tela (WebRTC)** — 100% aberto,
testado de ponta a ponta.

![status](https://img.shields://img.shields.io/badge/status-Funcional-3ba55c) ![python](https://img.shields.io/badge/Python-3.11%2B-3776AB) ![react](https://img.shields.io/badge/React-18-61DAFB)

---

## ✨ Funcionalidades

| | |
|---|---|
| 🧑‍💻 **Cadastro / Login** | bcrypt + JWT (7 dias), entra automático após cadastro |
| 💰 **Sistema de moedas** | 20 grátis, 1 por mensagem, recarga simbólica, bloqueio ao zerar |
| 💬 **Chat em tempo real** | WebSocket, histórico, entradas/saídas, presença de membros |
| 👤 **Perfil** | nome de exibição, emoji + cor de avatar, status (online/ausente/ocupado/invisível) |
| 🖥️ **Transmissão de tela** | WebRTC p2p (getDisplayMedia + sinalização offer/answer/candidate relay) |
| 🎨 **UI estilo Discord** | sidebar de servidores/canais, toasts, dropdown de conta |

## 🚀 Subir localmente

```bash
# backend (porta 8000)
cd backend
pip install -r requirements.txt
python main.py

# ou desenvolvimento com hot-reload no frontend (porta 3000)
cd frontend
npm install
npm run dev   # acessa http://localhost:3000 (usa proxy p/ :8000)
```

No Windows, duplo clique em **`iniciar.bat`** já sobe tudo servindo em
<http://localhost:8000> (frontend + API no mesmo endereço).

Ou via Docker:

```bash
docker build -t realtime-chat .
docker run -p 8000:8000 -v chatdata:/app/backend realtime-chat
```

## 🌐 Deploy

### Opção A — Render (grátis, automático)
1. Suba este repositório no GitHub
2. No Render: **New → Web Service** → conecte o repo
3. Ele detecta sozinho o `render.yaml` (build + disco persistente pra conta
   não sumir ao reiniciar) → **Deploy**

### Opção B — Railway / Fly / VPS
As variáveis que importam lêem do ambiente:

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `8000` | Porta HTTP (obrigatório em Render/Railway) |
| `HOST` | `0.0.0.0` | Bind do uvicorn |
| `SECRET_KEY` | gerado | Assinatura JWT (gere um de 32+ chars) |
| `DATABASE_PATH` | `backend/chat.db` | Caminho do SQLite |

### Para os amigos entrarem
Abra a porta 8000 do seu roteador (port forwarding pro IP local) e mande
`http://SEU-IP-INTERNOS:8000` — ou então hospede (Opção A) e mande a URL.

## 🧪 Testes

```bash
python test_ws.py      # WebSocket: presença, débito, heartbeat, tela (9 checks)
python test_flow.py    # E2E: SPA, login, débito, bloqueio no zero, recarga (8)
python test_perfil.py  # Perfil: registro, avatar, segurança de compra (8)
```

## 🐛 Histórico de bugs corrigidos

- Login/cadastro "presos" — React lia `localStorage` uma vez na montagem
  e nunca via a sessão nova *(causa do 'não deixa logar')*
- 404 em `/login` e `/register` — faltava fallback SPA no servidor
- Página "fica tudo cinza" ao clicar — seleção de texto global no tema escuro
- `purchase_tokens` aceitava `amount` **negativo** (dava pra roubar tokens)
- Débito de token não-atômico — saldo podia ficar negativo em corrida
- Conexões zumbi — ping parava e a presença do usuário ficava pra sempre
- `SECRET_KEY` fixo no código, porta fixa em 8000, banco relativo ao cwd
- Cadastro repetido sem dizer qual campo; agora explica e já entra na conta

## 📁 Estrutura

```
realtime-chat/
├── backend/
│   ├── main.py          # FastAPI: auth, chat WS, WebRTC relay, SPA
│   ├── config.py        # settings de ambiente + secret key persistente
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx      # rotas com leitura fresca de sessão
│       └── components/  # Login, Register, Home (chat+tela), ProfileModal
├── render.yaml          # deploy 1-clique no Render
├── Dockerfile
└── iniciar.bat          # atalho Windows
```

## 📜 Termos

Uso destinado a comunicação entre participantes que consentem; a transmissão
de tela só é visível aos membros da mesma sala. É um projeto próprio — **não**
usa código do Discord.