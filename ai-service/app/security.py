import secrets
from typing import Optional
from .config import AI_SERVICE_API_KEY, IS_PRODUCTION

def check_token(token: Optional[str]) -> bool:
    if not AI_SERVICE_API_KEY:
        # In strict production mode, API key is mandatory
        if IS_PRODUCTION:
            return False
        return True
    if not token:
        return False
    return secrets.compare_digest(token, AI_SERVICE_API_KEY)

try:
    from fastapi import Security, HTTPException, status
    from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials

    api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
    bearer_auth = HTTPBearer(auto_error=False)

    def verify_api_key(
        api_key: Optional[str] = Security(api_key_header),
        credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_auth)
    ) -> bool:
        if not AI_SERVICE_API_KEY:
            return True

        token = api_key or (credentials.credentials if credentials else None)
        if not check_token(token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing AI Service API Key (provide via X-API-Key header or Bearer token)",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return True

except Exception:
    def verify_api_key(request) -> bool:
        if not AI_SERVICE_API_KEY:
            return True
        key = request.headers.get("x-api-key")
        auth = request.headers.get("authorization")
        bearer = auth[7:] if (auth and auth.startswith("Bearer ")) else None
        token = key or bearer
        return check_token(token)
