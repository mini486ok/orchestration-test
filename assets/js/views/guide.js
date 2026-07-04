// 사용 가이드 — 플랫폼 개요, 사용 순서, Ollama 연결 설정
import { el } from '../core/ui.js';

const SECTIONS = [
  {
    title: '🎯 이 플랫폼은 무엇인가요?',
    html: `
      <p><b>Rail-Brain Test Lab</b>은 철도·교통 분야의 MCP(Model Context Protocol) 서버 기반
      <b>오케스트레이션 기술을 개발하고 검증</b>하기 위한 테스트 플랫폼입니다.</p>
      <ul>
        <li><b>MCP 카탈로그</b> — 테스트용 MCP 서버(description, input/output schema)를 등록·조회·삭제합니다. 실제 서버 없이 스키마 기반 모의(Mock) 실행이 이뤄집니다.</li>
        <li><b>오케스트레이션 스튜디오</b> — 프롬프트 엔지니어링, 스킬 정의, 룰 기반 워크플로우 3가지 방식으로 전략을 설계합니다.</li>
        <li><b>벤치마크 랩</b> — LLM 자동 생성 또는 수동 작성으로 "질의 → 정답 워크플로우" 벤치마크를 만듭니다.</li>
        <li><b>평가·비교</b> — 여러 전략을 같은 벤치마크로 실행해 정확도·속도를 정량 비교하고 시각화합니다.</li>
      </ul>`,
  },
  {
    title: '🚀 권장 사용 순서',
    html: `
      <ol>
        <li><b>설정</b>에서 Ollama 연결을 확인하고 기본 모델을 선택합니다. (기본값: exaone3.5:7.8b)</li>
        <li><b>MCP 카탈로그</b>에서 기본 제공되는 30개 샘플 MCP를 살펴보고, 필요하면 직접 만들거나 AI로 생성합니다.</li>
        <li><b>오케스트레이션</b>에서 전략을 만들고 테스트 콘솔에서 단건 질의로 동작을 확인합니다.</li>
        <li><b>벤치마크</b>에서 자동(LLM) 또는 수동으로 평가 세트를 만듭니다. 자동 생성 결과는 반드시 검토·수정하세요.</li>
        <li><b>평가·비교</b>에서 벤치마크 세트 + 전략 여러 개를 선택해 실행하고 결과를 비교합니다.</li>
      </ol>`,
  },
  {
    title: '🔌 Ollama 연결 설정 (중요)',
    html: `
      <p>이 앱은 브라우저에서 직접 로컬 Ollama(<code>http://localhost:11434</code>)를 호출합니다.
      GitHub Pages(https)에서 접속하는 경우 Ollama가 교차 출처 요청을 허용하도록 <b>OLLAMA_ORIGINS</b> 환경변수 설정이 필요합니다.</p>
      <p><b>Windows (PowerShell, 영구 설정):</b></p>
      <pre><code>[System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
# 설정 후 작업표시줄 트레이에서 Ollama 종료 → 다시 실행</code></pre>
      <p>특정 출처만 허용하려면 <code>*</code> 대신 <code>https://mini486ok.github.io</code> 를 지정하세요.</p>
      <p><b>연결 확인:</b> 설정 화면의 "저장 후 연결 테스트" 버튼 또는 사이드바 하단의 상태 표시등을 확인하세요.</p>
      <p><b>Chrome "로컬 네트워크 액세스" 권한 (중요):</b> 최신 Chrome은 공개 사이트(https)가 localhost 등
      로컬 네트워크에 접근할 때 별도 권한을 요구합니다. 연결이 계속 실패하면 다음을 확인하세요.</p>
      <ol>
        <li>첫 연결 시도 시 <b>권한 프롬프트</b>가 뜨면 "허용"을 클릭합니다.</li>
        <li>프롬프트가 없었다면: 주소창 왼쪽 <b>자물쇠(사이트 정보) → 사이트 설정 → "로컬 네트워크 액세스"를 허용</b>으로 변경 후 새로고침.</li>
        <li>회사 관리 PC는 보안 정책/에이전트가 로컬 접근을 차단할 수 있습니다. 이 경우 아래 "로컬 실행"을 사용하세요.</li>
      </ol>
      <p><b>로컬 실행 (권한 문제가 있을 때의 확실한 대안):</b> 로컬에서 열면 localhost → localhost 통신이라 위 제약이 전혀 없습니다.</p>
      <pre><code>git clone https://github.com/mini486ok/orchestration-test.git
cd orchestration-test
python -m http.server 8000
# 브라우저에서 http://localhost:8000 접속</code></pre>
      <ul>
        <li>이 페이지를 <b>Ollama가 설치된 PC에서 열어야</b> 합니다. (브라우저 → localhost 호출 구조)</li>
        <li>다른 PC의 Ollama를 쓰려면 설정에서 주소를 바꿀 수 있으나, https 페이지에서 http 사설 IP 호출은 브라우저가 차단할 수 있습니다(mixed content). 이 경우 로컬 실행을 권장합니다.</li>
      </ul>`,
  },
  {
    title: '🧠 오케스트레이션 전략 3가지',
    html: `
      <ul>
        <li><b>프롬프트 엔지니어링</b> — 시스템 프롬프트를 직접 설계합니다. <code>{{TOOL_CATALOG}}</code>(등록된 도구 목록), <code>{{QUERY}}</code>(사용자 질의), <code>{{DATE}}</code> 플레이스홀더를 지원합니다.
        실행 모드는 <b>플랜 우선</b>(한 번에 전체 계획 수립 후 실행)과 <b>ReAct</b>(단계마다 결과를 보고 다음 행동 결정) 중 선택합니다.</li>
        <li><b>스킬 기반</b> — 자주 쓰는 작업 흐름을 "스킬"(트리거 설명 + 단계 시퀀스)로 정의하면, LLM이 질의에 맞는 스킬을 선택해 실행합니다. 단계 파라미터는 LLM 채움 또는 템플릿(<code>{{QUERY}}</code>, <code>{{step1.output.필드}}</code>) 방식을 지원합니다.</li>
        <li><b>룰 기반</b> — 키워드/정규식 조건과 워크플로우를 매핑합니다. LLM 없이 결정적으로 동작하며, 매칭 실패 시 오류 처리 또는 LLM 폴백을 선택할 수 있습니다.</li>
      </ul>`,
  },
  {
    title: '📏 평가 지표 설명',
    html: `
      <ul>
        <li><b>Precision / Recall / F1</b> — 정답 워크플로우의 도구 집합 대비 전략이 호출한 도구 집합의 정밀도/재현율/조화평균.</li>
        <li><b>시퀀스 정확도</b> — 도구 호출 "순서"까지 고려한 유사도 (1 − 편집거리/최대길이).</li>
        <li><b>완전 일치율</b> — 도구 호출 순서가 정답과 완전히 일치한 항목의 비율.</li>
        <li><b>파라미터 점수</b> — 정답에 파라미터가 명시된 경우 키별 일치율 평균.</li>
        <li><b>평균 지연 / LLM 호출 수</b> — 효율성 지표.</li>
      </ul>
      <p>MCP 실행은 모의(Mock)이므로, 평가는 "어떤 도구를 어떤 순서·파라미터로 호출했는가"를 기준으로 합니다.</p>`,
  },
  {
    title: '⚠ 평가 결과 해석 주의사항',
    html: `
      <p>이 플랫폼은 <b>MCP 실행을 모의(Mock)</b>하는 환경입니다. 아래 한계를 이해하고 결과를 해석하세요.</p>
      <ul>
        <li><b>관찰 기반 적응은 공정 비교 대상이 아님</b> — 모의 실행 출력은 스키마 기반의 (결정적) 랜덤 값입니다. 따라서 "관찰 결과에 따라 분기"하는 능력은 실제 데이터가 없어 제대로 평가되지 않습니다. <b>ReAct류 전략의 관찰 기반 적응은 이 환경에서 이점을 발휘하기 어렵습니다.</b></li>
        <li><b>자동 생성 벤치마크의 정답은 미검증</b> — LLM이 만든 "질의→정답 워크플로우"는 오류를 포함할 수 있습니다. <b>반드시 사람이 검토·수정한 뒤</b> 평가에 사용하세요(생성 후 검토 화면의 경고 참고).</li>
        <li><b>룰 전략의 LLM 폴백은 분리 해석</b> — 룰 전략이 매칭 실패로 LLM 폴백을 탄 항목은 사실상 프롬프트 전략에 가깝습니다. 리더보드는 <b>폴백 비율과 함께</b> 나눠서 해석하세요.</li>
        <li><b>스킬 전략의 precision 하락</b> — 스킬은 선택된 스킬의 <b>정의된 단계 전체를 실행</b>하므로, 사용자가 일부만 원한 질의(부분 의도)에서는 불필요한 도구 호출로 precision이 낮아질 수 있습니다. <b>F1과 Precision/Recall을 함께</b> 보세요.</li>
        <li><b>비교 조건 통일</b> — 전략을 비교할 때는 <b>모델·온도를 동일</b>하게 맞추세요(평가 실행 옵션 활용). 특히 ReAct는 여러 번 LLM을 호출하므로 <b>컨텍스트 길이(설정의 num_ctx)</b>에 민감합니다.</li>
        <li><b>컨텍스트 길이 확인</b> — 기본 30개 서버(도구 90개)의 카탈로그만 수천 토큰입니다. 기본값은 <code>num_ctx 16384</code>이며, MCP를 더 등록했다면 상향하세요. 프롬프트가 예산을 초과하면 실행 트레이스에 ⚠ 경고가 표시됩니다.</li>
        <li><b>순서무관·대안 정답</b> — 항목 편집기에서 "순서 무관 채점"을 켤 수 있고, 대안 정답은 세트 JSON 가져오기로 지정합니다: 항목에 <code>"alternatives": [[{"serverId":"...","toolName":"..."}]]</code> 배열을 추가하면 본 정답과 대안 중 F1이 최대인 것으로 채점됩니다.</li>
      </ul>`,
  },
  {
    title: '🔐 계정·데이터 저장 위치',
    html: `
      <p>계정과 모든 데이터는 <b>이 브라우저의 localStorage</b>에만 저장됩니다. 서버로 전송되지 않으며 repo에도 포함되지 않습니다.</p>
      <ul>
        <li>다른 브라우저/PC에서 이어서 쓰려면 설정 → "데이터 내보내기"로 백업 후 가져오기 하세요.</li>
        <li>정적 호스팅 특성상 클라이언트 측 접근 제어입니다. 민감한 정보는 저장하지 마세요.</li>
      </ul>`,
  },
];

export function render(container) {
  container.replaceChildren(
    el('div', { class: 'stack', style: { maxWidth: '860px' } },
      SECTIONS.map(s => {
        const body = el('div', { class: 'guide-md' });
        body.innerHTML = s.html; // 정적 가이드 콘텐츠(사용자 입력 아님)
        return el('div', { class: 'card' }, el('div', { class: 'panel-title' }, s.title), body);
      })));
}
