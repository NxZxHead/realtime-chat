"""Teste do sistema de perfil + mensagens com avatar no chat."""
import asyncio
import json
import urllib.request
import websockets

API = "http://localhost:8000"


def post(path, body, token=None):
    url = API + path + (f"?token={token}" if token else "")
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    return json.loads(urllib.request.urlopen(req).read())


def get(path, token=None):
    url = API + path + (f"?token={token}" if token else "")
    return json.loads(urllib.request.urlopen(url).read())


async def main():
    # 1) registra (tem que virar token automático) — id re-executável
    import uuid
    sufixo = uuid.uuid4().hex[:6]
    email_ok, user_ok = f"avatar-{sufixo}@test.com", f"robos{sufixo}"
    reg = post("/api/register", {
        "email": email_ok, "username": user_ok, "password": "123"})
    assert reg.get("access_token"), "registro deve devolver token"
    tok = reg["access_token"]
    print(f"[1] Registro com login automático ✓ ({reg['tokens_left']} tokens)")

    # 2) atualiza perfil com emoji e cor reais
    p = post("/api/profile", {
        "display_name": "Robô ★", "avatar_emoji": "🤖",
        "avatar_color": "#8b5cf6", "status": "dnd",
    }, token=tok)
    assert p["avatar"]["emoji"] == "🤖", p
    assert p["avatar"]["color"] == "#8b5cf6", p
    assert p["display_name"] == "Robô ★", p
    assert p["status"] == "dnd", p
    print("[2] Perfil salvo: Robô ★ 🤖 roxo ocupado ✓")

    # 3) releitura persiste
    g = get("/api/profile", token=tok)
    assert g["avatar"]["emoji"] == "🤖" and g["display_name"] == "Robô ★"
    print("[3] Perfil persiste no banco ✓")

    # 4) conflito de username explica o campo
    try:
        post("/api/register", {"email": "a@b.c", "username": user_ok, "password": "123"})
        raise AssertionError("devia dar 400")
    except urllib.error.HTTPError as e:
        det = json.loads(e.read())["detail"]
        assert "Username" in det or "Email" in det, det
        print(f"[4] Mensagem clara de conflito: \"{det}\" ✓")

    # 4b) segurança: amount negativo NÃO pode roubar tokens
    try:
        post("/api/purchase_tokens", {}, token=tok)  # amount default
        urllib.request.urlopen(urllib.request.Request(
            f"{API}/api/purchase_tokens?token={tok}&amount=-500", method="POST"))
        raise AssertionError("amount negativo foi aceito (bug de segurança!)")
    except urllib.error.HTTPError as e:
        det = json.loads(e.read())["detail"]
        assert "amount" in det, det
        print(f"[4b] amount negativo bloqueado: \"{det}\" ✓")

    # 5) avatar nas mensagens do WebSocket
    login = post("/api/login", {"email": email_ok, "password": "123"})
    salas = get("/api/rooms", token=tok) or []
    uri = f"ws://localhost:8000/ws/geral-285f?token={tok}"
    async with websockets.connect(uri, max_size=None) as ws:
        hist = json.loads(await ws.recv())
        print(f"[5] WS conectado, history={len(hist['messages'])} mensagens ✓")
        # presence com avatar
        for _ in range(5):
            m = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if m["type"] == "presence":
                meu = next((u for u in m["users"]
                            if u.get("display_name") == "Robô ★"), None)
                assert meu and meu["avatar"]["emoji"] == "🤖", m
                print(f"[6] Presence carrega avatar: {meu['display_name']} {meu['avatar']['emoji']} ✓")
                break
        # envia texto e confere avatar no broadcast
        await ws.send(json.dumps({"type": "text", "content": "mensagem com avatar!"}))
        for _ in range(10):
            m = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if m["type"] == "text":
                assert m["avatar"]["emoji"] == "🤖", m
                assert m["display_name"] == "Robô ★", m
                print(f"[7] Mensagem broadcast carrega {m['display_name']} {m['avatar']['emoji']} ✓")
                break

    print("\n✅ PERFIL COMPLETO: registro, avatar, status e chat OK!")


asyncio.run(main())