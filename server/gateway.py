#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rail-Brain Gateway — 서버 모드 게이트웨이 (Python 3.11, 표준 라이브러리만 사용)

① 중앙 계정·세션 관리  ② LLM 호출 쿼터 강제  ③ Ollama 프록시  ④ 공유 데이터 저장소

실행:
    python server/gateway.py [--port 8799] [--ollama http://localhost:11434] [--data server/data]

명세: docs/SPEC-GATEWAY.md §1
"""

import argparse
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ------------------------------------------------------------------------- 상수

APP_NAME = "rail-brain-gateway"
APP_VERSION = "1.0.0"

PBKDF2_ITERATIONS = 150_000        # PBKDF2-SHA256 15만회
DEFAULT_DAILY_LIMIT = 200          # 기본 일일 LLM 호출 한도
TOKEN_TTL_DAYS = 7                 # 토큰 만료: 발급 + 7일
MAX_BODY = 6 * 1024 * 1024         # (인증 후) 요청 본문 최대 6MB
PRE_AUTH_MAX_BODY = 64 * 1024      # 인증 전/공개 엔드포인트 본문 상한 64KB (무인증 대용량 본문 DoS 완화)
MAX_DATA = 5 * 1024 * 1024         # 공유 데이터(items) 최대 5MB
OLLAMA_TIMEOUT = 300               # /llm/chat 등 프록시 타임아웃(초)
OLLAMA_PROBE_TIMEOUT = 3           # health용 Ollama 연결 확인 타임아웃(초)

# 로그인 rate limit (username+client IP 기준 지수 백오프)
LOGIN_FAIL_THRESHOLD = 5           # 최근 실패 5회까지는 401, 초과(6회째~) 시 429
LOGIN_BACKOFF_BASE = 5             # 최초 백오프 초 (이후 2배씩 증가)
LOGIN_BACKOFF_MAX = 300            # 최대 백오프 5분
LOGIN_ATTEMPT_TTL = 3600           # 마지막 접근 후 1시간 지난 항목은 정리(메모리 누수 방지)

# /llm/embed 남용 제한
EMBED_MAX_INPUTS = 64              # input 배열 최대 개수
EMBED_MAX_CHARS = 200_000          # input 총 문자 수 상한
DEFAULT_EMBED_DAILY_LIMIT = 2000   # 계정별 일일 임베딩 호출 한도(계정 LLM 쿼터와 분리)

USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{2,32}$")     # 2~32자 영숫자 . _ -

DATA_KEYS = ("mcps", "strategies", "benchmarks")

# CORS 허용 오리진: https://mini486ok.github.io, http://localhost:*, http://127.0.0.1:*
GITHUB_ORIGIN = "https://mini486ok.github.io"
LOCALHOST_RE = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")

# 파일 쓰기 직렬화용 전역 락 (읽기-수정-쓰기 전체를 감쌈)
LOCK = threading.Lock()

# 로그인 rate limit 인메모리 카운터: {(username, ip): {"fails", "until", "seen"}}
LOGIN_ATTEMPTS = {}
LOGIN_RATE_LOCK = threading.Lock()

# 일일 임베딩 카운터(계정 쿼터와 분리): {username: {"dateKey", "used"}}
EMBED_COUNTS = {}
EMBED_LOCK = threading.Lock()

# argparse 후 main()에서 설정되는 전역 상태
OLLAMA_URL = "http://localhost:11434"
DATA_DIR = ""
SHARED_DIR = ""
ACCOUNTS_FILE = ""
TOKENS_FILE = ""
SETUP_TOKEN = None                 # --setup-token / RBTL_SETUP_TOKEN (None이면 loopback 전용)
EMBED_DAILY_LIMIT = DEFAULT_EMBED_DAILY_LIMIT


# ------------------------------------------------------------------- 시간 헬퍼

def now_utc():
    return datetime.now(timezone.utc)


def now_iso():
    return now_utc().isoformat()


def today_key():
    return now_utc().strftime("%Y-%m-%d")


def is_expired(iso_str):
    """토큰 만료 여부 — ISO 문자열을 파싱해 현재와 비교."""
    if not iso_str:
        return True
    try:
        return datetime.fromisoformat(iso_str) <= now_utc()
    except ValueError:
        return True


# ------------------------------------------------------------- 비밀번호 헬퍼

def hash_password(password, salt_hex):
    salt = bytes.fromhex(salt_hex)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return dk.hex()


def verify_password(password, salt_hex, hash_hex):
    try:
        return hmac.compare_digest(hash_password(password, salt_hex), hash_hex)
    except (ValueError, TypeError):
        return False


# ------------------------------------------------------------- 파일 I/O 헬퍼

def _atomic_write(path, obj):
    """임시 파일에 쓰고 os.replace 로 원자적 교체 (Windows 안전)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (ValueError, OSError):
        return default


def load_accounts():
    data = _load_json(ACCOUNTS_FILE, [])
    return data if isinstance(data, list) else []


def save_accounts(accounts):
    _atomic_write(ACCOUNTS_FILE, accounts)


def load_tokens():
    data = _load_json(TOKENS_FILE, {})
    return data if isinstance(data, dict) else {}


def save_tokens(tokens):
    _atomic_write(TOKENS_FILE, tokens)


def load_shared(key):
    return _load_json(os.path.join(SHARED_DIR, key + ".json"), None)


def save_shared(key, obj):
    _atomic_write(os.path.join(SHARED_DIR, key + ".json"), obj)


# ----------------------------------------------------------------- 계정 헬퍼

def find_account(accounts, username):
    for acc in accounts:
        if acc.get("username") == username:
            return acc
    return None


def new_account(username, role, password, daily_limit):
    salt = secrets.token_hex(16)
    return {
        "username": username,
        "role": role,
        "salt": salt,
        "hash": hash_password(password, salt),
        "createdAt": now_iso(),
        "quota": {
            "dailyLimit": daily_limit,
            "usedToday": 0,
            "dateKey": today_key(),
        },
    }


def apply_quota_reset(acc):
    """dateKey 가 오늘과 다르면 usedToday=0 으로 리셋. 변경되면 True."""
    q = acc.get("quota") or {}
    if q.get("dateKey") != today_key():
        q["usedToday"] = 0
        q["dateKey"] = today_key()
        acc["quota"] = q
        return True
    return False


def quota_view(q):
    daily = int(q.get("dailyLimit", 0))
    used = int(q.get("usedToday", 0))
    return {
        "dailyLimit": daily,
        "usedToday": used,
        "remaining": max(0, daily - used),
        "dateKey": q.get("dateKey"),
    }


def account_public(acc):
    return {
        "username": acc["username"],
        "role": acc["role"],
        "createdAt": acc.get("createdAt"),
        "quota": quota_view(acc.get("quota") or {}),
    }


def issue_token(username, role):
    """토큰 발급 + 만료분 정리. (락 안에서 호출)"""
    token = secrets.token_hex(32)
    expires = (now_utc() + timedelta(days=TOKEN_TTL_DAYS)).isoformat()
    tokens = load_tokens()
    tokens = {t: v for t, v in tokens.items() if not is_expired(v.get("expiresAt"))}
    tokens[token] = {"username": username, "role": role, "expiresAt": expires}
    save_tokens(tokens)
    return token, expires


# ----------------------------------------------------------------- CORS 헬퍼

def is_origin_allowed(origin):
    if origin == GITHUB_ORIGIN:
        return True
    return bool(LOCALHOST_RE.match(origin or ""))


# ------------------------------------------------- 보안 헬퍼 (setup / rate / embed)

def is_loopback_addr(ip):
    """client_address[0] 이 loopback(127.0.0.0/8, ::1, ::ffff:127.x) 인지."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None:
        addr = mapped
    return addr.is_loopback


def _seconds_until_utc_midnight():
    """다음 UTC 자정까지 남은 초(일일 카운터 리셋 시점)."""
    now = now_utc()
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


def _prune_login_attempts(now):
    """오래된 로그인 시도 항목 정리 (호출자가 LOGIN_RATE_LOCK 보유)."""
    stale = [k for k, v in LOGIN_ATTEMPTS.items()
             if v.get("until", 0) <= now and now - v.get("seen", 0) > LOGIN_ATTEMPT_TTL]
    for k in stale:
        LOGIN_ATTEMPTS.pop(k, None)


def login_rate_check(key):
    """현재 백오프 중이면 Retry-After(초) 반환, 아니면 None."""
    now = time.time()
    with LOGIN_RATE_LOCK:
        _prune_login_attempts(now)
        entry = LOGIN_ATTEMPTS.get(key)
        if entry and entry.get("until", 0) > now:
            entry["seen"] = now
            return max(1, int(math.ceil(entry["until"] - now)))
    return None


def login_rate_fail(key):
    """로그인 실패 1건 기록. 임계 초과 시 지수 백오프 설정 후 Retry-After 반환, 아니면 None."""
    now = time.time()
    with LOGIN_RATE_LOCK:
        entry = LOGIN_ATTEMPTS.get(key)
        if entry is None:
            entry = {"fails": 0, "until": 0.0, "seen": now}
            LOGIN_ATTEMPTS[key] = entry
        entry["fails"] += 1
        entry["seen"] = now
        if entry["fails"] > LOGIN_FAIL_THRESHOLD:
            over = entry["fails"] - LOGIN_FAIL_THRESHOLD          # 1, 2, 3, ...
            backoff = min(LOGIN_BACKOFF_MAX, LOGIN_BACKOFF_BASE * (2 ** (over - 1)))
            entry["until"] = now + backoff
            return max(1, int(math.ceil(backoff)))
    return None


def login_rate_reset(key):
    """로그인 성공 시 카운터 제거."""
    with LOGIN_RATE_LOCK:
        LOGIN_ATTEMPTS.pop(key, None)


def _prune_embed_counts(today):
    """다른 날짜의 임베딩 카운터 정리 (호출자가 EMBED_LOCK 보유)."""
    stale = [u for u, v in EMBED_COUNTS.items() if v.get("dateKey") != today]
    for u in stale:
        EMBED_COUNTS.pop(u, None)


def embed_daily_check_and_inc(username):
    """일일 임베딩 카운터 증가. 한도 초과 시 Retry-After(초) 반환, 통과 시 None."""
    today = today_key()
    with EMBED_LOCK:
        entry = EMBED_COUNTS.get(username)
        if entry is None or entry.get("dateKey") != today:
            entry = {"dateKey": today, "used": 0}
            EMBED_COUNTS[username] = entry
        _prune_embed_counts(today)
        if entry["used"] >= EMBED_DAILY_LIMIT:
            return _seconds_until_utc_midnight()
        entry["used"] += 1
    return None


# --------------------------------------------------------------- Ollama 프록시

class OllamaUnavailable(Exception):
    pass


def ollama_request(method, path, body_bytes=None, timeout=OLLAMA_TIMEOUT):
    """Ollama 로 프록시. (status, raw_bytes) 반환. 연결 실패 시 OllamaUnavailable."""
    url = OLLAMA_URL + path
    req = urllib.request.Request(url, data=body_bytes, method=method)
    if body_bytes is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        # Ollama 자체가 4xx/5xx 를 준 경우 — 응답 그대로 전달
        return e.code, e.read()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise OllamaUnavailable(str(e))


def ollama_alive():
    try:
        status, _ = ollama_request("GET", "/api/version", None, OLLAMA_PROBE_TIMEOUT)
        return 200 <= status < 300
    except Exception:
        return False


# ----------------------------------------------------------------- 핸들러

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "RailBrainGateway/" + APP_VERSION

    # BaseHTTPRequestHandler 의 기본 stderr 로깅 억제 (커스텀 _log 사용)
    def log_message(self, fmt, *args):
        pass

    # ------------------------------------------------------ 응답 헬퍼

    def _cors_headers(self):
        origin = self.headers.get("Origin")
        if origin and is_origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Setup-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "X-Quota-Remaining")

    def _send_json(self, status, obj, extra=None):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if extra:
            for k, v in extra.items():
                self.send_header(k, str(v))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)
        self._status = status
        self._responded = True

    def _send_raw(self, status, raw, extra=None):
        """Ollama 응답 raw 바이트를 그대로 전달."""
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        if extra:
            for k, v in extra.items():
                self.send_header(k, str(v))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)
        self._status = status
        self._responded = True

    def _send_no_content(self, status=204):
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()
        self._status = status
        self._responded = True

    # ------------------------------------------------------ 본문 파싱

    def _read_json(self, max_body=MAX_BODY):
        """본문을 읽어 JSON 파싱. 오류 시 응답을 보내고 None 반환."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send_json(400, {"error": "Content-Length 헤더가 올바르지 않습니다."})
            return None
        if length < 0:
            self._send_json(400, {"error": "Content-Length 헤더가 올바르지 않습니다."})
            return None
        if length > max_body:
            # 본문을 읽지 않고 연결 종료 (소켓 정합성)
            self.close_connection = True
            msg = ("요청 본문이 너무 큽니다(최대 6MB)."
                   if max_body >= MAX_BODY else "요청 본문이 너무 큽니다.")
            self._send_json(413, {"error": msg})
            return None
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": "JSON 형식이 올바르지 않습니다."})
            return None

    def _drain_body(self, limit=MAX_BODY):
        """GET/DELETE 등에서 본문이 딸려오면 소켓에서 최소 소비. 상한 초과 시 연결 종료."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > 0:
            if length > limit:
                self.close_connection = True
                return
            self.rfile.read(length)

    # ------------------------------------------------------ 인증

    def _authenticate(self):
        """Bearer 토큰 검증. 실패 시 401 응답 후 None 반환.
        디스패치 단계에서 이미 인증되어 캐시되어 있으면 재검증 없이 반환."""
        if getattr(self, "_auth_info", None) is not None:
            return self._auth_info
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            self._send_json(401, {"error": "인증이 필요합니다."})
            return None
        token = auth[len("Bearer "):].strip()
        with LOCK:
            tokens = load_tokens()
            info = tokens.get(token)
            if info is None:
                self._send_json(401, {"error": "인증이 필요합니다."})
                return None
            if is_expired(info.get("expiresAt")):
                tokens.pop(token, None)
                save_tokens(tokens)
                self._send_json(401, {"error": "세션이 만료되었습니다. 다시 로그인하세요."})
                return None
        self._auth_user = info["username"]
        self._auth_token = token
        self._auth_info = info
        return info

    def _require_admin(self):
        info = self._authenticate()
        if info is None:
            return None
        if info.get("role") != "admin":
            self._send_json(403, {"error": "관리자 권한이 필요합니다."})
            return None
        return info

    # ------------------------------------------------------ 메서드 진입점

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_OPTIONS(self):
        self._auth_user = None
        self._auth_info = None
        self._status = None
        self._responded = False
        self.send_response(204)
        self._cors_headers()
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()
        self._status = 204
        self._log()

    # ------------------------------------------------------ 디스패치

    @staticmethod
    def _route_protection(method, segs):
        """엔드포인트 보호 등급 판정: None=공개, 'user'=인증 필요, 'admin'=관리자 필요.
        본문을 읽기 전에 인증을 먼저 수행하기 위한 사전 분류(무인증 대용량 본문 DoS 완화)."""
        if not segs:
            return None
        head = segs[0]
        if head == "admin":
            return "admin"
        if head in ("llm", "data"):
            return "user"
        if head == "auth":
            sub = segs[1] if len(segs) > 1 else ""
            if sub in ("logout", "me", "password"):
                return "user"
            return None            # setup / login 은 공개
        return None                # health 등

    def _dispatch(self, method):
        self._auth_user = None
        self._auth_token = None
        self._auth_info = None
        self._status = None
        self._responded = False
        try:
            path = urllib.parse.urlparse(self.path).path
            if len(path) > 1 and path.endswith("/"):
                path = path[:-1]
            segs = [urllib.parse.unquote(s) for s in path.split("/") if s]

            # 인증 우선: 보호 엔드포인트는 본문을 읽기 전에 토큰을 검증한다.
            protection = self._route_protection(method, segs)
            if protection is not None:
                info = self._authenticate()
                if info is None:                       # 401 이미 응답됨
                    self._drain_body(PRE_AUTH_MAX_BODY) # 대용량 본문은 읽지 않고 연결 종료
                    self._log()
                    return
                if protection == "admin" and info.get("role") != "admin":
                    self._send_json(403, {"error": "관리자 권한이 필요합니다."})
                    self._drain_body(PRE_AUTH_MAX_BODY)
                    self._log()
                    return

            body = None
            if method in ("POST", "PUT"):
                # 인증 통과한 보호 엔드포인트만 6MB 허용, 그 외(공개)는 64KB 상한
                max_body = MAX_BODY if protection is not None else PRE_AUTH_MAX_BODY
                body = self._read_json(max_body)
                if self._responded:  # 413/400 이미 응답됨
                    self._log()
                    return
            else:
                self._drain_body()

            self._route(method, segs, body)
        except (BrokenPipeError, ConnectionResetError):
            self._status = "conn-reset"
        except Exception as e:  # noqa: BLE001 — 최후의 방어
            if not self._responded:
                try:
                    self._send_json(500, {"error": "서버 내부 오류가 발생했습니다."})
                except Exception:
                    pass
            self._status = 500
            print(f"[ERROR] {method} {self.path}: {e}", flush=True)
        self._log()

    def _route(self, method, segs, body):
        n = len(segs)

        if method == "GET" and segs == ["health"]:
            return self._h_health()

        if segs == ["auth", "setup"] and method == "POST":
            return self._h_setup(body)
        if segs == ["auth", "login"] and method == "POST":
            return self._h_login(body)
        if segs == ["auth", "logout"] and method == "POST":
            return self._h_logout()
        if segs == ["auth", "me"] and method == "GET":
            return self._h_me()
        if segs == ["auth", "password"] and method == "POST":
            return self._h_password(body)

        if segs == ["admin", "accounts"]:
            if method == "GET":
                return self._h_admin_list()
            if method == "POST":
                return self._h_admin_create(body)
        if n == 3 and segs[0] == "admin" and segs[1] == "accounts" and method == "DELETE":
            return self._h_admin_delete(segs[2])
        if (n == 4 and segs[0] == "admin" and segs[1] == "accounts"
                and segs[3] == "quota" and method == "PUT"):
            return self._h_admin_quota(segs[2], body)

        if segs == ["llm", "chat"] and method == "POST":
            return self._h_chat(body)
        if segs == ["llm", "embed"] and method == "POST":
            return self._h_embed(body)
        if segs == ["llm", "tags"] and method == "GET":
            return self._h_proxy_get("/api/tags")
        if segs == ["llm", "version"] and method == "GET":
            return self._h_proxy_get("/api/version")

        if segs == ["data", "versions"] and method == "GET":
            return self._h_data_versions()
        if n == 2 and segs[0] == "data":
            key = segs[1]
            if key not in DATA_KEYS:
                return self._send_json(404, {"error": "알 수 없는 데이터 키입니다."})
            if method == "GET":
                return self._h_data_get(key)
            if method == "PUT":
                return self._h_data_put(key, body)

        return self._send_json(404, {"error": "존재하지 않는 경로입니다."})

    # ------------------------------------------------------ health

    def _h_health(self):
        with LOCK:
            accounts = load_accounts()
        client_ip = self.client_address[0] if self.client_address else ""
        self._send_json(200, {
            "ok": True,
            "app": APP_NAME,
            "version": APP_VERSION,
            "accountsInitialized": len(accounts) > 0,
            "ollama": ollama_alive(),
            # 최초 관리자 생성 화면이 '초기 설정 토큰' 입력 필드를 보여줄지 결정하는 데 사용.
            # 터널 뒤에서는 클라이언트 IP가 loopback으로 보여 loopback 제한이 무력화되므로,
            # 원격(터널)에서 안전하게 초기 설정을 하려면 --setup-token 사용이 필요하다.
            "setupTokenRequired": bool(SETUP_TOKEN),
        })

    # ------------------------------------------------------ auth

    def _setup_allowed(self, body):
        """초기 설정(/auth/setup) 요청 허용 여부. 거부 시 403 응답 후 False.
        - --setup-token 지정 시: X-Setup-Token 헤더(또는 body.setupToken)가 일치해야 허용.
        - 미지정 시: loopback(127.0.0.1/::1)에서 온 요청만 허용."""
        if SETUP_TOKEN:
            provided = self.headers.get("X-Setup-Token")
            if not provided and isinstance(body, dict):
                provided = body.get("setupToken")
            if not provided or not hmac.compare_digest(str(provided), SETUP_TOKEN):
                self._send_json(403, {"error": "초기 설정 토큰이 필요합니다. 올바른 X-Setup-Token 헤더(또는 setupToken)를 제공하세요."})
                return False
            return True
        client_ip = self.client_address[0] if self.client_address else ""
        if not is_loopback_addr(client_ip):
            self._send_json(403, {"error": "초기 설정은 서버 로컬에서만 가능합니다. --setup-token 옵션으로 원격 설정을 허용하세요."})
            return False
        return True

    def _h_setup(self, body):
        if not self._setup_allowed(body):
            return
        if not isinstance(body, dict):
            return self._send_json(400, {"error": "요청 본문이 올바르지 않습니다."})
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        with LOCK:
            accounts = load_accounts()
            if len(accounts) > 0:
                return self._send_json(409, {"error": "이미 초기 설정이 완료되었습니다."})
            if not USERNAME_RE.match(username):
                return self._send_json(400, {"error": "사용자명은 2~32자의 영문·숫자·. _ - 만 허용됩니다."})
            if len(password) < 6:
                return self._send_json(400, {"error": "비밀번호는 6자 이상이어야 합니다."})
            acc = new_account(username, "admin", password, DEFAULT_DAILY_LIMIT)
            accounts.append(acc)
            save_accounts(accounts)
            token, _ = issue_token(username, "admin")
        self._send_json(201, {
            "token": token,
            "username": username,
            "role": "admin",
            "quota": quota_view(acc["quota"]),
        })

    def _h_login(self, body):
        if not isinstance(body, dict):
            return self._send_json(400, {"error": "요청 본문이 올바르지 않습니다."})
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        client_ip = self.client_address[0] if self.client_address else "-"
        key = (username, client_ip)

        # 1) rate limit 선검사 — 백오프 중이면 비밀번호 검증 없이 429
        retry_after = login_rate_check(key)
        if retry_after is not None:
            return self._send_json(
                429,
                {"error": "로그인 시도가 많습니다. 잠시 후 다시 시도하세요."},
                {"Retry-After": str(retry_after)},
            )

        # 2) 자격 검증
        with LOCK:
            accounts = load_accounts()
            acc = find_account(accounts, username)
            ok = acc is not None and verify_password(password, acc["salt"], acc["hash"])
            if ok:
                if apply_quota_reset(acc):
                    save_accounts(accounts)
                token, _ = issue_token(username, acc["role"])

        # 3) 실패 시 카운터 증가(임계 초과면 429), 성공 시 리셋
        if not ok:
            retry_after = login_rate_fail(key)
            if retry_after is not None:
                return self._send_json(
                    429,
                    {"error": "로그인 시도가 많습니다. 잠시 후 다시 시도하세요."},
                    {"Retry-After": str(retry_after)},
                )
            return self._send_json(401, {"error": "사용자명 또는 비밀번호가 올바르지 않습니다."})

        login_rate_reset(key)
        self._send_json(200, {
            "token": token,
            "username": username,
            "role": acc["role"],
            "quota": quota_view(acc["quota"]),
        })

    def _h_logout(self):
        info = self._authenticate()
        if info is None:
            return
        with LOCK:
            tokens = load_tokens()
            tokens.pop(self._auth_token, None)
            save_tokens(tokens)
        self._send_no_content(204)

    def _h_me(self):
        info = self._authenticate()
        if info is None:
            return
        with LOCK:
            accounts = load_accounts()
            acc = find_account(accounts, info["username"])
            if acc is None:
                return self._send_json(401, {"error": "계정을 찾을 수 없습니다."})
            if apply_quota_reset(acc):
                save_accounts(accounts)
            result = {
                "username": acc["username"],
                "role": acc["role"],
                "quota": quota_view(acc["quota"]),
            }
        self._send_json(200, result)

    def _h_password(self, body):
        info = self._authenticate()
        if info is None:
            return
        if not isinstance(body, dict):
            return self._send_json(400, {"error": "요청 본문이 올바르지 않습니다."})
        current = body.get("currentPassword") or ""
        new_pw = body.get("newPassword") or ""
        if len(new_pw) < 6:
            return self._send_json(400, {"error": "새 비밀번호는 6자 이상이어야 합니다."})
        with LOCK:
            accounts = load_accounts()
            acc = find_account(accounts, info["username"])
            if acc is None:
                return self._send_json(401, {"error": "계정을 찾을 수 없습니다."})
            if not verify_password(current, acc["salt"], acc["hash"]):
                return self._send_json(401, {"error": "현재 비밀번호가 올바르지 않습니다."})
            salt = secrets.token_hex(16)
            acc["salt"] = salt
            acc["hash"] = hash_password(new_pw, salt)
            save_accounts(accounts)
        self._send_no_content(204)

    # ------------------------------------------------------ admin

    def _h_admin_list(self):
        info = self._require_admin()
        if info is None:
            return
        with LOCK:
            accounts = load_accounts()
            changed = False
            for acc in accounts:
                if apply_quota_reset(acc):
                    changed = True
            if changed:
                save_accounts(accounts)
            out = [account_public(a) for a in accounts]
        self._send_json(200, {"accounts": out})

    def _h_admin_create(self, body):
        info = self._require_admin()
        if info is None:
            return
        if not isinstance(body, dict):
            return self._send_json(400, {"error": "요청 본문이 올바르지 않습니다."})
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        role = body.get("role") or "user"
        daily = body.get("dailyLimit", DEFAULT_DAILY_LIMIT)
        if not USERNAME_RE.match(username):
            return self._send_json(400, {"error": "사용자명은 2~32자의 영문·숫자·. _ - 만 허용됩니다."})
        if role not in ("admin", "user"):
            return self._send_json(400, {"error": "역할은 admin 또는 user 여야 합니다."})
        if len(password) < 6:
            return self._send_json(400, {"error": "비밀번호는 6자 이상이어야 합니다."})
        if not isinstance(daily, int) or isinstance(daily, bool) or daily < 0:
            return self._send_json(400, {"error": "dailyLimit은 0 이상의 정수여야 합니다."})
        with LOCK:
            accounts = load_accounts()
            if find_account(accounts, username) is not None:
                return self._send_json(409, {"error": "이미 존재하는 사용자명입니다."})
            acc = new_account(username, role, password, daily)
            accounts.append(acc)
            save_accounts(accounts)
            result = account_public(acc)
        self._send_json(201, result)

    def _h_admin_delete(self, username):
        info = self._require_admin()
        if info is None:
            return
        with LOCK:
            accounts = load_accounts()
            acc = find_account(accounts, username)
            if acc is None:
                return self._send_json(404, {"error": "계정을 찾을 수 없습니다."})
            admin_count = sum(1 for a in accounts if a.get("role") == "admin")
            if acc.get("role") == "admin" and admin_count <= 1:
                return self._send_json(409, {"error": "마지막 관리자 계정은 삭제할 수 없습니다."})
            if username == info["username"]:
                return self._send_json(409, {"error": "본인 계정은 삭제할 수 없습니다."})
            accounts = [a for a in accounts if a.get("username") != username]
            save_accounts(accounts)
            tokens = load_tokens()
            tokens = {t: v for t, v in tokens.items() if v.get("username") != username}
            save_tokens(tokens)
        self._send_no_content(204)

    def _h_admin_quota(self, username, body):
        info = self._require_admin()
        if info is None:
            return
        if not isinstance(body, dict):
            return self._send_json(400, {"error": "요청 본문이 올바르지 않습니다."})
        daily = body.get("dailyLimit")
        if not isinstance(daily, int) or isinstance(daily, bool) or daily < 0:
            return self._send_json(400, {"error": "dailyLimit은 0 이상의 정수여야 합니다."})
        with LOCK:
            accounts = load_accounts()
            acc = find_account(accounts, username)
            if acc is None:
                return self._send_json(404, {"error": "계정을 찾을 수 없습니다."})
            apply_quota_reset(acc)
            acc["quota"]["dailyLimit"] = daily
            save_accounts(accounts)
            result = quota_view(acc["quota"])
        self._send_json(200, {"quota": result})

    # ------------------------------------------------------ llm 프록시

    def _h_chat(self, body):
        info = self._authenticate()
        if info is None:
            return
        if not isinstance(body, dict):
            return self._send_json(400, {"error": "요청 본문이 올바르지 않습니다."})

        # 쿼터 예약 (락 안에서 read-modify-write)
        with LOCK:
            accounts = load_accounts()
            acc = find_account(accounts, info["username"])
            if acc is None:
                return self._send_json(401, {"error": "계정을 찾을 수 없습니다."})
            apply_quota_reset(acc)
            q = acc["quota"]
            remaining = q["dailyLimit"] - q["usedToday"]
            if remaining <= 0:
                save_accounts(accounts)
                return self._send_json(
                    429,
                    {"error": "오늘의 LLM 호출 한도를 모두 사용했습니다(남은 호출 0). 관리자에게 한도 상향을 요청하세요."},
                    {"X-Quota-Remaining": "0"},
                )
            q["usedToday"] += 1
            remaining_after = q["dailyLimit"] - q["usedToday"]
            save_accounts(accounts)

        # Ollama 호출 (락 밖 — 느린 I/O). 성공/실패 무관 쿼터는 이미 소모됨.
        body["stream"] = False
        try:
            payload = json.dumps(body).encode("utf-8")
            status, raw = ollama_request("POST", "/api/chat", payload, OLLAMA_TIMEOUT)
        except OllamaUnavailable:
            return self._send_json(
                502,
                {"error": "LLM 서버(Ollama)에 연결할 수 없습니다."},
                {"X-Quota-Remaining": str(remaining_after)},
            )
        self._send_raw(status, raw, {"X-Quota-Remaining": str(remaining_after)})

    def _h_embed(self, body):
        info = self._authenticate()
        if info is None:
            return
        if not isinstance(body, dict):
            return self._send_json(400, {"error": "요청 본문이 올바르지 않습니다."})

        # 남용 제한: input 개수·총 문자 수 상한
        inp = body.get("input")
        if isinstance(inp, str):
            items = [inp]
        elif isinstance(inp, list):
            items = inp
        else:
            items = []
        if len(items) > EMBED_MAX_INPUTS:
            return self._send_json(413, {"error": "임베딩 입력 개수가 너무 많습니다(최대 64개)."})
        total_chars = sum(len(x) for x in items if isinstance(x, str))
        if total_chars > EMBED_MAX_CHARS:
            return self._send_json(413, {"error": "임베딩 입력 문자 수가 너무 많습니다(최대 200,000자)."})

        # 일일 임베딩 카운터(계정 LLM 쿼터와 분리)
        retry_after = embed_daily_check_and_inc(info["username"])
        if retry_after is not None:
            return self._send_json(
                429,
                {"error": "오늘의 임베딩 호출 한도를 모두 사용했습니다. 잠시 후 다시 시도하세요."},
                {"Retry-After": str(retry_after)},
            )

        try:
            payload = json.dumps(body).encode("utf-8")
            status, raw = ollama_request("POST", "/api/embed", payload, OLLAMA_TIMEOUT)
        except OllamaUnavailable:
            return self._send_json(502, {"error": "LLM 서버(Ollama)에 연결할 수 없습니다."})
        self._send_raw(status, raw)

    def _h_proxy_get(self, ollama_path):
        info = self._authenticate()
        if info is None:
            return
        try:
            status, raw = ollama_request("GET", ollama_path, None, OLLAMA_PROBE_TIMEOUT * 10)
        except OllamaUnavailable:
            return self._send_json(502, {"error": "LLM 서버(Ollama)에 연결할 수 없습니다."})
        self._send_raw(status, raw)

    # ------------------------------------------------------ data (공유 저장소)

    def _h_data_versions(self):
        info = self._authenticate()
        if info is None:
            return
        with LOCK:
            result = {}
            for key in DATA_KEYS:
                d = load_shared(key)
                result[key] = d.get("updatedAt") if isinstance(d, dict) else None
        self._send_json(200, result)

    def _h_data_get(self, key):
        info = self._authenticate()
        if info is None:
            return
        with LOCK:
            d = load_shared(key)
        if isinstance(d, dict):
            self._send_json(200, {
                "updatedAt": d.get("updatedAt"),
                "updatedBy": d.get("updatedBy"),
                "items": d.get("items"),
            })
        else:
            self._send_json(200, {"updatedAt": None, "updatedBy": None, "items": None})

    def _h_data_put(self, key, body):
        info = self._authenticate()
        if info is None:
            return
        if not isinstance(body, dict):
            return self._send_json(400, {"error": "요청 본문이 올바르지 않습니다."})
        items = body.get("items")
        if not isinstance(items, list):
            return self._send_json(400, {"error": "items는 배열이어야 합니다."})
        serialized = json.dumps(items, ensure_ascii=False).encode("utf-8")
        if len(serialized) > MAX_DATA:
            return self._send_json(413, {"error": "데이터 크기가 5MB를 초과합니다."})
        updated = now_iso()
        with LOCK:
            save_shared(key, {
                "updatedAt": updated,
                "updatedBy": info["username"],
                "items": items,
            })
        self._send_json(200, {"updatedAt": updated})

    # ------------------------------------------------------ 로깅

    def _log(self):
        user = getattr(self, "_auth_user", None) or "-"
        status = getattr(self, "_status", None) or "-"
        ts = now_utc().strftime("%H:%M:%S")
        # self.path 에는 쿼리스트링만 포함, 본문(비밀번호)은 절대 출력하지 않음
        print(f"[{ts}] {user} {self.command} {self.path} {status}", flush=True)


# ------------------------------------------------------------------- main

def cleanup_expired_tokens():
    with LOCK:
        tokens = load_tokens()
        cleaned = {t: v for t, v in tokens.items() if not is_expired(v.get("expiresAt"))}
        if len(cleaned) != len(tokens):
            save_tokens(cleaned)


def print_banner(port, account_count, ollama_ok):
    line = "=" * 60
    print(line, flush=True)
    print(f"  Rail-Brain Gateway  v{APP_VERSION}", flush=True)
    print(line, flush=True)
    print(f"  포트         : {port}", flush=True)
    print(f"  데이터 경로  : {DATA_DIR}", flush=True)
    init_note = "" if account_count > 0 else "  (초기 설정 필요)"
    print(f"  계정 수      : {account_count}{init_note}", flush=True)
    ollama_state = "연결됨" if ollama_ok else "연결 안됨"
    print(f"  Ollama       : {OLLAMA_URL}  [{ollama_state}]", flush=True)
    if SETUP_TOKEN:
        setup_mode = "토큰 필요 (X-Setup-Token 헤더 또는 body.setupToken)"
    else:
        setup_mode = "로컬(loopback) 전용 — 원격 허용하려면 --setup-token"
    print(f"  초기설정     : {setup_mode}", flush=True)
    print(f"  임베딩 한도  : {EMBED_DAILY_LIMIT}/일 (계정 LLM 쿼터와 분리)", flush=True)
    print(f"  터널 명령    : cloudflared tunnel --url http://localhost:{port}", flush=True)
    print(line, flush=True)
    if account_count == 0:
        print("  * 웹앱 서버모드 초기설정 화면에서 관리자 계정을 생성하세요.", flush=True)
        if SETUP_TOKEN:
            print("", flush=True)
            print("  ┌─ 최초 관리자 생성용 초기 설정 토큰 ─────────────────┐", flush=True)
            print(f"     {SETUP_TOKEN}", flush=True)
            print("  └────────────────────────────────────────────────────┘", flush=True)
            print("  초기설정 화면의 '초기 설정 토큰'란에 위 값을 입력하세요.", flush=True)
    print("  * 종료: Ctrl+C", flush=True)
    print(line, flush=True)


def main():
    global OLLAMA_URL, DATA_DIR, SHARED_DIR, ACCOUNTS_FILE, TOKENS_FILE
    global SETUP_TOKEN, EMBED_DAILY_LIMIT

    # 배너·로그의 한글이 파일 리다이렉트/파이프에서도 깨지지 않도록 UTF-8 고정
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="Rail-Brain Gateway 서버")
    parser.add_argument("--port", type=int, default=8799, help="수신 포트 (기본 8799)")
    parser.add_argument("--ollama", default="http://localhost:11434",
                        help="Ollama 주소 (기본 http://localhost:11434)")
    parser.add_argument("--data", default=os.path.join(here, "data"),
                        help="데이터 디렉토리 (기본 server/data)")
    parser.add_argument("--setup-token", default=os.environ.get("RBTL_SETUP_TOKEN"),
                        help="초기 설정(/auth/setup) 보호 토큰. 지정 시 X-Setup-Token 헤더(또는 "
                             "body.setupToken) 일치 필요. 미지정 시 loopback에서만 setup 허용 "
                             "(환경변수 RBTL_SETUP_TOKEN 로도 지정 가능)")
    parser.add_argument("--embed-daily-limit", type=int, default=DEFAULT_EMBED_DAILY_LIMIT,
                        help=f"계정별 일일 임베딩 호출 한도 (계정 LLM 쿼터와 분리, 기본 {DEFAULT_EMBED_DAILY_LIMIT})")
    args = parser.parse_args()

    OLLAMA_URL = args.ollama.rstrip("/")
    DATA_DIR = os.path.abspath(args.data)
    SHARED_DIR = os.path.join(DATA_DIR, "shared")
    ACCOUNTS_FILE = os.path.join(DATA_DIR, "accounts.json")
    TOKENS_FILE = os.path.join(DATA_DIR, "tokens.json")
    SETUP_TOKEN = args.setup_token or None
    EMBED_DAILY_LIMIT = args.embed_daily_limit
    os.makedirs(SHARED_DIR, exist_ok=True)

    cleanup_expired_tokens()

    with LOCK:
        accounts = load_accounts()
    ollama_ok = ollama_alive()
    print_banner(args.port, len(accounts), ollama_ok)

    try:
        server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    except OSError as e:
        # 대표적으로 포트가 이미 사용 중(WinError 10048 / EADDRINUSE)인 경우
        print("", flush=True)
        print("=" * 60, flush=True)
        print(f"  [오류] 포트 {args.port} 에서 서버를 시작할 수 없습니다.", flush=True)
        print(f"  사유: {e}", flush=True)
        print("  대부분 게이트웨이가 이미 실행 중일 때 발생합니다.", flush=True)
        print("   - 실행 중인 다른 게이트웨이 창을 먼저 닫거나,", flush=True)
        print(f"   - 다른 포트로 실행하세요:  start-gateway.bat --port 8800", flush=True)
        print("=" * 60, flush=True)
        try:
            input("\n계속하려면 Enter 키를 누르세요...")
        except EOFError:
            pass
        return
    server.daemon_threads = True
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n게이트웨이를 종료합니다.", flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
