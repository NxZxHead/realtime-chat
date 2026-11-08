"""RealTime Chat - backend FastAPI: auth, chat WebSocket, WebRTC relay."""
import os
import uuid
import json
import time
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Set, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
import bcrypt
import aiosqlite

from config import get_settings, Settings, carregar_secret_key

app = FastAPI(title="RealTime Chat", version="1.0.0")

settings = get_settings()
SECRET_KEY = carregar_secret_key(settings)

DB_PATH = settings.DATABASE_PATH
# room_id -> set de websockets conectados
active_sockets: dict[str, Set[WebSocket]] = {}
# Contagem de conectados por sala (para exibir membros)
room_presence: dict[str, dict[str, str]] = {}


# ---------------------------------------------------------------- helpers auth
def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: str, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "username": username, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[settings.ALGORITHM])


async def db() -> aiosqlite.Connection:
    """Abre uma conexão com row_factory pronto (via dependency)."""
    conn = await aiosqlite.connect(DB_PATH)
    conn.row_factory = aiosqlite.Row
    return conn


async def get_db() -> aiosqlite.Connection:
    conn = await db()
    try:
        yield conn
    finally:
        await conn.close()


def auth_query(token: str) -> str:
    """Valida token vindo da query string (?token=...). Retorna user_id."""
    try:
        payload = decode_token(token)
        return payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(status_code=401, detail="Token inválido")


def auth_ws(token: Optional[str]) -> dict:
    """Valida token de WebSocket. Retorna payload ou lança."""
    if not token:
        raise ValueError("token ausente")
    return decode_token(token)


