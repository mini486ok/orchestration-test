// ============================================================================
// benchmarksExt/analytics.js — 데이터분석 분야 검증 세트 (10문항)
// SPEC §10(계약서) 규격 준수. 순수 ES module.
//
// 참조 서버(데이터분석 분야, 총 10개):
//  ● 기존 3개: ridership-analytics, punctuality-analytics, demand-forecast
//  ● 신규 7개: revenue-analytics, od-matrix-analyzer, crowding-prediction,
//              energy-consumption-analytics, kpi-dashboard-hub,
//              anomaly-detection-engine, passenger-flow-simulator
//
// 구성: 1단계 질의 3개(easy) + 2단계 체인 4개(medium) + 3단계 체인 3개(hard).
// 다중 정답: ordered:false 3문항(#5, #7, #10) + alternatives 2문항(#3, #9)
//           + goal 4문항(#4, #6, #8, #9) → 최소 1개 이상 반영 문항 총 8개.
// io 체인 반영: build_full_od_matrix→odPairs→simulate_network_load(#8),
//              get_metric_timeseries→series→detect_series_anomalies(#4),
//              get_active_alerts→alertId→acknowledge_alert(#9, 대안 경로 포함).
// ============================================================================

export const BENCH_ANALYTICS = {
  id: 'bench-set-analytics',
  name: '데이터분석 검증 세트',
  description: '철도 데이터분석 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    // ------------------------------------------------------------------
    // 1단계 질의 (easy) — 3문항
    // ------------------------------------------------------------------
    {
      id: 'bench-analytics-1',
      query: '6월 한 달 동안 서울역 승하차 인원이 총 얼마나 됐는지 알려줘',
      expected: [
        { serverId: 'ridership-analytics', toolName: 'get_ridership', params: { station: '서울', from: '2026-06-01', to: '2026-06-30' } }
      ],
      category: '데이터분석',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 역 누적 승하차 통계 조회. 실시간 혼잡 예측(crowding-prediction)이나 피크타임 분석(get_peak_analysis)과 혼동하지 않고 기간 집계 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-analytics-2',
      query: '이번 달 KTX 경부선 운임 수익을 일별로 집계해줘',
      expected: [
        { serverId: 'revenue-analytics', toolName: 'get_revenue_summary', params: { lineId: 'KTX-경부선', startDate: '2026-07-01', endDate: '2026-07-31', granularity: '일별' } }
      ],
      category: '데이터분석',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 노선 수익 집계. 노선 간 순위 비교(rank_top_revenue_routes)로 잘못 빠지지 않고 "이번 달"을 2026-07-01~07-31로 정확히 변환하는지 확인.'
    },
    {
      id: 'bench-analytics-3',
      query: '이번 달 경부고속선 정시율이 어느 정도인지 확인해줘',
      expected: [
        { serverId: 'punctuality-analytics', toolName: 'get_punctuality', params: { line: '경부고속선', from: '2026-07-01', to: '2026-07-31' } }
      ],
      alternatives: [
        [ { serverId: 'kpi-dashboard-hub', toolName: 'get_kpi_summary', params: { metricIds: ['정시율'] } } ]
      ],
      category: '데이터분석',
      difficulty: 'easy',
      source: 'manual',
      notes: '노선별 정시성 상세 분석 도구가 정석 경로. KPI 대시보드에서 정시율 지표를 요약 조회하는 대안도 정답으로 인정(다중 정답).'
    },

    // ------------------------------------------------------------------
    // 2단계 체인 (medium) — 4문항
    // ------------------------------------------------------------------
    {
      id: 'bench-analytics-4',
      query: '6월 28일부터 오늘까지 평균혼잡도 지표 시계열을 뽑아서 이상치가 있는지 탐지해줘',
      expected: [
        { serverId: 'kpi-dashboard-hub', toolName: 'get_metric_timeseries', params: { metricId: '평균혼잡도', startDate: '2026-06-28', endDate: '2026-07-05' } },
        { serverId: 'anomaly-detection-engine', toolName: 'detect_series_anomalies', params: { metricId: '평균혼잡도' } }
      ],
      goal: { serverId: 'anomaly-detection-engine', toolName: 'detect_series_anomalies' },
      category: '데이터분석',
      difficulty: 'medium',
      source: 'manual',
      notes: 'get_metric_timeseries의 출력 series를 detect_series_anomalies의 입력 series로 그대로 전달하는 io 체이닝. "오늘"을 2026-07-05로 변환하고 metricId를 두 호출에 일관되게 유지하는지 확인(series는 이전 단계 산출값이라 미채점).'
    },
    {
      id: 'bench-analytics-5',
      query: '정시율·평균혼잡도 KPI 요약이랑, 지금 활성화된 이상 경보 목록도 같이 보여줘',
      expected: [
        { serverId: 'kpi-dashboard-hub', toolName: 'get_kpi_summary', params: { metricIds: ['정시율', '평균혼잡도'] } },
        { serverId: 'anomaly-detection-engine', toolName: 'get_active_alerts' }
      ],
      ordered: false,
      category: '데이터분석',
      difficulty: 'medium',
      source: 'manual',
      notes: 'KPI 요약 조회와 활성 경보 조회는 서로 독립적인 병렬 질의라 호출 순서 무관. metricIds 배열에 두 지표를 모두 담는지 확인.'
    },
    {
      id: 'bench-analytics-6',
      query: '올해 누적 매출 1위 노선을 찾아서, 운영비 9억원 기준으로 수익성이 있는지 계산해줘',
      expected: [
        { serverId: 'revenue-analytics', toolName: 'rank_top_revenue_routes', params: { period: '올해', topN: 1 } },
        { serverId: 'revenue-analytics', toolName: 'compute_route_profitability', params: { operatingCost: 900000000 } }
      ],
      goal: { serverId: 'revenue-analytics', toolName: 'compute_route_profitability' },
      category: '데이터분석',
      difficulty: 'medium',
      source: 'manual',
      notes: 'rank_top_revenue_routes 결과의 1위 lineId를 compute_route_profitability의 lineId 입력으로 그대로 연결하는 io 체이닝. lineId를 지어내지 않고 1단계 결과를 재사용하는지 확인(lineId는 이전 단계 산출값이라 미채점).'
    },
    {
      id: 'bench-analytics-7',
      query: '경부고속선 혼잡 경보 뜬 거 있는지랑, 에너지 절감 여지 있는 구간도 같이 확인해줘',
      expected: [
        { serverId: 'crowding-prediction', toolName: 'get_crowding_alerts', params: { lineId: '경부고속선' } },
        { serverId: 'energy-consumption-analytics', toolName: 'rank_energy_saving_opportunities', params: { lineId: '경부고속선' } }
      ],
      ordered: false,
      category: '데이터분석',
      difficulty: 'medium',
      source: 'manual',
      notes: '같은 노선에 대한 혼잡 경보 조회와 에너지 절감 구간 조회는 서로 독립적인 진단이라 순서 무관. 두 도구 모두 lineId를 정확히 전달하는지 확인.'
    },

    // ------------------------------------------------------------------
    // 3단계 체인 (hard) — 3문항
    // ------------------------------------------------------------------
    {
      id: 'bench-analytics-8',
      query: '오늘 기준으로 전체 역간 통행량 행렬을 만들어서 네트워크 부하 시뮬레이션을 돌리고, 그 결과를 참고해서 경부고속선 병목역도 임계치 0.9 기준으로 짚어줘',
      expected: [
        { serverId: 'od-matrix-analyzer', toolName: 'build_full_od_matrix', params: { date: '2026-07-05' } },
        { serverId: 'passenger-flow-simulator', toolName: 'simulate_network_load', params: { date: '2026-07-05' } },
        { serverId: 'passenger-flow-simulator', toolName: 'estimate_bottleneck_stations', params: { lineId: '경부고속선', thresholdLoadFactor: 0.9 } }
      ],
      goal: { serverId: 'passenger-flow-simulator', toolName: 'estimate_bottleneck_stations' },
      category: '데이터분석',
      difficulty: 'hard',
      source: 'manual',
      notes: 'build_full_od_matrix의 출력 odPairs를 simulate_network_load의 입력 odPairs로 그대로 전달하는 io 체이닝에 특정 노선 병목 진단까지 이어지는 3단계. "오늘"을 2026-07-05로 일관되게 변환하는지 확인(odPairs는 이전 단계 산출값이라 미채점).'
    },
    {
      id: 'bench-analytics-9',
      query: '정시율이 목표치 97%에 도달했는지 확인하고, 지금 떠있는 긴급 경보 목록도 확인한 다음, 그 중 첫 번째 경보는 확인 처리해줘',
      expected: [
        { serverId: 'kpi-dashboard-hub', toolName: 'compare_kpi_targets', params: { metricId: '정시율', targetValue: 97 } },
        { serverId: 'anomaly-detection-engine', toolName: 'get_active_alerts', params: { severity: '긴급' } },
        { serverId: 'anomaly-detection-engine', toolName: 'acknowledge_alert' }
      ],
      alternatives: [
        [
          { serverId: 'anomaly-detection-engine', toolName: 'get_active_alerts', params: { severity: '긴급' } },
          { serverId: 'anomaly-detection-engine', toolName: 'acknowledge_alert' }
        ]
      ],
      goal: { serverId: 'anomaly-detection-engine', toolName: 'acknowledge_alert' },
      category: '데이터분석',
      difficulty: 'hard',
      source: 'manual',
      notes: 'get_active_alerts 출력의 alertId를 acknowledge_alert 입력으로 그대로 전달하는 io 체이닝(alertId는 이전 단계 산출값이라 미채점). KPI 목표 대비 확인 단계를 생략하고 경보 조회→확인처리 2단계만 수행해도 목표 도구(acknowledge_alert) 달성은 동일하므로 대안 경로로 인정.'
    },
    {
      id: 'bench-analytics-10',
      query: '8월 15일 부산에서 열리는 불꽃축제 때문에 수요가 얼마나 늘어날지 분석하고, 그날 KTX 101 열차 혼잡도랑 부산역 자체 혼잡도도 같이 예측해줘',
      expected: [
        { serverId: 'demand-forecast', toolName: 'analyze_event_impact', params: { eventName: '부산 불꽃축제', station: '부산', date: '2026-08-15' } },
        { serverId: 'crowding-prediction', toolName: 'predict_train_crowding', params: { trainNo: 'KTX 101', date: '2026-08-15' } },
        { serverId: 'crowding-prediction', toolName: 'predict_station_crowding' }
      ],
      ordered: false,
      category: '데이터분석',
      difficulty: 'hard',
      source: 'manual',
      notes: '이벤트 수요 영향 분석, 열차 혼잡 예측, 역 혼잡 예측은 서로 독립적인 병렬 진단이라 순서 무관(3건 모두 호출했는지가 핵심). predict_station_crowding의 stationId는 역 코드 체계라 파라미터 미채점.'
    }
  ]
};
