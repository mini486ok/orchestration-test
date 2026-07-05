// ============================================================================
// benchmarksExt/safety.js — 안전·관제 분야 검증 세트 (10문항)
// SPEC §10(계약서) 규격 준수. 순수 ES module.
//
// 참조 서버(안전·관제 분야, 총 10개):
//  ● 기존 3개: signal-control, track-safety-monitor, emergency-dispatch
//  ● 신규 7개: level-crossing-monitor, perimeter-intrusion-detector, atp-atc-monitor,
//              safety-cctv-control, overspeed-enforcement, evacuation-guidance, hazmat-watch
//
// 구성: 1단계 질의 4개(easy, #1~#4) + 2단계 체인 4개(medium, #5~#8) + 3단계 체인 2개(hard, #9~#10).
// 다중 정답: ordered:false 2문항(#5, #8) + alternatives 2문항(#7, #10) = 4문항. goal은 #6,7,9,10에 명시.
// io 체이닝: 침입감지(perimeter-intrusion-detector)→eventId→CCTV영상(safety-cctv-control) [#6],
//            위험물manifest→wagonNo→센서감시→사고신고(hazmat-watch) [#9],
//            과속판정→위반통보(overspeed-enforcement) [#7],
//            사고접수(emergency-dispatch)→incidentId→대피발령→상태확인(evacuation-guidance) [#10].
// ============================================================================

