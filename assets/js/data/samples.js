// ============================================================================
// samples.js — 샘플 오케스트레이션 전략 4종 + 기본 벤치마크 세트 1종
// SPEC §3 Strategy / BenchmarkSet 모델 준수. 순수 ES module.
// 여기서 참조하는 server id / tool name 은 모두 sampleMcps.js 에 실존하는 값이다.
//
// [전략 인덱스]
//  1) sample-strategy-1  prompt(plan)   기본 플래너 (플랜 우선)
//  2) sample-strategy-2  prompt(react)  ReAct 탐색형
//  3) sample-strategy-3  skill          여객 안내 스킬셋 (스킬 3종)
//  4) sample-strategy-4  rule           키워드 라우팅 룰셋 (룰 5종)
//  5) sample-strategy-5  db(vector·plan) 벡터 DB 플래너 (임베딩 인덱스 검색 공급)
//  6) sample-strategy-6  db(graph·plan)  그래프 DB 플래너 (도구 관계 그래프 순회 공급)
//
// [벤치마크]
//  sample-benchmark-basic  기본 검증 세트 (항목 10개, easy 4 / medium 4 / hard 2)
// ============================================================================

export const SAMPLE_STRATEGIES = [
  // --------------------------------------------------------------------------
  // 1. 프롬프트 기반 — 플랜 우선(plan)
  // --------------------------------------------------------------------------
  {
    id: 'sample-strategy-1',
    name: '기본 플래너 (플랜 우선)',
    description: '한 번의 LLM 호출로 전체 도구 실행 계획을 JSON으로 수립한 뒤 순차 실행하는 기본 오케스트레이터. 단계 수가 예측 가능하고 토큰 효율이 높다.',
    type: 'prompt',
    model: null,
    createdAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
    config: {
      planningMode: 'plan',
      temperature: 0.1,
      maxSteps: 6,
      systemPrompt: [
        '당신은 철도·교통 분야의 MCP 오케스트레이터입니다. 사용자 질의를 해결하기 위해 사용 가능한 MCP 도구들을 조합하여 하나의 실행 계획(plan)을 세웁니다.',
        '',
        '[오늘 날짜]',
        '{{DATE}}',
        '',
        '[사용 가능한 도구 목록]',
        '{{TOOL_CATALOG}}',
        '',
        '[계획 수립 지침]',
        '- 질의 해결에 실제로 필요한 도구만 선택하고, 논리적 실행 순서대로 배열하세요.',
        '- 각 도구의 params 에는 그 도구의 입력 스키마에 존재하는 키만 사용합니다.',
        '- 각 단계의 params는 질의에서 직접 추출해 채우세요. 앞 단계 출력값이 필요하면 {{step1.output.필드}} 형식으로 참조할 수 있습니다.',
        '- "내일", "이번 주말" 같은 상대 날짜는 {{DATE}} 를 기준으로 YYYY-MM-DD 형식으로 변환하세요.',
        '- 불필요한 도구를 남발하지 말고 최소한의 단계로 해결하세요. 해결 불가한 질의면 plan 을 빈 배열로 두고 reasoning 에 이유를 적습니다.',
        '',
        '[응답 형식]',
        '{"plan":[{"server":"서버id","tool":"도구명","params":{"키":"값"}}],"reasoning":"선택 근거를 한 문장으로"}',
        '',
        '[예시]',
        '질의: "내일 아침 서울에서 부산 가는 KTX 알려줘"',
        '출력: {"plan":[{"server":"kr-train-schedule","tool":"search_trains","params":{"from":"서울","to":"부산","trainType":"KTX"}}],"reasoning":"출발·도착역과 열차종별로 편성을 검색하면 되므로 단일 도구로 충분함"}',
        '질의: "모레 서울에서 동대구 가는 KTX 예매하려는데 자리 있는지 봐줘"',
        '출력: {"plan":[{"server":"kr-train-schedule","tool":"search_trains","params":{"from":"서울","to":"동대구","trainType":"KTX"}},{"server":"rail-reservation","tool":"check_seat_availability","params":{"trainNo":"{{step1.output.trains.0.trainNo}}","date":"{{DATE}}"}}],"reasoning":"편성을 먼저 검색하고 첫 열차 번호로 잔여석을 확인하는 2단계 흐름"}',
        '',
        '[사용자 질의]',
        '{{QUERY}}',
        '',
        '반드시 위 [응답 형식]의 순수 JSON 한 덩어리만 출력하세요. 설명 문장·마크다운·코드펜스 없이 JSON만 출력합니다.'
      ].join('\n')
    }
  },

  // --------------------------------------------------------------------------
  // 2. 프롬프트 기반 — ReAct(react)
  // --------------------------------------------------------------------------
  {
    id: 'sample-strategy-2',
    name: 'ReAct 탐색형',
    description: '매 단계 관찰(observation) 결과를 바탕으로 다음 행동을 결정하는 ReAct 방식 플래너. 낮은 temperature(0.1)로 일관되게 동작하며, 중간 결과에 따라 경로를 유연하게 조정하지만 LLM 호출이 여러 번 발생한다.',
    type: 'prompt',
    model: null,
    createdAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
    config: {
      planningMode: 'react',
      temperature: 0.1,
      maxSteps: 6,
      systemPrompt: [
        '당신은 철도·교통 분야의 MCP 오케스트레이터입니다. ReAct(Reasoning + Acting) 방식으로, 한 번에 하나의 행동만 결정하고 그 관찰 결과를 확인한 뒤 다음 행동을 이어갑니다.',
        '',
        '[오늘 날짜]',
        '{{DATE}}',
        '',
        '[사용 가능한 도구 목록]',
        '{{TOOL_CATALOG}}',
        '',
        '[사용자 질의]',
        '{{QUERY}}',
        '',
        '[진행 방식]',
        '- 매 턴마다 지금까지 얻은 관찰을 근거로 딱 하나의 도구를 호출하거나, 정보가 충분하면 최종 답변을 제시합니다.',
        '- 도구 호출 시 action 에 server / tool / params 를 지정하며, params 는 해당 도구 입력 스키마의 키만 사용합니다.',
        '- 같은 도구를 의미 없이 반복하지 말고, 이전 관찰에서 얻은 값(열차번호·예약번호·거래번호 등)을 다음 행동의 params 에 활용하세요.',
        '- 상대 날짜는 {{DATE}} 기준으로 변환합니다. 더 이상 도구 호출이 필요 없으면 final_answer 로 사용자에게 한국어로 답합니다.',
        '',
        '[응답 형식]',
        '매 턴 반드시 아래 두 형식 중 하나의 JSON만 출력하세요. 코드펜스·부연 설명 없이 순수 JSON 한 덩어리만.',
        '행동: {"thought":"현재 상황과 다음에 할 일","action":{"server":"서버id","tool":"도구명","params":{"키":"값"}}}',
        '종료: {"thought":"충분한 정보를 얻은 이유","final_answer":"사용자에게 전달할 최종 답변"}',
        '',
        '[예시]',
        '{"thought":"먼저 해당 열차의 실시간 위치부터 확인해야 한다","action":{"server":"train-position-tracker","tool":"track_train","params":{"trainNo":"KTX 101"}}}',
        '(도구 2회 흐름 예: 검색→예매) 첫 턴 {"thought":"먼저 편성을 검색한다","action":{"server":"kr-train-schedule","tool":"search_trains","params":{"from":"서울","to":"동대구","trainType":"KTX"}}} → 관찰로 받은 첫 편성 번호로 다음 턴 {"thought":"검색된 첫 열차의 잔여석을 확인한다","action":{"server":"rail-reservation","tool":"check_seat_availability","params":{"trainNo":"KTX 101","date":"{{DATE}}"}}}'
      ].join('\n')
    }
  },

  // --------------------------------------------------------------------------
  // 3. 스킬 기반 — 여객 안내 스킬셋
  // --------------------------------------------------------------------------
  {
    id: 'sample-strategy-3',
    name: '여객 안내 스킬셋',
    description: '자주 쓰이는 여객 안내 시나리오를 스킬로 사전 정의하고, LLM이 질의에 가장 맞는 스킬 1개를 선택해 정해진 단계를 순차 실행한다. 파라미터는 LLM이 질의에서 채운다.',
    type: 'skill',
    model: null,
    createdAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
    config: {
      paramFill: 'llm',
      selectorPrompt: [
        '당신은 여객 안내 스킬 선택기입니다. 아래 스킬 목록 중 사용자 질의를 가장 잘 해결하는 스킬 하나를 고르세요. 적합한 스킬이 없으면 "none" 을 고릅니다.',
        '',
        '[스킬 목록]',
        '{{SKILLS}}',
        '',
        '[사용자 질의]',
        '{{QUERY}}',
        '',
        '반드시 아래 JSON 형식으로만 출력하세요: {"skill":"스킬id 또는 none","reasoning":"선택 이유 한 문장"}'
      ].join('\n'),
      skills: [
        {
          id: 'skill-train-booking',
          name: '열차 검색·예매 흐름',
          trigger: '특정 구간의 열차를 찾아 좌석을 확인하거나 예매하려는 질의',
          description: '출발·도착역으로 열차를 검색하고, 첫 편성의 잔여 좌석을 확인한 뒤 좌석을 예약한다. "예매/예약/자리 있나" 류 질의에 사용.',
          steps: [
            {
              serverId: 'kr-train-schedule',
              toolName: 'search_trains',
              paramsTemplate: { from: '{{QUERY}}', to: '{{QUERY}}', trainType: '전체' }
            },
            {
              serverId: 'rail-reservation',
              toolName: 'check_seat_availability',
              paramsTemplate: { trainNo: '{{step1.output.trains.0.trainNo}}', date: '{{QUERY}}' }
            },
            {
              serverId: 'rail-reservation',
              toolName: 'reserve_seat',
              paramsTemplate: { trainNo: '{{step1.output.trains.0.trainNo}}', date: '{{QUERY}}', from: '{{QUERY}}', to: '{{QUERY}}' }
            }
          ]
        },
        {
          id: 'skill-subway-guide',
          name: '지하철 경로·혼잡도 안내',
          trigger: '지하철로 목적지까지 가는 경로와 혼잡 상황을 함께 알고 싶은 질의',
          description: '지하철 출발역에서 도착역까지 경로를 탐색하고, 도착역 승강장의 실시간 혼잡도를 함께 안내한다. 도시철도 길찾기 질의에 사용.',
          steps: [
            {
              serverId: 'subway-navigator',
              toolName: 'find_route',
              paramsTemplate: { from: '{{QUERY}}', to: '{{QUERY}}', preference: '최소시간' }
            },
            {
              serverId: 'platform-congestion',
              toolName: 'get_congestion',
              paramsTemplate: { station: '{{QUERY}}' }
            }
          ]
        },
        {
          id: 'skill-delay-alternative',
          name: '지연 확인·대체 이동 안내',
          trigger: '열차 지연을 확인하고 버스 등 대체 이동수단을 찾고 싶은 질의',
          description: '해당 노선의 지연 현황을 확인한 뒤, 버스-지하철 연계 대체 경로를 안내한다. "지연됐는데 다른 방법 없어?" 류 질의에 사용.',
          steps: [
            {
              serverId: 'train-delay-monitor',
              toolName: 'get_delays',
              paramsTemplate: { line: '{{QUERY}}' }
            },
            {
              serverId: 'bus-transit',
              toolName: 'find_transfer',
              paramsTemplate: { from: '{{QUERY}}', to: '{{QUERY}}' }
            }
          ]
        }
      ]
    }
  },

  // --------------------------------------------------------------------------
  // 4. 룰 기반 — 키워드 라우팅 룰셋
  // --------------------------------------------------------------------------
  {
    id: 'sample-strategy-4',
    name: '키워드 라우팅 룰셋',
    description: 'LLM 없이 질의의 키워드·정규식을 우선순위 순으로 매칭해 정해진 워크플로우로 결정적으로 라우팅한다. 어떤 룰에도 걸리지 않으면 기본 플래너(LLM)로 폴백한다.',
    type: 'rule',
    model: null,
    createdAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
    config: {
      onNoMatch: 'llmFallback',
      fallbackPrompt: '',
      rules: [
        {
          id: 'rule-delay',
          name: '지연 조회',
          priority: 1,
          matchMode: 'any',
          conditions: [
            { type: 'keyword', value: '지연' },
            { type: 'keyword', value: '연착' },
            { type: 'keyword', value: '밀려' }
          ],
          steps: [
            { serverId: 'train-delay-monitor', toolName: 'get_delays', paramsTemplate: { line: '{{QUERY}}' } }
          ]
        },
        {
          id: 'rule-reserve',
          name: '예매 워크플로우',
          priority: 2,
          matchMode: 'any',
          conditions: [
            { type: 'regex', value: '예매|예약|자리\\s?있' }
          ],
          steps: [
            { serverId: 'kr-train-schedule', toolName: 'search_trains', paramsTemplate: { from: '{{QUERY}}', to: '{{QUERY}}' } },
            { serverId: 'rail-reservation', toolName: 'check_seat_availability', paramsTemplate: { trainNo: '{{step1.output.trains.0.trainNo}}', date: '{{QUERY}}' } }
          ]
        },
        {
          id: 'rule-weather',
          name: '기상 영향 조회',
          priority: 3,
          matchMode: 'any',
          conditions: [
            { type: 'regex', value: '날씨|기상|태풍|폭우|폭설|대설' }
          ],
          steps: [
            { serverId: 'rail-weather', toolName: 'get_weather_impact', paramsTemplate: { line: '{{QUERY}}' } }
          ]
        },
        {
          id: 'rule-congestion',
          name: '혼잡도 조회',
          priority: 4,
          matchMode: 'any',
          conditions: [
            { type: 'keyword', value: '혼잡' },
            { type: 'keyword', value: '붐비' },
            { type: 'keyword', value: '사람 많' }
          ],
          steps: [
            { serverId: 'platform-congestion', toolName: 'get_congestion', paramsTemplate: { station: '{{QUERY}}' } }
          ]
        },
        {
          id: 'rule-lost',
          name: '유실물 검색',
          priority: 5,
          matchMode: 'any',
          conditions: [
            { type: 'regex', value: '분실|유실|잃어|놓고\\s?내림|두고 내림' }
          ],
          steps: [
            { serverId: 'lost-and-found', toolName: 'search_found_items', paramsTemplate: { itemType: '{{QUERY}}' } }
          ]
        }
      ]
    }
  },

  // --------------------------------------------------------------------------
  // 5. DB 기반(vector) — 벡터 DB 플래너
  //    카탈로그를 임베딩 벡터 db(catalogIndex)로 구축하고, 질의와 의미적으로 가까운 도구만
  //    검색(하이브리드)해 플래너에 공급한다. systemPrompt는 전략1(기본 플래너)과 동일.
  //    ※ 실행 전, DB 전략 편집기의 인덱스 상태 카드에서 벡터 인덱스를 먼저 구축해야 한다.
  // --------------------------------------------------------------------------
  {
    id: 'sample-strategy-5',
    name: '벡터 DB 플래너',
    description: '카탈로그를 임베딩 벡터 db로 구축하고, 전체 도구를 나열하는 대신 질의와 의미적으로 가까운 도구만 하이브리드 검색으로 골라 공급하는 플래너. 도구가 많아질수록 토큰 효율과 계획 정확도 이점이 커진다. ⚠ 실행 전 DB 전략 편집기의 인덱스 상태 카드에서 벡터 인덱스를 먼저 구축해야 한다(미구축 시 키워드 검색으로 폴백).',
    type: 'db',
    model: null,
    createdAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
    config: {
      store: 'vector',
      planningMode: 'plan',
      temperature: 0.1,
      maxSteps: 6,
      vector: {
        method: 'hybrid',
        topK: 8,
        threshold: 0,
        hybridAlpha: 0.5,
        expandServer: true,
        expandCategory: false,
        embedModel: 'bge-m3:latest'
      },
      systemPrompt: [
        '당신은 철도·교통 분야의 MCP 오케스트레이터입니다. 사용자 질의를 해결하기 위해 사용 가능한 MCP 도구들을 조합하여 하나의 실행 계획(plan)을 세웁니다.',
        '',
        '[오늘 날짜]',
        '{{DATE}}',
        '',
        '[사용 가능한 도구 목록]',
        '{{TOOL_CATALOG}}',
        '',
        '[계획 수립 지침]',
        '- 질의 해결에 실제로 필요한 도구만 선택하고, 논리적 실행 순서대로 배열하세요.',
        '- 각 도구의 params 에는 그 도구의 입력 스키마에 존재하는 키만 사용합니다.',
        '- 각 단계의 params는 질의에서 직접 추출해 채우세요. 앞 단계 출력값이 필요하면 {{step1.output.필드}} 형식으로 참조할 수 있습니다.',
        '- "내일", "이번 주말" 같은 상대 날짜는 {{DATE}} 를 기준으로 YYYY-MM-DD 형식으로 변환하세요.',
        '- 불필요한 도구를 남발하지 말고 최소한의 단계로 해결하세요. 해결 불가한 질의면 plan 을 빈 배열로 두고 reasoning 에 이유를 적습니다.',
        '',
        '[응답 형식]',
        '{"plan":[{"server":"서버id","tool":"도구명","params":{"키":"값"}}],"reasoning":"선택 근거를 한 문장으로"}',
        '',
        '[예시]',
        '질의: "내일 아침 서울에서 부산 가는 KTX 알려줘"',
        '출력: {"plan":[{"server":"kr-train-schedule","tool":"search_trains","params":{"from":"서울","to":"부산","trainType":"KTX"}}],"reasoning":"출발·도착역과 열차종별로 편성을 검색하면 되므로 단일 도구로 충분함"}',
        '질의: "모레 서울에서 동대구 가는 KTX 예매하려는데 자리 있는지 봐줘"',
        '출력: {"plan":[{"server":"kr-train-schedule","tool":"search_trains","params":{"from":"서울","to":"동대구","trainType":"KTX"}},{"server":"rail-reservation","tool":"check_seat_availability","params":{"trainNo":"{{step1.output.trains.0.trainNo}}","date":"{{DATE}}"}}],"reasoning":"편성을 먼저 검색하고 첫 열차 번호로 잔여석을 확인하는 2단계 흐름"}',
        '',
        '[사용자 질의]',
        '{{QUERY}}',
        '',
        '반드시 위 [응답 형식]의 순수 JSON 한 덩어리만 출력하세요. 설명 문장·마크다운·코드펜스 없이 JSON만 출력합니다.'
      ].join('\n')
    }
  },

  // --------------------------------------------------------------------------
  // 6. DB 기반(graph) — 그래프 DB 플래너
  //    도구=노드, 도구 간 관계(io/semantic/server/category/cooccur/llm)=엣지 그래프를 구축하고,
  //    질의 시드에서 그래프를 순회(hops 확산)해 연관 도구를 함께 공급한다. systemPrompt는 전략1과 동일.
  //    기본값: io on / semantic on / server on(0.5) / category off / cooccur off(벤치마크 정보 누출 방지) / llm off(무거움),
  //    hops 2 · seedK 5 · decay 0.5 · topK 8. 모델은 embedModel·extractModel 모두 null(=기본값 사용).
  //    ※ 실행 전, DB 전략 편집기의 그래프 db 상태 카드에서 그래프를 먼저 구축해야 한다
  //      (미구축·stale 시 vector/키워드 검색으로 폴백). semantic 엣지는 벡터 인덱스가 있을 때만,
  //      llm 엣지는 편집기에서 llm을 켜고 구축할 때만(도구당 1회 LLM 호출) 포함된다.
  // --------------------------------------------------------------------------
  {
    id: 'sample-strategy-6',
    name: '그래프 DB 플래너',
    description: '카탈로그를 도구 관계 그래프(입출력 연결·의미 유사·서버·카테고리·공출현 엣지, 그리고 선택적으로 LLM 의미 관계(llm 엣지, 기본 off))로 구축하고, 질의 시드에서 그래프를 순회해 직접 매치된 도구뿐 아니라 함께 쓰이는 연관 도구까지 묶어 공급하는 플래너. 다단계 워크플로우에서 이어지는 도구를 놓치지 않는 이점이 있다. ⚠ 실행 전 DB 전략 편집기의 그래프 db 상태 카드에서 그래프를 먼저 구축해야 한다(미구축·stale 시 vector/키워드 검색으로 폴백). llm 엣지를 켜면 구축 시 도구당 1회 LLM 호출로 의미 관계를 추출한다.',
    type: 'db',
    model: null,
    createdAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
    config: {
      store: 'graph',
      planningMode: 'plan',
      temperature: 0.1,
      maxSteps: 6,
      graph: {
        edges: {
          io: { on: true, weight: 1.0, threshold: 0.0 },
          semantic: { on: true, weight: 1.0, threshold: 0.55 },
          server: { on: true, weight: 0.5 },
          category: { on: false, weight: 0.3 },
          cooccur: { on: false, weight: 1.0, threshold: 1 },
          llm: { on: false, weight: 1.0, threshold: 1 }
        },
        seedMethod: 'hybrid',
        seedK: 5,
        hops: 2,
        decay: 0.5,
        topK: 8,
        embedModel: null,
        extractModel: null
      },
      systemPrompt: [
        '당신은 철도·교통 분야의 MCP 오케스트레이터입니다. 사용자 질의를 해결하기 위해 사용 가능한 MCP 도구들을 조합하여 하나의 실행 계획(plan)을 세웁니다.',
        '',
        '[오늘 날짜]',
        '{{DATE}}',
        '',
        '[사용 가능한 도구 목록]',
        '{{TOOL_CATALOG}}',
        '',
        '[계획 수립 지침]',
        '- 질의 해결에 실제로 필요한 도구만 선택하고, 논리적 실행 순서대로 배열하세요.',
        '- 각 도구의 params 에는 그 도구의 입력 스키마에 존재하는 키만 사용합니다.',
        '- 각 단계의 params는 질의에서 직접 추출해 채우세요. 앞 단계 출력값이 필요하면 {{step1.output.필드}} 형식으로 참조할 수 있습니다.',
        '- "내일", "이번 주말" 같은 상대 날짜는 {{DATE}} 를 기준으로 YYYY-MM-DD 형식으로 변환하세요.',
        '- 불필요한 도구를 남발하지 말고 최소한의 단계로 해결하세요. 해결 불가한 질의면 plan 을 빈 배열로 두고 reasoning 에 이유를 적습니다.',
        '',
        '[응답 형식]',
        '{"plan":[{"server":"서버id","tool":"도구명","params":{"키":"값"}}],"reasoning":"선택 근거를 한 문장으로"}',
        '',
        '[예시]',
        '질의: "내일 아침 서울에서 부산 가는 KTX 알려줘"',
        '출력: {"plan":[{"server":"kr-train-schedule","tool":"search_trains","params":{"from":"서울","to":"부산","trainType":"KTX"}}],"reasoning":"출발·도착역과 열차종별로 편성을 검색하면 되므로 단일 도구로 충분함"}',
        '질의: "모레 서울에서 동대구 가는 KTX 예매하려는데 자리 있는지 봐줘"',
        '출력: {"plan":[{"server":"kr-train-schedule","tool":"search_trains","params":{"from":"서울","to":"동대구","trainType":"KTX"}},{"server":"rail-reservation","tool":"check_seat_availability","params":{"trainNo":"{{step1.output.trains.0.trainNo}}","date":"{{DATE}}"}}],"reasoning":"편성을 먼저 검색하고 첫 열차 번호로 잔여석을 확인하는 2단계 흐름"}',
        '',
        '[사용자 질의]',
        '{{QUERY}}',
        '',
        '반드시 위 [응답 형식]의 순수 JSON 한 덩어리만 출력하세요. 설명 문장·마크다운·코드펜스 없이 JSON만 출력합니다.'
      ].join('\n')
    }
  }
];

