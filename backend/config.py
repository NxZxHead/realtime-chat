import os
from functools import lru_cache

from pydantic_settings import BaseSettings

# base desta pasta (backend/) — o banco fica sempre junto do código
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Settings(BaseSettings):
    # Autenticação -------------------------------------------------
    # vazio = gera e persiste em .secret_key no primeiro start (ou defina SECRET_KEY no ambiente)
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    # 7 dias: evita expulsar usuário que está conversando tranquilamente
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 7 * 24 * 60

    # Sistema de tokens --------------------------------------------
    FREE_TOKENS: int = 20
    MAX_PURCHASE: int = 1000  # teto por recarga (bug: antes aceitava amount negativo)

    # Servidor -------------------------------------------------------
    HOST: str = "0.0.0.0"
    PORT: int = 8000  # plataformas de deploy (Render/Railway) sobrescrevem com env PORT

    # CORS
    FRONTEND_URL: str = "http://localhost:3000"

    # Database (caminho absoluto — antes era relativo ao cwd e quebrava
    # se o app subisse de outra pasta, "perdendo" as contas)
    DATABASE_PATH: str = os.path.join(BASE_DIR, "chat.db")

    # WebRTC / STUN TURN
    TURN_SERVER: str = "turn:public.stun.twilio.com:3478"
    TURN_USERNAME: str = ""
    TURN_CREDENTIAL: str = ""

    class Config:
        env_file = os.path.join(BASE_DIR, ".env")
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def carregar_secret_key(s: Settings) -> str:
    """SECRET_KEY do ambiente, ou arquivo persistente, ou gera um novo."""
    if s.SECRET_KEY:
        return s.SECRET_KEY
    arquivo = os.path.join(BASE_DIR, ".secret_key")
    try:
        with open(arquivo, encoding="utf-8") as f:
            k = f.read().strip()
            if len(k) >= 32:
                return k
    except FileNotFoundError:
        pass
    import secrets
    k = secrets.token_urlsafe(48)
    with open(arquivo, "w", encoding="utf-8") as f:
        f.write(k)
    return k