# -------------------------------------------------------------------- init db
async def init_db():
    conn = await aiosqlite.connect(DB_PATH)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            tokens INTEGER DEFAULT 20,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            sender_username TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            type TEXT DEFAULT 'text'
        )""")
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            short_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_msg_room ON messages(room_id, timestamp)")

    # migração: colunas de perfil (avatar, nome de exibição, status)
    cur = await conn.execute("PRAGMA table_info(users)")
    cols = {r[1] for r in await cur.fetchall()}
    novos = [
        ("display_name", "TEXT"),
        ("avatar_color", "TEXT DEFAULT '#5865F2'"),
        ("avatar_emoji", "TEXT DEFAULT '🙂'"),
        ("status", "TEXT DEFAULT 'online'"),
    ]
    for nome, decl in novos:
        if nome not in cols:
            await conn.execute(f"ALTER TABLE users ADD COLUMN {nome} {decl}")
    await conn.commit()
    await conn.close()
    print(f"[db] inicializado em {DB_PATH}")


# ---------------------------------------------------------------------- CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------- REST API
@app.on_event("startup")
async def startup():
    await init_db()


@app.post("/api/register")
async def register(body: dict, conn: aiosqlite.Connection = Depends(get_db)):
    email, username, password = body.get("email"), body.get("username"), body.get("password")
    if not email or not username or not password:
        raise HTTPException(status_code=400, detail="Campos email, username e password são obrigatórios")
    async with conn.execute("SELECT id FROM users WHERE email = ?", (email,)) as cur:
        existe_email = bool(await cur.fetchone())
    async with conn.execute("SELECT id FROM users WHERE username = ?", (username,)) as cur:
        existe_user = bool(await cur.fetchone())
    if existe_email or existe_user:
        qual = "Email" if existe_email else "Username"
        raise HTTPException(
            status_code=400,
            detail=f"{qual} já está em uso — tente outro{' (o username pode já ter sido testado)' if existe_user else ''}.",
        )
    user_id = str(uuid.uuid4())
    await conn.execute(
        "INSERT INTO users (id, email, username, password, tokens) VALUES (?, ?, ?, ?, ?)",
        (user_id, email, username, get_password_hash(password), settings.FREE_TOKENS),
    )
    await conn.commit()
    # entrega token de acesso junto — a tela pode entrar direto
    access = create_access_token(user_id, username)
    return {
        "message": "Usuário criado com sucesso",
        "user_id": user_id,
        "access_token": access,
        "tokens_left": settings.FREE_TOKENS,
    }


@app.post("/api/login")
async def login(body: dict, conn: aiosqlite.Connection = Depends(get_db)):
    email, password = body.get("email"), body.get("password")
    async with conn.execute("SELECT * FROM users WHERE email = ?", (email,)) as cur:
        row = await cur.fetchone()
    if not row or not verify_password(password, row["password"]):
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    token = create_access_token(row["id"], row["username"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "tokens_left": row["tokens"],
        "user_id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"] or row["username"],
        "avatar": {
            "color": row["avatar_color"] or "#5865F2",
            "emoji": row["avatar_emoji"] or "🙂",
        },
        "status": row["status"] or "online",
    }


@app.get("/api/tokens")
async def get_tokens(token: str, conn: aiosqlite.Connection = Depends(get_db)):
    user_id = auth_query(token)
    async with conn.execute("SELECT tokens, username FROM users WHERE id = ?", (user_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return {"tokens_left": row["tokens"], "username": row["username"], "user_id": user_id}


@app.post("/api/purchase_tokens")
async def purchase_tokens(token: str, amount: int = 5, conn: aiosqlite.Connection = Depends(get_db)):
    """Adiciona tokens (stub: em produção integraria Stripe/PayPal).

    Bug corrigido: antes aceitava amount negativo — dava pra ENVIAR tokens
    pro servidor (roubá-los de si mesmo) ou valores absurdos.
    """
    if amount < 1 or amount > settings.MAX_PURCHASE:
        raise HTTPException(
            status_code=400,
            detail=f"amount deve estar entre 1 e {settings.MAX_PURCHASE}",
        )
    user_id = auth_query(token)
    await conn.execute("UPDATE users SET tokens = tokens + ? WHERE id = ?", (amount, user_id))
    await conn.commit()
    return {"message": f"{amount} tokens adicionados", "amount": amount}


# ---------------------------------------------------------------- perfil
async def ler_perfil(user_id: str) -> dict:
    """Lê o perfil completo do usuário; dict vazio se não existir."""
    conn = await aiosqlite.connect(DB_PATH)
    conn.row_factory = aiosqlite.Row
    async with conn.execute(
        "SELECT username, display_name, avatar_color, avatar_emoji, status, tokens "
        "FROM users WHERE id = ?", (user_id,)
    ) as cur:
        row = await cur.fetchone()
    await conn.close()
    if not row:
        return {}
    return {
        "username": row["username"],
        "display_name": row["display_name"] or row["username"],
        "avatar": {
            "color": row["avatar_color"] or "#5865F2",
            "emoji": row["avatar_emoji"] or "🙂",
        },
        "status": row["status"] or "online",
        "tokens_left": row["tokens"],
    }


@app.get("/api/profile")
async def get_profile(token: str, conn: aiosqlite.Connection = Depends(get_db)):
    user_id = auth_query(token)
    perfil = await ler_perfil(user_id)
    if not perfil:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return perfil | {"user_id": user_id}


@app.post("/api/profile")
async def update_profile(body: dict, token: str,
                         conn: aiosqlite.Connection = Depends(get_db)):
    user_id = auth_query(token)
    campos = {}
    if isinstance(body.get("display_name"), str) and 1 <= len(body["display_name"]) <= 40:
        campos["display_name"] = body["display_name"].strip()[:40] or None
    if isinstance(body.get("avatar_color"), str) and body["avatar_color"][:1] == "#":
        campos["avatar_color"] = body["avatar_color"].lower()[:7]
    if isinstance(body.get("avatar_emoji"), str) and 1 <= len(body["avatar_emoji"]) <= 8:
        campos["avatar_emoji"] = body["avatar_emoji"][:8]
    if body.get("status") in ("online", "idle", "dnd", "invisible"):
        campos["status"] = body["status"]
    if not campos:
        raise HTTPException(status_code=400, detail="Nada válido para atualizar")
    sets = ", ".join(f"{k} = ?" for k in campos)
    await conn.execute(f"UPDATE users SET {sets} WHERE id = ?", (*campos.values(), user_id))
    await conn.commit()
    perfil = await ler_perfil(user_id)
    return perfil | {"user_id": user_id, "updated": list(campos.keys())}


# -------------------------------------------------------------- salas (rooms)
@app.get("/api/rooms")
async def list_rooms(token: str, conn: aiosqlite.Connection = Depends(get_db)):
    auth_query(token)
    async with conn.execute("SELECT * FROM rooms ORDER BY created_at DESC") as cur:
        rows = await cur.fetchall()
    return [
        {
            "id": r["id"],
            "room_id": r["short_id"],
            "name": r["name"],
            "description": r["description"],
            "users": len(room_presence.get(r["short_id"], {})),
        }
        for r in rows
    ]


@app.post("/api/rooms")
async def create_room(body: dict, token: str, conn: aiosqlite.Connection = Depends(get_db)):
    auth_query(token)
    name = (body.get("name") or "Nova sala").strip()
    room_id = name.lower().replace(" ", "-").replace("_", "-")[:24] or "sala"
    # evita colisão
    short_id = f"{room_id}-{uuid.uuid4().hex[:4]}"
    room_pk = str(uuid.uuid4())
    await conn.execute(
        "INSERT INTO rooms (id, short_id, name, description) VALUES (?, ?, ?, ?)",
        (room_pk, short_id, name, body.get("description") or ""),
    )
    await conn.commit()
    return {"id": room_pk, "room_id": short_id, "name": name, "description": body.get("description"), "users": 0}


@app.get("/api/ice-servers")
async def ice_servers():
    return {
        "iceServers": [
            {"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}
        ]
    }


# ------------------------------------------------------------ broadcast helper
async def broadcast(room_id: str, payload: dict, exclude: Optional[WebSocket] = None):
    data = json.dumps(payload, default=str)
    for ws in list(active_sockets.get(room_id, set())):
        if ws is exclude:
            continue
        try:
            await ws.send_text(data)
        except Exception:
            active_sockets.get(room_id, set()).discard(ws)


async def save_message(msg_id: str, room_id: str, sender_id: str, sender_username: str,
                       content: str, type_: str, ts: datetime):
    conn = await aiosqlite.connect(DB_PATH)
    await conn.execute(
        "INSERT INTO messages (id, room_id, sender_id, sender_username, content, timestamp, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (msg_id, room_id, sender_id, sender_username, content, ts.isoformat(), type_),
    )
    await conn.commit()
    await conn.close()


async def try_consume_token(user_id: str) -> int:
    """Debita 1 token se houver saldo — ATÔMICO (uma única corrida de UPDATE
    com guarda `tokens > 0`; o esquema antigo lia e depois gravava e podia
    deixar saldo negativo ou duplar débito em mensagens simultâneas).
    Retorna o saldo restante, 0 se sem saldo, -1 se usuário não existe."""
    conn = await aiosqlite.connect(DB_PATH)
    cur = await conn.execute(
        "UPDATE users SET tokens = tokens - 1 WHERE id = ? AND tokens > 0", (user_id,))
    afetados = cur.rowcount
    await conn.commit()
    if afetados == 0:
        async with conn.execute("SELECT tokens FROM users WHERE id = ?", (user_id,)) as cur2:
            row = await cur2.fetchone()
        await conn.close()
        return -1 if row is None else 0
    async with conn.execute(
        "SELECT tokens FROM users WHERE id = ?", (user_id,)) as cur2:
        row = await cur2.fetchone()
    await conn.close()
    return row[0]


# ------------------------------------------------------------------ WebSocket
@app.websocket("/ws/{room_id}")
async def ws_chat(websocket: WebSocket, room_id: str, token: Optional[str] = None):
    try:
        payload = auth_ws(token)
        user_id = payload["sub"]
        username = payload.get("username", "Usuário")
    except Exception:
        await websocket.close(code=4401, reason="Token inválido")
        return

    await websocket.accept()
    active_sockets.setdefault(room_id, set()).add(websocket)
    perfil = await ler_perfil(user_id) or {
        "username": username, "display_name": username,
        "avatar": {"color": "#5865F2", "emoji": "🙂"}, "status": "online",
    }
    room_presence.setdefault(room_id, {})[user_id] = perfil

    # envia histórico
    conn = await aiosqlite.connect(DB_PATH)
    conn.row_factory = aiosqlite.Row
    async with conn.execute(
        "SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp ASC LIMIT 200", (room_id,)
    ) as cur:
        history = [dict(r) for r in await cur.fetchall()]
    await conn.close()
    await websocket.send_text(json.dumps({"type": "history", "messages": history}, default=str))

    # lista de presentes atualizada para todos (inclusive o que acabou de entrar)
    await broadcast(room_id, {
        "type": "presence",
        "users": list(room_presence[room_id].values()),
        "count": len(room_presence[room_id]),
    })

    # anúncia entrada
    join_msg = {
        "type": "system",
        "id": str(uuid.uuid4()),
        "room_id": room_id,
        "sender_id": "system",
        "sender_username": "Sistema",
        "content": f"{perfil.get('display_name', username)} entrou na sala",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "avatar": perfil.get("avatar"),
    }
    await broadcast(room_id, join_msg)

    alive = True
    # última atividade vista deste cliente (bug antigo: `last` nunca era
    # atualizado → o ping parava e a conexão zumbi ficava presa pra sempre,
    # mantendo o usuário "fantasma" na lista de membros)
    atv = {"t": time.monotonic()}

    async def heartbeat():
        """Ping a cada 30s; derruba a conexão se o cliente ficar 2 min mudo."""
        while alive:
            await asyncio.sleep(30)
            try:
                await websocket.send_text(json.dumps(
                    {"type": "ping", "timestamp": int(time.time() * 1000)}))
                if time.monotonic() - atv["t"] > 120:
                    await websocket.close(code=4408, reason="Sem atividade")
                    break
            except Exception:
                break

    hb = asyncio.create_task(heartbeat())

    try:
        while True:
            raw = await websocket.receive_text()
            atv["t"] = time.monotonic()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"error": "JSON inválido"}))
                continue

            mtype = data.get("type")

            if mtype == "ping":
                await websocket.send_text(json.dumps(
                    {"type": "pong", "timestamp": data.get("timestamp")}))
                continue

            if mtype == "pong":
                continue

            if mtype in ("text", "screen_start", "screen_stop"):
                content = (data.get("content") or "").strip()
                if mtype == "text":
                    if not content:
                        continue
                    if len(content) > 2000:
                        await websocket.send_text(json.dumps({"error": "Mensagem muito longa"}))
                        continue
                    left = await try_consume_token(user_id)
                    if left <= 0:
                        await websocket.send_text(json.dumps({
                            "type": "error_tokens",
                            "error": "Você ficou sem tokens! Peça ou compre mais tokens.",
                        }))
                        continue
                    await websocket.send_text(json.dumps({"type": "tokens_update", "tokens_left": max(left, 0)}))

                ts = datetime.now(timezone.utc)
                msg = {
                    "type": mtype,
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender_id": user_id,
                    "sender_username": username,
                    "display_name": perfil.get("display_name", username),
                    "avatar": perfil.get("avatar"),
                    "content": content or
                        ("Iniciou a transmissão de tela 🖥️" if mtype == "screen_start"
                         else "Parou a transmissão de tela"),
                    "timestamp": ts.isoformat(),
                }
                await broadcast(room_id, msg)
                await save_message(msg["id"], room_id, user_id, username, msg["content"], mtype, ts)
                continue

            # demais tipos de sinalização WebRTC retransmitem na mesma sala
            if mtype in ("screen_init", "screen_offer", "screen_answer", "screen_candidate",
                         "screen_join", "audio_offer", "audio_answer", "audio_candidate"):
                await broadcast(room_id, data, exclude=websocket)
                continue

            await websocket.send_text(json.dumps({"error": f"Tipo desconhecido: {mtype}"}))

    except WebSocketDisconnect:
        pass
    finally:
        alive = False
        hb.cancel()
        active_sockets.get(room_id, set()).discard(websocket)
        presence = room_presence.get(room_id, {})
        presence.pop(user_id, None)
        await broadcast(room_id, {
            "type": "system",
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender_id": "system",
            "sender_username": "Sistema",
            "content": f"{perfil.get('display_name', username)} saiu da sala",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        await broadcast(room_id, {"type": "presence",
                                  "users": list(presence.values()),
                                  "count": len(presence)})


# ------------------------------------------------------------------ frontend
frontend_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
if os.path.isdir(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/", response_class=HTMLResponse)
    async def index():
        with open(os.path.join(frontend_dist, "index.html"), encoding="utf-8") as f:
            return f.read()

    @app.get("/{full_path:path}", response_class=HTMLResponse, include_in_schema=False)
    async def spa_fallback(full_path: str):
        """Fallback SPA: /login, /register etc. servem o index.html do React.

        Permite recarregar (F5) em qualquer rota sem dar 404.
        Arquivos reais (ex.: build assets não casados no mount) são servidos direto.
        """
        # deixa /api e /ws com erro normal (404/405) em vez de HTML
        if full_path.startswith(("api/", "ws/", "docs", "openapi")) or full_path == "docs":
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not Found")
        target = os.path.normpath(os.path.join(frontend_dist, full_path))
        if (not target.startswith(os.path.normpath(frontend_dist) + os.sep)
                and target != os.path.normpath(frontend_dist)):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not Found")
        if (not full_path.startswith("..") and os.path.isfile(target)
                and not target.endswith(".html")):
            from fastapi.responses import FileResponse
            return FileResponse(target)
        with open(os.path.join(frontend_dist, "index.html"), encoding="utf-8") as f:
            return HTMLResponse(f.read())


if __name__ == "__main__":
    import uvicorn
    # PORT/HOST vêm do ambiente (Render, Railway, Fly etc. exigem que se
    # escute na porta que eles informam — codigo fixo em 8000 não subia lá)
    uvicorn.run(
        app,
        host=settings.HOST,
        port=settings.PORT,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )