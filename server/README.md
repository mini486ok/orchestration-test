# Rail-Brain Gateway (서버 모드)

이 PC에서 실행되는 경량 게이트웨이 서버입니다. Python 3.11 **표준 라이브러리만** 사용하며,
① 중앙 계정·세션 관리, ② LLM 호출 쿼터 강제, ③ Ollama 프록시, ④ 공유 데이터 저장소를 제공합니다.

웹앱(GitHub Pages)이 이 게이트웨이를 통해 로그인·계정·쿼터·공유 데이터·LLM 호출을 처리합니다.
cloudflared 터널은 Ollama(11434)가 아니라 **게이트웨이(포트 8799)** 를 외부에 노출합니다.

명세: [`../docs/SPEC-GATEWAY.md`](../docs/SPEC-GATEWAY.md)

---

## 1. 요구 사항

- **Python 3.11 이상** (별도 패키지 설치 불필요 — 표준 라이브러리만 사용)
- **Ollama** 가 로컬(`http://localhost:11434`)에서 실행 중일 것
  - 모델: `exaone3.5:7.8b`(기본 채팅), `bge-m3:latest`(임베딩·RAG) 권장
- (외부 공유 시) **cloudflared** — [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) 설치

---

## 2. 실행

### 가장 쉬운 방법 (Windows)

```
server\start-gateway.bat
```

두 번 클릭하면 기본 포트 8799로 게이트웨이가 뜹니다. 시작 배너에서 포트·데이터 경로·계정 수·Ollama
연결 상태·터널 명령을 확인할 수 있습니다. 종료는 창에서 `Ctrl+C`.

### 직접 실행 / 옵션

```
python server/gateway.py [--port 8799] [--ollama http://localhost:11434] [--data server/data]
                         [--setup-token <SECRET>] [--embed-daily-limit 2000]
```

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--port` | `8799` | 수신 포트 |
| `--ollama` | `http://localhost:11434` | 프록시 대상 Ollama 주소 |
| `--data` | `server/data` | 계정·토큰·공유 데이터 저장 폴더 |
| `--setup-token` | (없음) | 최초 관리자 생성(`POST /auth/setup`) 보호 토큰. 지정 시 요청에 이 토큰이 있어야 함. **미지정 시 setup은 서버 로컬(loopback)에서만 허용**. 환경변수 `RBTL_SETUP_TOKEN` 로도 지정 가능 |
| `--embed-daily-limit` | `2000` | 계정별 **일일 임베딩 호출** 한도(계정 LLM 쿼터와 별개). 남용 방지용 |

`start-gateway.bat`에 옵션을 그대로 넘길 수도 있습니다: `start-gateway.bat --port 9000`

> **터널로 원격 공유 전 반드시 확인**: 아무 옵션 없이 실행하면 초기 설정은 **로컬에서만** 가능합니다(원격에서 첫 관리자 선점 불가). 터널 너머 원격에서 초기 설정을 해야 한다면 `--setup-token <비밀값>` 을 지정하고, 그 값을 아는 사람만 setup 하도록 하세요.

---

## 3. 외부 공유 (Cloudflare Tunnel)

게이트웨이를 인터넷에 노출하려면 **게이트웨이가 실행 중인 상태에서** 별도 창으로:

```
server\start-gateway-tunnel.bat
```

또는 직접:

```
cloudflared tunnel --url http://localhost:8799 --no-autoupdate
```

출력되는 `https://<무작위>.trycloudflare.com` 주소가 게이트웨이의 외부 주소입니다.

- 웹앱 **설정 → 중앙 게이트웨이(서버 모드)** 카드에 이 주소를 입력하거나,
- 팀원에게 `https://mini486ok.github.io/...#/?gateway=<터널주소>` 형태 링크로 공유하면
  웹앱이 자동으로 서버 모드로 전환됩니다.

> **보안 주의**
> - 터널 주소를 아는 사람은 누구나 **로그인 화면**에 접근할 수 있습니다(로그인 없이 데이터 접근은 불가).
>   주소는 **신뢰하는 팀원에게만** 공유하세요.
> - 아직 관리자 계정이 없는 상태로 터널을 열면 제3자가 먼저 관리자를 선점할 수 있습니다. 기본적으로
>   초기 설정은 **로컬에서만** 허용되며(원격 setup은 403), 원격 설정이 필요하면 `--setup-token` 을 쓰세요(§4).
>   가능하면 **터널을 열기 전에 로컬에서 먼저 관리자 계정을 만들어 두는 것**을 권장합니다.
> - `trycloudflare.com` 임시 터널은 실행할 때마다 주소가 바뀝니다. 고정 주소가 필요하면
>   명명된(named) 터널을 별도로 구성하세요.
> - 게이트웨이는 터널 뒤에 있다고 가정하므로 Host 헤더 검증을 하지 않습니다. 로컬 방화벽으로
>   8799 포트를 외부에 직접 노출하지 마세요(터널만 사용).

---

## 4. 최초 관리자 계정 생성

계정이 하나도 없을 때 **딱 한 번** 관리자를 만들 수 있습니다(`POST /auth/setup`). 계정이 이미 있으면 409.

> **초기 설정 선점 방지(중요)**
> 공개 터널에 노출된 게이트웨이는 아무나 먼저 `/auth/setup` 을 호출해 첫 관리자를 **선점**할 수 있으므로, 다음 규칙으로 보호합니다.
> - **`--setup-token` 미지정(기본)**: 초기 설정은 **서버 로컬(loopback, 127.0.0.1/::1)** 에서 온 요청만 허용합니다. 원격(터널 너머)에서의 setup은 `403` 으로 거부됩니다.
> - **`--setup-token <SECRET>` 지정**: 원격 포함 어디서든, 요청에 `X-Setup-Token: <SECRET>` 헤더(또는 body의 `setupToken`)가 일치해야만 허용하고, 불일치·누락 시 `403` 입니다.

### 방법 A — 웹앱에서 (권장, 로컬)

웹앱을 서버 모드로 연 뒤(설정에 게이트웨이 주소 입력 또는 `?gateway=` 링크 접속),
계정이 없으면 **초기 설정 화면**이 뜹니다. 관리자 아이디/비밀번호를 입력하면 생성됩니다.
게이트웨이와 같은 PC(로컬)에서 접속하면 별도 토큰 없이 생성됩니다.

### 방법 B — curl (터미널)

```bash
# 로컬에서 직접 (--setup-token 미지정 시: 로컬에서만 가능)
curl -X POST http://localhost:8799/auth/setup \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"secret123\"}"

# 원격/터널에서 설정하려면: 서버를 --setup-token 으로 띄운 뒤
curl -X POST https://<터널주소>/auth/setup \
  -H "Content-Type: application/json" \
  -H "X-Setup-Token: <SECRET>" \
  -d "{\"username\":\"admin\",\"password\":\"secret123\"}"
```

성공 시 `201`과 함께 `{ token, username, role, quota }` 를 반환합니다.

- 사용자명: **2~32자, 영문·숫자·`.`·`_`·`-`**
- 비밀번호: **6자 이상**

이후 관리자는 웹앱 설정(또는 `POST /admin/accounts`)에서 사용자 계정을 추가합니다.

---

## 5. 쿼터(일일 LLM 호출 한도) 관리

- 각 계정은 하루 `dailyLimit`회(기본 **200**)까지 `POST /llm/chat` 을 호출할 수 있습니다.
- `usedToday` 는 매일(UTC 기준 날짜 변경 시) 자동으로 0으로 리셋됩니다.
- 한도 소진 후 채팅 호출은 `429` + 안내 메시지로 거부됩니다. 응답 헤더 `X-Quota-Remaining` 으로
  남은 호출 수를 알 수 있습니다.
- 임베딩(`/llm/embed`), 모델 목록(`/llm/tags`), 버전(`/llm/version`)은 **채팅 쿼터를 소모하지 않습니다.**
  - 다만 임베딩은 남용 방지를 위해 **입력 개수(최대 64개)·총 문자 수(최대 200,000자)** 를 넘으면 `413`,
    **계정별 일일 임베딩 한도**(`--embed-daily-limit`, 기본 2000 — 채팅 쿼터와 별개)를 넘으면 `429`(+`Retry-After`)로 거부됩니다.

### 관리자가 한도 변경

웹앱 설정의 계정·쿼터 관리 테이블에서 변경하거나, 직접:

```bash
curl -X PUT http://localhost:8799/admin/accounts/user1/quota \
  -H "Authorization: Bearer <관리자토큰>" \
  -H "Content-Type: application/json" \
  -d "{\"dailyLimit\":500}"
```

---

## 6. 데이터 위치

모든 상태는 `--data`(기본 `server/data/`) 아래 JSON 파일로 저장됩니다.

```
server/data/
├─ accounts.json          # 계정 [{username, role, salt, hash, createdAt, quota}]
├─ tokens.json            # 세션 토큰 {token: {username, role, expiresAt}}
└─ shared/
   ├─ mcps.json           # 공유 MCP 서버   {updatedAt, updatedBy, items}
   ├─ strategies.json     # 공유 전략
   └─ benchmarks.json     # 공유 벤치마크 세트
```

- **`server/data/` 는 저장소에 커밋되지 않습니다**(`.gitignore` 처리됨). 비밀번호 해시·토큰이
  들어 있으므로 그대로 유지하고, 백업할 때도 접근 통제된 위치에 두세요.
- 비밀번호는 **PBKDF2-SHA256(15만회) 해시**로만 저장되며 평문은 저장·로그되지 않습니다.
- 토큰은 발급 후 **7일** 뒤 만료되고, 서버 시작 시 만료분이 정리됩니다.
- 실행 이력(runs)은 **공유되지 않으며** 각자 브라우저(localStorage)에만 남습니다.
- 공유 데이터 동시 편집은 **last-write-wins**(마지막 저장이 이깁니다).

### 초기화

게이트웨이를 끄고 `server/data/` 폴더를 삭제한 뒤 다시 실행하면 최초 상태(계정 0개)로 돌아갑니다.

---

## 7. 엔드포인트 요약

| 메서드/경로 | 인증 | 설명 |
|---|---|---|
| `GET /health` | — | 상태·계정 초기화 여부·Ollama 연결 |
| `POST /auth/setup` | 조건부 | 최초 관리자 생성(계정 0개일 때만). 로컬 전용 또는 `X-Setup-Token`(§4) |
| `POST /auth/login` | — | 로그인 → 토큰 발급 (실패 반복 시 `429`+`Retry-After`) |
| `POST /auth/logout` | ✔ | 토큰 폐기 |
| `GET /auth/me` | ✔ | 내 정보·쿼터 |
| `POST /auth/password` | ✔ | 비밀번호 변경 |
| `GET /admin/accounts` | admin | 계정 목록 |
| `POST /admin/accounts` | admin | 계정 생성 |
| `DELETE /admin/accounts/{username}` | admin | 계정 삭제 |
| `PUT /admin/accounts/{username}/quota` | admin | 한도 변경 |
| `POST /llm/chat` | ✔ | 채팅(쿼터 소모) |
| `POST /llm/embed` | ✔ | 임베딩(채팅 쿼터 무소모, 입력 64개·20만자·일일 한도 초과 시 413/429) |
| `GET /llm/tags` | ✔ | 모델 목록(쿼터 무소모) |
| `GET /llm/version` | ✔ | Ollama 버전(쿼터 무소모) |
| `GET /data/versions` | ✔ | 공유 데이터 최신 시각 |
| `GET /data/{key}` | ✔ | 공유 데이터 조회(mcps/strategies/benchmarks) |
| `PUT /data/{key}` | ✔ | 공유 데이터 저장 |

인증이 필요한 요청은 `Authorization: Bearer <token>` 헤더를 붙입니다. 모든 응답·오류는
UTF-8 JSON이며, 오류는 `{ "error": "한국어 메시지" }` 형태입니다.

---

## 8. 문제 해결

- **`Ollama [연결 안됨]`** — Ollama가 실행 중인지(`ollama serve`), `--ollama` 주소가 맞는지 확인.
  게이트웨이는 Ollama 없이도 뜨지만 LLM 관련 호출은 `502`로 실패합니다.
- **포트 충돌** — `--port` 로 다른 포트를 지정하세요.
- **계정을 잃어버림 / 처음부터** — 게이트웨이를 끄고 `server/data/` 삭제 후 재실행.
- **`한도를 모두 사용했습니다`(429)** — 관리자에게 `dailyLimit` 상향을 요청하거나 다음 날 리셋을 기다리세요.
- **초기 설정이 `403`** — 원격(터널)에서 `/auth/setup` 을 호출했는데 `--setup-token` 을 지정하지 않은 경우입니다.
  서버와 같은 PC(로컬)에서 설정하거나, 서버를 `--setup-token <SECRET>` 으로 띄우고 `X-Setup-Token` 헤더를 붙이세요.
- **로그인이 `429`(로그인 시도가 많습니다)** — 같은 사용자명+IP로 로그인을 여러 번 실패하면(6회째~) 잠시 차단됩니다.
  응답의 `Retry-After` 초 만큼 기다린 뒤 다시 시도하세요. 성공하면 즉시 해제됩니다.
- **임베딩이 `413`/`429`** — 한 번에 보내는 입력 개수/문자 수가 너무 많거나(413), 일일 임베딩 한도를 초과(429)한 경우입니다.
  입력을 나눠 보내거나 `--embed-daily-limit` 을 조정하세요.
