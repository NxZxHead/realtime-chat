"""Teste E2E: HTML servido, histórico, presence, tokens, chat."""
import asyncio
import json
import urllib.request
import websockets

API = "http://localhost:8000"


def post(path, body):
    req = urllib.request.Request(
        API + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    return json.loads(urllib.request.urlopen(req).read())


async def recv_until(ws, want_types):
    """Recebe mensagens até encontrar uma dos tipos desejados."""
    while True:
        m = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        if m["type"] in want_types:
            return m


async def main():
    # 1) página HTML do frontend
    html = urllib.request.urlopen(API + "/").read().decode()
    assert '<div id="root">' in html, "index.html não servida"
    print("[1] Frontend HTML servido em http://localhost:8000 ✓")

    # 2) login + garante saldo mínimo p/ teste
    login = post("/api/login", {"email": "nxzx@chat.com", "password": "123456"})
    token = login["access_token"]
    if login["tokens_left"] < 25:
        urllib.request.urlopen(urllib.request.Request(
            f"{API}/api/purchase_tokens?token={token}&amount=30", method="POST"))
        login = post("/api/login", {"email": "nxzx@chat.com", "password": "123456"})
        token = login["access_token"]
    print(f"[2] Login OK (tokens={login['tokens_left']}) ✓")

    # 3) websocket
    uri = f"ws://localhost:8000/ws/geral-285f?token={token}"
    async with websockets.connect(uri, max_size=None) as ws:
        hist = json.loads(await ws.recv())
        assert hist["type"] == "history", f"esperava history, veio {hist['type']}"
        print(f"[3] History com {len(hist['messages'])} mensagens ✓")

        presence = await recv_until(ws, ("presence",))
        system = await recv_until(ws, ("system",))
        print(f"[4] Presence ({presence['count']} online) + anúncio: {system['content']} ✓")

        # 4) mensagem -> tokens_update pessoal + broadcast da sala
        saldo = login["tokens_left"]
        await ws.send(json.dumps({"type": "text", "content": "Mensagem 1 ✅"}))
        upd = await recv_until(ws, ("tokens_update", "error_tokens"))
        if upd["type"] == "error_tokens":
            raise AssertionError(f"sem saldo suficiente: {upd}")
        assert upd["tokens_left"] == saldo - 1, f"débito falhou: {upd}"
        msg = await recv_until(ws, ("text",))
        assert msg["content"] == "Mensagem 1 ✅", f"conteúdo errado: {msg}"
        print(f"[5] Mensagem entregue, saldo {saldo} → {upd['tokens_left']} ✓")

        # 6) consome tudo até o servidor bloquear por saldo zerado
        aceitas = 0
        while True:
            await ws.send(json.dumps({"type": "text", "content": f"m{aceitas}"}))
            m = await recv_until(ws, ("text", "error_tokens"))
            if m["type"] == "error_tokens":
                print(f"[6] Bloqueio por saldo zerado catalogado após {aceitas} mensagens ✓")
                break
            aceitas += 1
            if aceitas > 100:
                raise AssertionError("nunca zerou os tokens (possível bug de débito)")

    # 6) saldo final no servidor
    req = urllib.request.Request(f"{API}/api/tokens?token={token}")
    final = json.loads(urllib.request.urlopen(req).read())
    assert final["tokens_left"] == 0, f"esperava 0, veio {final['tokens_left']}"
    print(f"[7] Saldo final confirmado no servidor: 0 tokens ✓")

    # 8) recarga de tokens (stub de compra)
    req = urllib.request.Request(f"{API}/api/purchase_tokens?token={token}&amount=10", method="POST")
    recarga = json.loads(urllib.request.urlopen(req).read())
    final2 = json.loads(urllib.request.urlopen(f"{API}/api/tokens?token={token}").read())
    assert final2["tokens_left"] == 10, f"recarga falhou: {final2}"
    print(f"[8] Recarga simulada: +10 → saldo {final2['tokens_left']} ✓")

    print("\n✅ TESTE E2E COMPLETO: backend e frontend prontos!")


asyncio.run(main())