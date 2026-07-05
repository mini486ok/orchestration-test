// ============================================================================
// 벤치마크 확장 — 기상·환경 (weather) 분야 검증 세트 10문항
// 참조 서버(기존 3 + 신규 7, assets/js/data/sampleMcps.js · mcpsExt/weather.js):
//   rail-weather, air-quality-monitor, disaster-alert(기존)
//   wind-typhoon-guard, flood-drainage-monitor, snow-ice-control,
//   rail-seismic-sensor, rail-buckling-risk, fog-visibility-monitor,
//   heatwave-uv-monitor(신규)
//
// 구성: 1단계 3 / 2단계 4 / 3단계 3   |   easy 3 / medium 4 / hard 3
// 다중 정답 반영: ordered:false 3문항(6,7,10), alternatives 4문항(1,3,8,9), goal 4문항(1,4,8,9)
// io 체인: get_wind_speed→sectionId→get_speed_restriction(5) /
//          get_snow_depth→sectionId→get_rail_icing_status→request_deicing(8) /
//          get_seismic_reading→sensorId→issue_seismic_alert(9)
// ============================================================================

export const BENCH_WEATHER = {
  id: 'bench-set-weather',
  name: '기상·환경 검증 세트',
  description: '철도 기상·환경 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    // --------------------------------------------------------------------
    // 1단계 (단일 도구) — easy 3문항
    // --------------------------------------------------------------------
    {
      id: 'bench-weather-1',
      query: '강릉 쪽 지금 바람이 심하게 부는지 확인해줘',
      expected: [
        { serverId: 'wind-typhoon-guard', toolName: 'get_wind_speed', params: { section: '강릉' } }
      ],
      category: '기상·환경',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 도구 풍속 실측 조회. 구간 전용 실측 도구 대신 rail-weather의 일반 기상 조회(windMs 포함)로도 답이 가능한 대안 워크플로우를 인정.',
      alternatives: [
        [{ serverId: 'rail-weather', toolName: 'get_weather', params: { location: '강릉' } }]
      ],
      goal: { serverId: 'wind-typhoon-guard', toolName: 'get_wind_speed' }
    },
    {
      id: 'bench-weather-2',
      query: '호남고속선 정읍 인근 교량 지진감지센서 계측값 좀 보여줘',
      expected: [
        { serverId: 'rail-seismic-sensor', toolName: 'get_seismic_reading', params: { station: '호남고속선 정읍 인근 교량' } }
      ],
      category: '기상·환경',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 도구 지진센서 실측 조회. 지역 전체 영향평가(disaster-alert)가 아닌 개별 센서 계측값 확인 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-weather-3',
      query: '서해선 안개 잦은 구간 지금 시정이 얼마나 되는지 확인해줘',
      expected: [
        { serverId: 'fog-visibility-monitor', toolName: 'get_visibility', params: { location: '서해선 안개잦은 구간' } }
      ],
      category: '기상·환경',
      difficulty: 'easy',
      source: 'manual',
      notes: '시정 실측 조회. fog-visibility-monitor 전용 도구 대신 rail-weather의 일반 기상 조회(visibilityM 포함)로도 답이 가능한 대안 워크플로우를 인정.',
      alternatives: [
        [{ serverId: 'rail-weather', toolName: 'get_weather', params: { location: '서해선 안개잦은 구간' } }]
      ]
    },

    // --------------------------------------------------------------------
    // 2단계 — medium 4문항 (체인 2 + 병렬독립 2)
    // --------------------------------------------------------------------
    {
      id: 'bench-weather-4',
      query: '태백선 도계 인근에 눈이 얼마나 쌓였는지 보고 결빙 위험도 있는지 판단해줘',
      expected: [
        { serverId: 'snow-ice-control', toolName: 'get_snow_depth', params: { section: '태백선 도계 인근' } },
        { serverId: 'snow-ice-control', toolName: 'get_rail_icing_status' }
      ],
      category: '기상·환경',
      difficulty: 'medium',
      source: 'manual',
      notes: '2단계 io 체인(적설량 실측→구간ID로 결빙 위험 판정). get_snow_depth 출력 sectionId를 get_rail_icing_status 입력에 그대로 연결하는지 확인.',
      goal: { serverId: 'snow-ice-control', toolName: 'get_rail_icing_status' }
    },
    {
      id: 'bench-weather-5',
      query: '영동선 도경리-옥계 구간 풍속 확인하고 지금 서행 규제가 걸려있는지도 알려줘',
      expected: [
        { serverId: 'wind-typhoon-guard', toolName: 'get_wind_speed', params: { section: '영동선 도경리-옥계' } },
        { serverId: 'wind-typhoon-guard', toolName: 'get_speed_restriction' }
      ],
      category: '기상·환경',
      difficulty: 'medium',
      source: 'manual',
      notes: '2단계 io 체인(풍속 실측→구간ID로 규제 단계 조회). 실측값 조회와 규제 결과 조회 도구를 순서대로 엮는지 확인.'
    },
    {
      id: 'bench-weather-6',
      query: '부산역 야외승강장 체감온도랑 부산권 자외선 예보 둘 다 확인해줘',
      expected: [
        { serverId: 'heatwave-uv-monitor', toolName: 'get_heat_index', params: { station: '부산역 야외승강장' } },
        { serverId: 'heatwave-uv-monitor', toolName: 'get_uv_forecast', params: { region: '부산권' } }
      ],
      category: '기상·환경',
      difficulty: 'medium',
      source: 'manual',
      notes: '서로 독립적인 두 조회(현재 체감온도 실측, 지역 자외선 예보)를 병렬로 호출하는 질의. 순서와 무관하게 두 도구 모두 호출됐는지가 핵심.',
      ordered: false
    },
    {
      id: 'bench-weather-7',
      query: '사당역 승강장 미세먼지 상태랑 남한강 수위 상황 둘 다 확인해줘',
      expected: [
        { serverId: 'air-quality-monitor', toolName: 'get_station_air_quality', params: { station: '사당', zone: '승강장' } },
        { serverId: 'flood-drainage-monitor', toolName: 'get_river_level', params: { river: '남한강' } }
      ],
      category: '기상·환경',
      difficulty: 'medium',
      source: 'manual',
      notes: '역사 공기질과 하천 수위라는 서로 무관한 두 환경 지표를 동시에 확인하는 병렬 질의. 순서 무관 채점으로 두 도구 모두 호출됐는지만 확인.',
      ordered: false
    },

    // --------------------------------------------------------------------
    // 3단계 — hard 3문항 (체인+조치 2 + 병렬독립 1)
    // --------------------------------------------------------------------
    {
      id: 'bench-weather-8',
      query: '경강선 강릉기점 인근에 폭설이 내리고 있는데, 적설량 확인하고 결빙 위험 있으면 바로 제설 작업 요청까지 해줘',
      expected: [
        { serverId: 'snow-ice-control', toolName: 'get_snow_depth', params: { section: '경강선 강릉기점 인근' } },
        { serverId: 'snow-ice-control', toolName: 'get_rail_icing_status' },
        { serverId: 'snow-ice-control', toolName: 'request_deicing' }
      ],
      category: '기상·환경',
      difficulty: 'hard',
      source: 'manual',
      notes: '3단계 io 체인(적설량 실측→구간ID로 결빙 위험 판정→위험 시 제설 조치 요청). 구간ID를 이미 알고 있다면 적설량 조회를 생략하고 결빙 판정부터 시작하는 2단계 대안도 인정. 목표 도구는 최종 조치인 request_deicing.',
      alternatives: [
        [
          { serverId: 'snow-ice-control', toolName: 'get_rail_icing_status', params: { sectionId: 'SN-014' } },
          { serverId: 'snow-ice-control', toolName: 'request_deicing' }
        ]
      ],
      goal: { serverId: 'snow-ice-control', toolName: 'request_deicing' }
    },
    {
      id: 'bench-weather-9',
      query: '호남고속선 정읍 인근 교량 지진감지센서에 진동이 감지됐어. 규모부터 확인하고 경보 발령한 다음, 노선 전체 지진 영향평가도 같이 확인해줘',
      expected: [
        { serverId: 'rail-seismic-sensor', toolName: 'get_seismic_reading', params: { station: '호남고속선 정읍 인근 교량' } },
        { serverId: 'rail-seismic-sensor', toolName: 'issue_seismic_alert' },
        { serverId: 'disaster-alert', toolName: 'get_earthquake_impact' }
      ],
      category: '기상·환경',
      difficulty: 'hard',
      source: 'manual',
      notes: '3단계 흐름(센서 실측→sensorId로 경보 발령→노선 전체 지진 영향평가 교차 확인). 센서ID를 이미 알고 있다면 재난 영향평가를 먼저 보고 바로 경보를 발령하는 대안 순서도 인정. 목표 도구는 안전조치인 issue_seismic_alert.',
      alternatives: [
        [
          { serverId: 'disaster-alert', toolName: 'get_earthquake_impact' },
          { serverId: 'rail-seismic-sensor', toolName: 'issue_seismic_alert', params: { sensorId: 'EQ-S88' } }
        ]
      ],
      goal: { serverId: 'rail-seismic-sensor', toolName: 'issue_seismic_alert' }
    },
    {
      id: 'bench-weather-10',
      query: '태풍이 남부권으로 북상 중이라는데, 태풍 경로 예보랑 영남권 재난 특보 현황, 경부선 지진센서망 상태까지 한 번에 점검해줘',
      expected: [
        { serverId: 'wind-typhoon-guard', toolName: 'get_typhoon_forecast', params: { region: '남부권' } },
        { serverId: 'disaster-alert', toolName: 'get_disaster_alerts', params: { region: '영남권' } },
        { serverId: 'rail-seismic-sensor', toolName: 'get_sensor_network_status', params: { line: '경부선' } }
      ],
      category: '기상·환경',
      difficulty: 'hard',
      source: 'manual',
      notes: '서로 독립적인 세 조회(태풍 경로 예보, 지역 재난 특보, 노선 센서망 상태 점검)를 동시에 요청하는 종합 점검 질의. 세 도구 모두 호출됐는지만 확인하고 순서는 채점하지 않음.',
      ordered: false
    }
  ]
};
