// ============================================================================
// benchmarksExt/operations.js — 운행정보 분야 검증 세트 (10문항)
// SPEC §10(계약서) 규격 준수. 순수 ES module.
//
// 참조 서버(운행정보 분야, 총 10개):
//  ● 기존 3개: kr-train-schedule, train-position-tracker, train-delay-monitor
//  ● 신규 7개: station-arrival-board, train-consist-info, rail-route-info,
//              transfer-route-planner, express-local-compare,
//              timetable-change-notice, section-speed-monitor
//
// 구성: 1단계 질의 4개(easy) + 2단계 체인 4개(medium) + 3단계 체인 2개(hard).
// 다중 정답: ordered:false 2문항(#5, #8) + alternatives 2문항(#3, #9) = 4문항.
// ============================================================================

export const BENCH_OPERATIONS = {
  id: 'bench-set-operations',
  name: '운행정보 검증 세트',
  description: '열차 운행정보 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    // ------------------------------------------------------------------
    // 1단계 질의 (easy) — 4문항
    // ------------------------------------------------------------------
    {
      id: 'bench-operations-1',
      query: '서울역 전광판에 지금 들어오는 열차들 좀 보여줘',
      expected: [
        { serverId: 'station-arrival-board', toolName: 'get_arrival_board', params: { station: '서울' } }
      ],
      category: '운행정보',
      difficulty: 'easy',
      source: 'manual',
      notes: '실시간 전광판 단일 조회. 시간표 검색(kr-train-schedule.search_trains)이나 고정 시간표 조회와 혼동하지 않고 지금 이 순간의 도착 전광판 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-operations-2',
      query: '지금 KTX 101 열차가 어디쯤 지나가고 있는지 실시간으로 알려줘',
      expected: [
        { serverId: 'train-position-tracker', toolName: 'track_train', params: { trainNo: 'KTX 101' } }
      ],
      category: '운행정보',
      difficulty: 'easy',
      source: 'manual',
      notes: '실시간 위치 추적 단일 호출. 지연 현황(get_delays)이나 도착예정(estimate_arrival)과 구분되는지 확인.'
    },
    {
      id: 'bench-operations-3',
      query: '서울에서 부산까지 철도 영업거리가 몇 km인지 알려줘',
      expected: [
        { serverId: 'rail-route-info', toolName: 'get_section_distance', params: { from: '서울', to: '부산' } }
      ],
      alternatives: [
        [ { serverId: 'rail-route-info', toolName: 'get_route_stations', params: { line: '경부선' } } ]
      ],
      category: '운행정보',
      difficulty: 'easy',
      source: 'manual',
      notes: '구간 거리 직접 조회가 정석 경로. 노선 전체 정차역의 누적거리(cumulativeDistanceKm)를 조회해 두 역 간 거리를 유추하는 대안 경로도 정답으로 인정.'
    },
    {
      id: 'bench-operations-4',
      query: '서울에서 대전까지 KTX랑 무궁화호 중에 뭐가 더 빠르고 요금은 얼마나 차이나는지 비교해줘',
      expected: [
        { serverId: 'express-local-compare', toolName: 'compare_train_types', params: { from: '서울', to: '대전' } }
      ],
      category: '운행정보',
      difficulty: 'easy',
      source: 'manual',
      notes: '열차 종별 비교 단일 도구. 개별 두 종별 간 시간 절감량 계산 도구(estimate_time_saved)로 바로 건너뛰지 않고 비교 도구부터 선택하는지 확인.'
    },

    // ------------------------------------------------------------------
    // 2단계 체인 (medium) — 4문항
    // ------------------------------------------------------------------
    {
      id: 'bench-operations-5',
      query: 'KTX 101 열차가 몇 량 편성인지랑 지금 몇 km/h로 달리고 있는지 같이 알려줘',
      expected: [
        { serverId: 'train-consist-info', toolName: 'get_consist', params: { trainNo: 'KTX 101' } },
        { serverId: 'section-speed-monitor', toolName: 'get_current_speed', params: { trainNo: 'KTX 101' } }
      ],
      ordered: false,
      category: '운행정보',
      difficulty: 'medium',
      source: 'manual',
      notes: '편성 정보 조회와 실시간 속도 조회는 서로 독립적인 병렬 질의라 호출 순서 무관. 두 도구 모두 trainNo를 정확히 채워 호출하는지 확인.'
    },
    {
      id: 'bench-operations-6',
      query: '강릉에서 목포까지 환승 경로를 찾아주고, 그 환승역에서 다른 노선으로도 갈아탈 수 있는지 확인해줘',
      expected: [
        { serverId: 'transfer-route-planner', toolName: 'find_transfer_route', params: { from: '강릉', to: '목포' } },
        { serverId: 'transfer-route-planner', toolName: 'get_transfer_info', params: { station: '서울' } }
      ],
      goal: { serverId: 'transfer-route-planner', toolName: 'get_transfer_info' },
      category: '운행정보',
      difficulty: 'medium',
      source: 'manual',
      notes: 'find_transfer_route 출력의 transferStation(서울)을 get_transfer_info의 station 입력으로 그대로 연결하는 io 체이닝. 환승역을 임의로 지어내지 않고 1단계 결과를 재사용하는지 확인.'
    },
    {
      id: 'bench-operations-7',
      query: '서울에서 대전 가는 열차 종류를 비교해주고, KTX가 무궁화보다 얼마나 시간을 절약하는지도 계산해줘',
      expected: [
        { serverId: 'express-local-compare', toolName: 'compare_train_types', params: { from: '서울', to: '대전' } },
        { serverId: 'express-local-compare', toolName: 'estimate_time_saved', params: { from: '서울', to: '대전', trainTypeA: 'KTX', trainTypeB: '무궁화' } }
      ],
      goal: { serverId: 'express-local-compare', toolName: 'estimate_time_saved' },
      category: '운행정보',
      difficulty: 'medium',
      source: 'manual',
      notes: '종별 비교 조회 후 구체적인 두 종별 간 시간 절감량·운임차액 계산으로 이어지는 2단계 흐름. from/to를 두 호출 모두에 일관되게 전달하는지 확인.'
    },
    {
      id: 'bench-operations-8',
      query: '호남선에 공사 때문에 시각표 바뀐 내용 있는지랑 관련 공사계획도 같이 확인해줘',
      expected: [
        { serverId: 'timetable-change-notice', toolName: 'get_schedule_changes', params: { line: '호남선' } },
        { serverId: 'timetable-change-notice', toolName: 'get_construction_plan', params: { region: '호남선' } }
      ],
      ordered: false,
      category: '운행정보',
      difficulty: 'medium',
      source: 'manual',
      notes: '두 도구 모두 필수 파라미터가 없어 병렬 호출이 자연스러움(순서 무관). 시각표 변경 공지와 공사계획을 각각 조회하는지 확인.'
    },

    // ------------------------------------------------------------------
    // 3단계 체인 (hard) — 2문항
    // ------------------------------------------------------------------
    {
      id: 'bench-operations-9',
      query: 'KTX 101이 부산에 몇 시에 도착할 예정인지 확인하고, 만약 지연되면 바로 알림 받을 수 있게 등록해줘',
      expected: [
        { serverId: 'train-position-tracker', toolName: 'track_train', params: { trainNo: 'KTX 101' } },
        { serverId: 'train-position-tracker', toolName: 'estimate_arrival', params: { trainNo: 'KTX 101', station: '부산' } },
        { serverId: 'train-delay-monitor', toolName: 'subscribe_delay_alert', params: { trainNo: 'KTX 101' } }
      ],
      alternatives: [
        [
          { serverId: 'station-arrival-board', toolName: 'get_arrival_board', params: { station: '부산' } },
          { serverId: 'train-delay-monitor', toolName: 'subscribe_delay_alert', params: { trainNo: 'KTX 101' } }
        ]
      ],
      goal: { serverId: 'train-delay-monitor', toolName: 'subscribe_delay_alert' },
      category: '운행정보',
      difficulty: 'hard',
      source: 'manual',
      notes: '현재위치 추적→도착예정시각 계산→지연알림 등록의 3단계 정석 경로. 부산역 전광판(get_arrival_board)에서 KTX 101의 예상 도착시각을 바로 확인한 뒤 알림만 등록하는 2단계 대안도 정답 인정(목표 도구는 동일하게 subscribe_delay_alert).'
    },
    {
      id: 'bench-operations-10',
      query: '강릉에서 목포까지 환승 경로를 찾아서, 첫 구간 열차 도착 후 환승 열차로 갈아타는 게 시간상 가능한지 확인하고, 그 환승 열차가 몇 번 승강장인지도 알려줘',
      expected: [
        { serverId: 'transfer-route-planner', toolName: 'find_transfer_route', params: { from: '강릉', to: '목포' } },
        { serverId: 'transfer-route-planner', toolName: 'check_connection_feasible', params: { arrivalTrainNo: 'KTX 811', transferStation: '서울', departureTrainNo: 'SRT 305' } },
        { serverId: 'station-arrival-board', toolName: 'get_platform_assignment', params: { station: '서울', trainNo: 'SRT 305' } }
      ],
      goal: { serverId: 'station-arrival-board', toolName: 'get_platform_assignment' },
      category: '운행정보',
      difficulty: 'hard',
      source: 'manual',
      notes: 'find_transfer_route 결과의 legs[].trainNo(KTX 811/SRT 305)와 transferStation(서울)을 이어지는 두 도구의 입력으로 그대로 연결하는 3단계 io 체이닝. 각 단계가 이전 출력에 의존하므로 순서가 중요(ordered 기본값 유지).'
    }
  ]
};