export const SAMPLE_BENCHMARKS = [
  {
    id: 'sample-benchmark-basic',
    name: '기본 검증 세트',
    description: '철도·교통 여러 카테고리에 걸친 현실적인 한국어 질의 10건. 단일 도구부터 3단계 워크플로우까지 포함하며, 프롬프트·스킬·룰 전략을 두루 검증하도록 구성했다.',
    createdAt: '2026-07-04T00:00:00Z',
    items: [
      {
        id: 'sample-bench-item-1',
        query: '오늘 서울에서 부산 가는 KTX 편성 좀 찾아줘',
        expected: [
          { serverId: 'kr-train-schedule', toolName: 'search_trains', params: { from: '서울', to: '부산', trainType: 'KTX' } }
        ],
        category: '운행정보',
        difficulty: 'easy',
        source: 'manual',
        notes: '단일 도구 편성 검색. 출발·도착역과 열차종별을 정확히 추출하는지 확인.'
      },
      {
        id: 'sample-bench-item-2',
        query: '지금 경부선에 지연되고 있는 열차 있는지 확인해줘',
        expected: [
          { serverId: 'train-delay-monitor', toolName: 'get_delays' }
        ],
        category: '운행정보',
        difficulty: 'easy',
        source: 'manual',
        notes: '지연 현황 조회. 지연 도구를 시간표 검색과 혼동하지 않는지 확인(파라미터 미채점).'
      },
      {
        id: 'sample-bench-item-3',
        query: '강남역에서 홍대입구역까지 지하철로 어떻게 가는지 알려줘',
        expected: [
          { serverId: 'subway-navigator', toolName: 'find_route' }
        ],
        category: '도시교통',
        difficulty: 'easy',
        source: 'manual',
        notes: '도시철도 길찾기. 간선철도(kr-train-schedule)가 아닌 지하철 경로 도구를 선택하는지 확인.'
      },
      {
        id: 'sample-bench-item-4',
        query: '서울에서 대전까지 KTX 일반실 요금이 얼마인지 계산해줘',
        expected: [
          { serverId: 'fare-calculator', toolName: 'calculate_fare', params: { from: '서울', to: '대전', trainType: 'KTX', seatClass: '일반실' } }
        ],
        category: '요금·정산',
        difficulty: 'easy',
        source: 'manual',
        notes: '여객 운임 계산. 화물 견적(cargo-booking)과 구분되는지 확인.'
      },
      {
        id: 'sample-bench-item-5',
        query: '내일 오전에 서울에서 동대구 가는 KTX 예매하려는데 자리 있는지 봐줘',
        expected: [
          { serverId: 'kr-train-schedule', toolName: 'search_trains' },
          { serverId: 'rail-reservation', toolName: 'check_seat_availability' }
        ],
        category: '예매·발권',
        difficulty: 'medium',
        source: 'manual',
        notes: '2단계 흐름(검색→잔여석 확인). 열차 검색 후 예매 도메인으로 이어지는 순서를 지키는지 확인.'
      },
      {
        id: 'sample-bench-item-6',
        query: '퇴근 시간대에 사당역 승강장이 얼마나 혼잡할지 미리 알 수 있을까?',
        expected: [
          { serverId: 'platform-congestion', toolName: 'predict_congestion', params: { station: '사당', hour: 18 } }
        ],
        category: '도시교통',
        difficulty: 'medium',
        source: 'manual',
        notes: '미래 시점 혼잡 예측. 실시간 조회(get_congestion)가 아니라 예측 도구를 고르고 시간대를 추론하는지 확인.'
      },
      {
        id: 'sample-bench-item-7',
        query: '어제 KTX 안에서 검정색 지갑을 잃어버렸어. 습득된 게 있는지 찾아봐줘',
        expected: [
          { serverId: 'lost-and-found', toolName: 'search_found_items' }
        ],
        category: '여객서비스',
        difficulty: 'medium',
        source: 'manual',
        notes: '유실물 검색. 분실 신고(report_lost_item)가 아니라 습득물 검색 도구를 선택하는지 확인.'
      },
      {
        id: 'sample-bench-item-8',
        query: '컨테이너 화물 CN-KR-778102가 지금 어디쯤 있고 언제 도착하는지 알려줘',
        expected: [
          { serverId: 'freight-tracking', toolName: 'track_shipment', params: { trackingNo: 'CN-KR-778102' } },
          { serverId: 'freight-tracking', toolName: 'estimate_freight_eta', params: { trackingNo: 'CN-KR-778102' } }
        ],
        category: '물류·화물',
        difficulty: 'medium',
        source: 'manual',
        notes: '2단계 화물 추적(현재 위치→도착 예정). 운송장번호를 두 도구에 일관되게 전달하는지 확인.'
      },
      {
        id: 'sample-bench-item-9',
        query: '태풍이 온다는데 동해선 운행에 영향 있을지, 실제 지연도 함께 확인해줘',
        expected: [
          { serverId: 'disaster-alert', toolName: 'get_disaster_alerts' },
          { serverId: 'rail-weather', toolName: 'get_weather_impact' },
          { serverId: 'train-delay-monitor', toolName: 'get_delays' }
        ],
        category: '기상·환경',
        difficulty: 'hard',
        source: 'manual',
        notes: '3단계 복합(재난 특보→기상 운행영향→실지연). 재난·기상·운행 도메인을 순서대로 엮는지 확인(파라미터 미채점).'
      },
      {
        id: 'sample-bench-item-10',
        query: '지난달 호남고속선 정시율이 어땠고 지연 원인이 뭐였는지 분석해줘',
        expected: [
          { serverId: 'punctuality-analytics', toolName: 'get_punctuality', params: { line: '호남고속선' } },
          { serverId: 'punctuality-analytics', toolName: 'get_delay_causes', params: { line: '호남고속선', month: '2026-06' } }
        ],
        category: '데이터분석',
        difficulty: 'hard',
        source: 'manual',
        notes: '2단계 분석(정시율→지연 원인 분해). "지난달"을 2026-06으로 변환하고 분석 도구를 실시간 지연 조회와 구분하는지 확인.'
      }
    ]
  }
];