export const BENCH_SAFETY = {
  id: 'bench-set-safety',
  name: '안전·관제 검증 세트',
  description: '철도 안전·관제 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    // ------------------------------------------------------------------
    // 1단계 질의 (easy) — 4문항
    // ------------------------------------------------------------------
    {
      id: 'bench-safety-1',
      query: '대전조차장 신호기들이 지금 어떤 현시 상태인지 확인해줘',
      expected: [
        { serverId: 'signal-control', toolName: 'get_signal_status', params: { station: '대전조차장' } }
      ],
      category: '안전·관제',
      difficulty: 'easy',
      source: 'manual',
      notes: '지상 신호기 현시 상태 단일 조회. 진로·연동장치 조회(get_interlocking)나 장애 신고(report_signal_fault)와 혼동하지 않는지 확인.'
    },
    {
      id: 'bench-safety-2',
      query: '중앙선에서 최근 낙석이나 지장물이 감지된 적 있는지 확인해줘',
      expected: [
        { serverId: 'track-safety-monitor', toolName: 'detect_obstacle', params: { line: '중앙선' } }
      ],
      category: '안전·관제',
      difficulty: 'easy',
      source: 'manual',
      notes: '선로 지장물 감지 이력 단일 조회. 선로 점유(get_track_occupancy)나 서행구간(get_speed_restriction) 조회와 구분하는지 확인.'
    },
    {
      id: 'bench-safety-3',
      query: '화물열차 F-3012에 실려 있는 위험물 화차의 유엔번호랑 등급 좀 알려줘',
      expected: [
        { serverId: 'hazmat-watch', toolName: 'get_hazmat_manifest', params: { trainNo: 'F-3012' } }
      ],
      category: '안전·관제',
      difficulty: 'easy',
      source: 'manual',
      notes: '위험물 적재 명세 단일 조회. 일반 화물 추적과 구분되는 전용 위험물 명세 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-safety-4',
      query: 'KTX 101 열차 ATP 방호장치가 지금 정상적으로 활성화돼 있는지 확인해줘',
      expected: [
        { serverId: 'atp-atc-monitor', toolName: 'get_atp_status', params: { trainNo: 'KTX 101' } }
      ],
      category: '안전·관제',
      difficulty: 'easy',
      source: 'manual',
      notes: '차상 ATP/ATC 작동 모드 단일 조회. 지상 신호기 현시(signal-control)와 혼동하지 않고 차상 방호장치 상태를 선택하는지 확인.'
    },

    // ------------------------------------------------------------------
    // 2단계 체인 (medium) — 4문항
    // ------------------------------------------------------------------
    {
      id: 'bench-safety-5',
      query: '선로 경계 구역 ZN-경부-014에 침입 감지 이벤트가 있었는지랑 그 구역 센서들이 정상 작동 중인지 같이 확인해줘',
      expected: [
        { serverId: 'perimeter-intrusion-detector', toolName: 'detect_intrusion', params: { zoneId: 'ZN-경부-014' } },
        { serverId: 'perimeter-intrusion-detector', toolName: 'get_zone_sensor_health', params: { zoneId: 'ZN-경부-014' } }
      ],
      ordered: false,
      category: '안전·관제',
      difficulty: 'medium',
      source: 'manual',
      notes: '침입 이벤트 조회와 센서 헬스체크는 서로 독립적인 병렬 질의라 호출 순서 무관. 두 도구 모두 zoneId를 동일하게 채워 호출하는지 확인.'
    },
    {
      id: 'bench-safety-6',
      query: 'ZN-경부-014 구역에서 감지된 침입 이벤트를 확인하고, 그 이벤트의 CCTV 녹화 영상도 같이 찾아줘',
      expected: [
        { serverId: 'perimeter-intrusion-detector', toolName: 'detect_intrusion', params: { zoneId: 'ZN-경부-014' } },
        { serverId: 'safety-cctv-control', toolName: 'get_event_clip', params: { eventId: 'INT-20260705-011' } }
      ],
      goal: { serverId: 'safety-cctv-control', toolName: 'get_event_clip' },
      category: '안전·관제',
      difficulty: 'medium',
      source: 'manual',
      notes: 'detect_intrusion 결과 이벤트 목록의 eventId를 get_event_clip 입력으로 그대로 연결하는 io 체이닝. 이벤트ID를 임의로 지어내지 않고 1단계 결과를 재사용하는지 확인.'
    },
    {
      id: 'bench-safety-7',
      query: 'KTX 101 열차가 천안아산~오송 구간에서 과속했는지 확인하고, 위반이 맞으면 관제실에 통보해줘',
      expected: [
        { serverId: 'overspeed-enforcement', toolName: 'check_overspeed', params: { trainNo: 'KTX 101', section: '천안아산~오송' } },
        { serverId: 'overspeed-enforcement', toolName: 'notify_violation', params: { trainNo: 'KTX 101', section: '천안아산~오송', excessKmh: 12 } }
      ],
      alternatives: [
        [
          { serverId: 'atp-atc-monitor', toolName: 'get_onboard_target_speed', params: { trainNo: 'KTX 101' } },
          { serverId: 'overspeed-enforcement', toolName: 'check_overspeed', params: { trainNo: 'KTX 101', section: '천안아산~오송', limitKmh: 300 } },
          { serverId: 'overspeed-enforcement', toolName: 'notify_violation', params: { trainNo: 'KTX 101', section: '천안아산~오송', excessKmh: 12 } }
        ]
      ],
      goal: { serverId: 'overspeed-enforcement', toolName: 'notify_violation' },
      category: '안전·관제',
      difficulty: 'medium',
      source: 'manual',
      notes: '과속 판정→통보의 2단계가 기본 정답. 차상 목표속도(maxAllowedKmh)를 먼저 조회해 제한속도를 확인한 뒤 판정·통보하는 3단계 경로도 동일 목표(notify_violation) 달성으로 인정.'
    },
    {
      id: 'bench-safety-8',
      query: '건널목 CR-105의 차단기 작동 상태랑 최근 이벤트 이력을 같이 확인해줘',
      expected: [
        { serverId: 'level-crossing-monitor', toolName: 'get_crossing_status', params: { crossingId: 'CR-105' } },
        { serverId: 'level-crossing-monitor', toolName: 'get_crossing_events', params: { crossingId: 'CR-105' } }
      ],
      ordered: false,
      category: '안전·관제',
      difficulty: 'medium',
      source: 'manual',
      notes: '차단기 실시간 상태 조회와 이벤트 이력 조회는 서로 독립적인 병렬 질의라 순서 무관. 두 도구 모두 crossingId를 동일하게 채워 호출하는지 확인.'
    },

    // ------------------------------------------------------------------
    // 3단계 체인 (hard) — 2문항
    // ------------------------------------------------------------------
    {
      id: 'bench-safety-9',
      query: '화물열차 F-3012의 위험물 화차 명세를 확인하고, 각 화차 센서 상태를 감시해서 누출이 감지되면 위험물 사고로 신고해줘',
      expected: [
        { serverId: 'hazmat-watch', toolName: 'get_hazmat_manifest', params: { trainNo: 'F-3012' } },
        { serverId: 'hazmat-watch', toolName: 'monitor_hazmat_sensor', params: { wagonNo: 'WG-77201' } },
        { serverId: 'hazmat-watch', toolName: 'report_hazmat_incident', params: { wagonNo: 'WG-77201', incidentType: '누출' } }
      ],
      goal: { serverId: 'hazmat-watch', toolName: 'report_hazmat_incident' },
      category: '안전·관제',
      difficulty: 'hard',
      source: 'manual',
      notes: 'get_hazmat_manifest 결과의 wagonNo를 monitor_hazmat_sensor·report_hazmat_incident에 순서대로 이어 쓰는 3단계 io 체이닝. 센서 감시로 누출을 확인한 뒤에만 사고 신고로 넘어가므로 순서가 중요.'
    },
    {
      id: 'bench-safety-10',
      query: '동대구역 3번 승강장에서 화재가 발생해서 사고를 접수하고, 그 사고번호로 대피 방송을 발령한 뒤 대피가 얼마나 진행됐는지 확인해줘',
      expected: [
        { serverId: 'emergency-dispatch', toolName: 'report_incident', params: { location: '동대구역 3번 승강장', incidentType: '화재' } },
        { serverId: 'evacuation-guidance', toolName: 'trigger_evacuation', params: { location: '동대구역 3번 승강장', reason: '화재', incidentId: 'INC-20260704-0007' } },
        { serverId: 'evacuation-guidance', toolName: 'get_evacuation_status', params: { evacuationId: 'EVQ-20260705-004' } }
      ],
      alternatives: [
        [
          { serverId: 'evacuation-guidance', toolName: 'trigger_evacuation', params: { location: '동대구역 3번 승강장', reason: '화재' } },
          { serverId: 'evacuation-guidance', toolName: 'get_evacuation_status', params: { evacuationId: 'EVQ-20260705-004' } }
        ]
      ],
      goal: { serverId: 'evacuation-guidance', toolName: 'get_evacuation_status' },
      category: '안전·관제',
      difficulty: 'hard',
      source: 'manual',
      notes: 'report_incident 결과의 incidentId를 trigger_evacuation의 incidentId로 연계하고, trigger_evacuation 결과의 evacuationId를 get_evacuation_status로 이어주는 3단계 io 체이닝. 사고 접수(report_incident) 없이 화재 상황에서 곧바로 대피부터 발령하고 상태만 확인하는 2단계 대안도 동일 목표(get_evacuation_status) 달성으로 인정.'
    }
  ]
};
