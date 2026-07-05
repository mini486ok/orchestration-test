// ============================================================================
// benchmarksExt/urban.js — 도시교통 분야 검증 세트 (10문항)
// SPEC §10(계약서) 규격 준수. 순수 ES module.
//
// 참조 서버(도시교통 분야, 총 10개):
//  ● 기존 3개: subway-navigator, bus-transit, platform-congestion
//  ● 신규 7개: multimodal-trip-planner, shared-mobility, park-and-ride,
//              taxi-dispatch, road-traffic-signal, ev-charging-network,
//              accessible-route-guide
//
// 구성: 1단계 질의 3개(easy 2 + medium 1) + 2단계 체인 4개(easy 1 + medium 2 + hard 1)
//       + 3단계 체인 3개(medium 1 + hard 2).
// 난이도 합계: easy 3 / medium 4 / hard 3.
// 다중 정답: ordered:false 3문항(#5, #7, #10) + alternatives 1문항(#3)
//           + goal 명시 4문항(#7, #8, #9, #10) = 총 6문항에서 활용.
// io 체이닝: plan_multimodal_trip→stationId→shared-mobility 조회/예약(#9),
//           find_nearby_stations→stationId→get_station_availability(#4),
//           find_lots_near_station→lotId→get_lot_availability(#6),
//           find_charging_stations→stationId→get_charger_status→reserve_charger(#8).
// ============================================================================

