"""Teste automatizado do WebSocket do chat (tolerante à ordem de eventos)."""
import asyncio
import json
import urllib.request
import websockets

API = "http://localhost:8000"
ROOM = "geral-285f"


def post(path, body):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req).read())


async def recv_until(ws, tipos):
    """Recebe até achar uma mensagem de um dos tipos (ordem livre)."""
    vistos = []
    while True:
        m = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        vistos.append(m.get("type"))
        if m.get("type") in tipos:
            return m, vistos


async def main():
    login = post("/api/login", {"email": "nxzx@chat.com", "password": "123456"})
    token = login["access_token"]
    print(f"[1] Login OK, tokens={login['tokens_left']}")

    uri = f"ws://localhost:8000/ws/{ROOM}?token={token}"
    async with websockets.connect(uri, max_size=None) as ws:
        hist = json.loads(await ws.recv())
        assert hist["type"] == "history"
        print(f"[2] Conectado. history com {len(hist.get('messages', []))} mensagens")

        pres, _ = await recv_until(ws, ("presence",))
        print(f"[3] Presence: {pres['count']} online, primeiro = "
              f"{pres['users'][0].get('display_name')} ✓")

        sysm, _ = await recv_until(ws, ("system",))
        print(f"[4] Anúncio: {sysm['content']}")

        # envia mensagem de texto
        await ws.send(json.dumps({"type": "text", "content": "Olá, mundo! 🎉"}))
        upd, _ = await recv_until(ws, ("tokens_update", "error_tokens"))
        assert upd["type"] == "tokens_update"
        print(f"[5] Débito: saldo → {upd['tokens_left']}")

        msg, _ = await recv_until(ws, ("text",))
        assert msg["content"] == "Olá, mundo! 🎉", msg
        print(f"[6] Broadcast: {msg.get('display_name')}: {msg['content']}"
              f" avatar={msg.get('avatar', {}).get('emoji')}")

        # ping/pong
        await ws.send(json.dumps({"type": "ping", "timestamp": 12345}))
        p, _ = await recv_until(ws, ("pong",))
        assert p["timestamp"] == 12345
        print(f"[7] Heartbeat: pong ok")

        # screen start
        await ws.send(json.dumps({"type": "screen_start", "content": ""}))
        s, _ = await recv_until(ws, ("screen_start", "error"))
        print(f"[8] Tela: {s['content']}")

    req = urllib.request.Request(f"{API}/api/tokens?token={token}")
    tokens = json.loads(urllib.request.urlopen(req).read())
    print(f"[9] Tokens restantes: {tokens['tokens_left']}")
    assert tokens["tokens_left"] == login["tokens_left"] - 1
    print("\n✅ TESTE WS COMPLETO: tudo funcionando!")


asyncio.run(main())