export const BENCH_URBAN = {
  id: 'bench-set-urban',
  name: '도시교통 검증 세트',
  description: '도시교통·복합환승 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    // ------------------------------------------------------------------
    // 1단계 질의 — 3문항 (easy 2, medium 1)
    // ------------------------------------------------------------------
    {
      id: 'bench-urban-1',
      query: '사당역 승강장 지금 많이 혼잡한지 확인해줘',
      expected: [
        { serverId: 'platform-congestion', toolName: 'get_congestion', params: { station: '사당' } }
      ],
      category: '도시교통',
      difficulty: 'easy',
      source: 'manual',
      notes: '실시간 승강장 혼잡도 단일 조회. 예측 도구(predict_congestion)나 칸별 혼잡도(get_car_congestion)와 혼동하지 않는지 확인.'
    },
    {
      id: 'bench-urban-2',
      query: '강남에서 홍대입구까지 지하철로 환승 최소로 가는 경로 좀 알려줘',
      expected: [
        { serverId: 'subway-navigator', toolName: 'find_route', params: { from: '강남', to: '홍대입구', preference: '최소환승' } }
      ],
      category: '도시교통',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 도구 경로 탐색. "환승 최소로"라는 표현에서 preference를 최소환승으로 정확히 추출하는지 확인.'
    },
    {
      id: 'bench-urban-3',
      query: '일산에서 판교까지 가는 방법 좀 알려줘',
      expected: [
        { serverId: 'multimodal-trip-planner', toolName: 'plan_multimodal_trip', params: { from: '일산', to: '판교' } }
      ],
      alternatives: [
        [ { serverId: 'bus-transit', toolName: 'find_transfer', params: { from: '일산', to: '판교' } } ]
      ],
      category: '도시교통',
      difficulty: 'medium',
      source: 'manual',
      notes: '지하철·버스·공유모빌리티를 아우르는 복합환승 플래너 호출이 정석이지만, 기존 버스-지하철 연계 환승 도구(bus-transit.find_transfer)만으로 답해도 정답으로 인정. 두 서버 모두 동일 출발·도착지 조합에 대응 가능함을 검증.'
    },

    // ------------------------------------------------------------------
    // 2단계 체인 — 4문항 (easy 1, medium 2, hard 1)
    // ------------------------------------------------------------------
    {
      id: 'bench-urban-4',
      query: '판교역 근처 공유자전거 대여소 찾아서 지금 자전거 남아있는지 확인해줘',
      expected: [
        { serverId: 'shared-mobility', toolName: 'find_nearby_stations', params: { station: '판교역', vehicleType: '자전거' } },
        { serverId: 'shared-mobility', toolName: 'get_station_availability', params: { stationId: 'BK-PANGYO-01' } }
      ],
      category: '도시교통',
      difficulty: 'easy',
      source: 'manual',
      notes: 'find_nearby_stations 출력의 stations[].stationId(BK-PANGYO-01)를 get_station_availability의 stationId 입력으로 그대로 연결하는 io 체이닝. 순서가 중요(대여소를 먼저 찾아야 재고 조회 가능).'
    },
    {
      id: 'bench-urban-5',
      query: '강남역사거리 신호 상태랑 강남대로 신논현~강남역 구간 정체 상황 둘 다 알려줘',
      expected: [
        { serverId: 'road-traffic-signal', toolName: 'get_signal_status', params: { intersection: '강남역사거리' } },
        { serverId: 'road-traffic-signal', toolName: 'get_road_congestion', params: { roadName: '강남대로', section: '신논현~강남역' } }
      ],
      ordered: false,
      category: '도시교통',
      difficulty: 'medium',
      source: 'manual',
      notes: '교차로 신호 상태와 도로 구간 정체는 서로 독립적인 병렬 질의라 호출 순서 무관. 두 도구 모두 정확한 대상(intersection/roadName)을 채워 호출하는지 확인.'
    },
    {
      id: 'bench-urban-6',
      query: '수서역 인근 환승주차장을 찾아서 지금 자리가 남아있는지 확인해줘',
      expected: [
        { serverId: 'park-and-ride', toolName: 'find_lots_near_station', params: { station: '수서' } },
        { serverId: 'park-and-ride', toolName: 'get_lot_availability', params: { lotId: 'PR-SUSEO-01' } }
      ],
      category: '도시교통',
      difficulty: 'medium',
      source: 'manual',
      notes: 'find_lots_near_station 출력의 lots[].lotId(PR-SUSEO-01)를 get_lot_availability의 lotId 입력으로 연결하는 io 체이닝. 주차장 탐색 없이 임의 lotId를 지어내지 않는지 확인.'
    },
    {
      id: 'bench-urban-7',
      query: '홍대입구역에서 김포공항까지 택시 요금 견적도 내주고 바로 배차도 요청해줘',
      expected: [
        { serverId: 'taxi-dispatch', toolName: 'estimate_fare', params: { from: '홍대입구역', to: '김포공항' } },
        { serverId: 'taxi-dispatch', toolName: 'request_dispatch', params: { from: '홍대입구역', to: '김포공항' } }
      ],
      ordered: false,
      goal: { serverId: 'taxi-dispatch', toolName: 'request_dispatch' },
      category: '도시교통',
      difficulty: 'hard',
      source: 'manual',
      notes: '요금 견적과 배차 요청은 서로 다른 목적(견적 vs 실행)의 독립 호출이라 순서 무관. 실제 목표는 배차 완료(request_dispatch)이며, 견적만 내고 배차를 빠뜨리면 목표 미달성으로 채점.'
    },

    // ------------------------------------------------------------------
    // 3단계 체인 — 3문항 (medium 1, hard 2)
    // ------------------------------------------------------------------
    {
      id: 'bench-urban-8',
      query: '판교역 근처 급속충전소를 찾아서 충전기 상태 확인하고, 비어있는 충전기로 예약까지 해줘',
      expected: [
        { serverId: 'ev-charging-network', toolName: 'find_charging_stations', params: { station: '판교역', connectorType: '급속' } },
        { serverId: 'ev-charging-network', toolName: 'get_charger_status', params: { stationId: 'EV-PANGYO-03' } },
        { serverId: 'ev-charging-network', toolName: 'reserve_charger', params: { stationId: 'EV-PANGYO-03', chargerId: 'C1' } }
      ],
      goal: { serverId: 'ev-charging-network', toolName: 'reserve_charger' },
      category: '도시교통',
      difficulty: 'medium',
      source: 'manual',
      notes: 'stationId→chargerId 순차 io 체이닝(find→status→reserve). 충전기 상태 조회 결과 "사용가능" 상태인 커넥터(C1)를 골라 예약하는지 확인. 순서가 중요(충전소·충전기를 먼저 알아야 예약 가능).'
    },
    {
      id: 'bench-urban-9',
      query: '판교에서 강남역까지 복합환승 경로 짜주고, 그 경로에 있는 공유자전거 대여소에 자전거가 있는지 확인한 다음 한 대 예약해줘',
      expected: [
        { serverId: 'multimodal-trip-planner', toolName: 'plan_multimodal_trip', params: { from: '판교', to: '강남역' } },
        { serverId: 'shared-mobility', toolName: 'get_station_availability', params: { stationId: 'BK-PANGYO-01' } },
        { serverId: 'shared-mobility', toolName: 'reserve_vehicle', params: { stationId: 'BK-PANGYO-01', vehicleType: '자전거' } }
      ],
      goal: { serverId: 'shared-mobility', toolName: 'reserve_vehicle' },
      category: '도시교통',
      difficulty: 'hard',
      source: 'manual',
      notes: 'plan_multimodal_trip 출력의 stationId(BK-PANGYO-01, 판교테크노밸리 대여소)를 shared-mobility 두 도구의 stationId 입력으로 그대로 연결하는 서버 간(멀티모달 플래너→공유모빌리티) 3단계 io 체이닝. 순서가 중요(경로 설계 후 재고 확인 후 예약).'
    },
    {
      id: 'bench-urban-10',
      query: '서울역에서 시청역까지 휠체어로 갈 수 있는 경로 확인하고, 시청역 엘리베이터 상태도 점검한 다음, 오후 2시 도착 기준으로 휠체어 동행 지원 인력도 요청해줘',
      expected: [
        { serverId: 'accessible-route-guide', toolName: 'find_accessible_route', params: { from: '서울역', to: '시청역', needType: '휠체어' } },
        { serverId: 'accessible-route-guide', toolName: 'get_elevator_status', params: { station: '시청역' } },
        { serverId: 'accessible-route-guide', toolName: 'request_mobility_assist', params: { station: '시청역', arriveTime: '14:00', assistType: '휠체어동행' } }
      ],
      ordered: false,
      goal: { serverId: 'accessible-route-guide', toolName: 'request_mobility_assist' },
      category: '도시교통',
      difficulty: 'hard',
      source: 'manual',
      notes: '세 호출 모두 필요한 파라미터(출발·도착지, 대상 역, 도착 시각, 지원 유형)가 사용자 발화에서 직접 도출되어 서로 데이터 의존성이 없으므로 순서 무관하게 병렬 처리 가능. 실제 목표는 지원 인력 요청(request_mobility_assist) 완료이며, 경로·엘리베이터 조회만 하고 요청을 빠뜨리면 목표 미달성으로 채점.'
    }
  ]
};
