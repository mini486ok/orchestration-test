// ============================================================================
// benchmarksExt/facility.js — 시설·유지보수 분야 검증 세트 (10문항)
// SPEC(계약서 v2 §10) 준수. serverId/toolName은 모두 실존 카탈로그 참조:
//  - 기존 3종: facility-asset-manager, rolling-stock-maintenance 등 신규 7종은
//    assets/js/data/mcpsExt/facility.js 참조.
//  - 기존 3종(track-maintenance, facility-asset-manager, catenary-power-monitor)은
//    assets/js/data/sampleMcps.js 참조.
//
// 난이도 분포: easy 3 / medium 4 / hard 3
// 단계 분포:   1단계 4 / 2단계 3 / 3단계 3
// 다중정답:    ordered:false 3문항(3,7,10), alternatives 3문항(1,4,9), goal 5문항(4,5,6,8,9)
// 핵심 io체인: 이상탐지(detect_anomaly)→assetId→작업지시생성(create_work_order)
//              →workOrderId→부품예약(reserve_parts)  (문항 8, 대안경로는 문항 9)
// ============================================================================

export const BENCH_FACILITY = {
  id: 'bench-set-facility',
  name: '시설·유지보수 검증 세트',
  description: '철도 시설·유지보수 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    {
      id: 'bench-facility-1',
      query: '부산역 스크린도어 자산 AST-PSD-1188의 현재 건전도 상태를 확인해줘',
      expected: [
        { serverId: 'facility-asset-manager', toolName: 'get_asset_status', params: { assetId: 'AST-PSD-1188' } }
      ],
      alternatives: [
        [
          { serverId: 'facility-asset-manager', toolName: 'get_asset_status', params: { station: '부산', facilityType: '스크린도어' } }
        ]
      ],
      category: '시설·유지보수',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 자산 상태 조회. assetId로 직접 조회하거나 station+facilityType 조합으로도 동일 자산을 찾을 수 있음(alternatives).'
    },
    {
      id: 'bench-facility-2',
      query: '차량 EMU-341-08의 대차·제동장치·팬터그래프 전체 건전도를 점검해줘',
      expected: [
        { serverId: 'rolling-stock-maintenance', toolName: 'get_vehicle_health', params: { vehicleNo: 'EMU-341-08', component: '전체' } }
      ],
      category: '시설·유지보수',
      difficulty: 'easy',
      source: 'manual',
      notes: '차량 전반 건전도 조회. 차륜 마모 세부 수치(get_wheel_wear)와 혼동하지 않고 전체 건전도 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-facility-3',
      query: '수원역과 대전역의 엘리베이터·에스컬레이터 가동 상태를 각각 확인해줘',
      expected: [
        { serverId: 'station-equipment-monitor', toolName: 'get_equipment_status', params: { station: '수원' } },
        { serverId: 'station-equipment-monitor', toolName: 'get_equipment_status', params: { station: '대전' } }
      ],
      ordered: false,
      category: '시설·유지보수',
      difficulty: 'easy',
      source: 'manual',
      notes: '서로 독립적인 두 역 설비 상태 조회. 호출 순서와 무관하게 두 건 모두 수행하는지 확인(ordered:false).'
    },
    {
      id: 'bench-facility-4',
      query: '경부선 천안~조치원 구간에 궤도 틀림이나 레일 마모 문제가 있는지 종합적으로 확인해줘',
      expected: [
        { serverId: 'track-geometry-monitor', toolName: 'get_geometry_alert', params: { line: '경부선' } }
      ],
      alternatives: [
        [
          { serverId: 'track-geometry-monitor', toolName: 'measure_track_geometry', params: { line: '경부선', section: '천안~조치원' } },
          { serverId: 'track-geometry-monitor', toolName: 'get_rail_wear', params: { line: '경부선', section: '천안~조치원' } }
        ]
      ],
      goal: { serverId: 'track-geometry-monitor', toolName: 'get_geometry_alert' },
      category: '시설·유지보수',
      difficulty: 'medium',
      source: 'manual',
      notes: '경보 스크리닝 도구 한 번으로 답할 수도, 계측값과 마모량을 각각 조회해 직접 판단할 수도 있음(alternatives).'
    },
    {
      id: 'bench-facility-5',
      query: '수원역 지하 1층 환승통로 에스컬레이터 EQ-SW-ES05가 멈췄어. 고장을 접수하고 작업지시도 만들어줘',
      expected: [
        { serverId: 'station-equipment-monitor', toolName: 'report_equipment_fault', params: { equipmentId: 'EQ-SW-ES05', faultType: '정지' } },
        { serverId: 'work-order-manager', toolName: 'create_work_order', params: { sourceType: '설비고장', station: '수원' } }
      ],
      goal: { serverId: 'work-order-manager', toolName: 'create_work_order' },
      category: '시설·유지보수',
      difficulty: 'medium',
      source: 'manual',
      notes: '2단계 순서 민감 흐름(고장 신고→작업지시 생성). create_work_order의 sourceId에는 report_equipment_fault가 반환한 reportId가 들어가야 하므로 신고가 먼저 이뤄져야 함.'
    },
    {
      id: 'bench-facility-6',
      query: '교량 STR-BR-0421에서 균열이 발견됐어. 긴급 결함으로 보고하고 작업지시서를 생성해줘',
      expected: [
        { serverId: 'structure-inspection', toolName: 'report_structure_finding', params: { structureId: 'STR-BR-0421', findingType: '균열', severity: '긴급' } },
        { serverId: 'work-order-manager', toolName: 'create_work_order', params: { sourceType: '구조점검', assetId: 'STR-BR-0421' } }
      ],
      goal: { serverId: 'work-order-manager', toolName: 'create_work_order' },
      category: '시설·유지보수',
      difficulty: 'medium',
      source: 'manual',
      notes: '구조점검 결함 보고 후 작업지시로 이어지는 순서 민감 흐름. report_structure_finding의 findingId를 create_work_order의 sourceId로 전달하는 체이닝을 전제로 함.'
    },
    {
      id: 'bench-facility-7',
      query: 'EMU-341-08 차량의 전체 건전도와 차륜 마모 상태를 함께 확인해줘',
      expected: [
        { serverId: 'rolling-stock-maintenance', toolName: 'get_vehicle_health', params: { vehicleNo: 'EMU-341-08', component: '전체' } },
        { serverId: 'rolling-stock-maintenance', toolName: 'get_wheel_wear', params: { vehicleNo: 'EMU-341-08' } }
      ],
      ordered: false,
      category: '시설·유지보수',
      difficulty: 'medium',
      source: 'manual',
      notes: '동일 차량에 대한 두 개의 독립적 조회(건전도·차륜마모). 서로 의존관계가 없어 순서 무관(ordered:false).'
    },
    {
      id: 'bench-facility-8',
      query: '최근 60분 이내 감지된 예지보전 이상 징후를 확인하고, 있으면 작업지시를 생성한 다음 필요한 제동패드 부품까지 예약해줘',
      expected: [
        { serverId: 'predictive-maintenance-sensor', toolName: 'detect_anomaly', params: { sinceMin: 60 } },
        { serverId: 'work-order-manager', toolName: 'create_work_order', params: { sourceType: '예지보전' } },
        { serverId: 'spare-parts-inventory', toolName: 'reserve_parts', params: { partNo: 'PT-BRK-2201' } }
      ],
      goal: { serverId: 'spare-parts-inventory', toolName: 'reserve_parts' },
      category: '시설·유지보수',
      difficulty: 'hard',
      source: 'manual',
      notes: '핵심 3단계 io체인(이상탐지→assetId→작업지시생성→workOrderId→부품예약). detect_anomaly가 반환한 assetId를 create_work_order의 assetId로, create_work_order가 반환한 workOrderId를 reserve_parts의 workOrderId로 전달해야 하는 순서 민감 흐름.'
    },
    {
      id: 'bench-facility-9',
      query: '교량 받침 AST-BR-0421의 잔존수명을 예측해보고, 임계 수준이면 작업지시를 만들고 필요한 부품도 예약해줘',
      expected: [
        { serverId: 'predictive-maintenance-sensor', toolName: 'get_remaining_useful_life', params: { assetId: 'AST-BR-0421', component: '교량 받침' } },
        { serverId: 'work-order-manager', toolName: 'create_work_order', params: { sourceType: '예지보전', assetId: 'AST-BR-0421' } },
        { serverId: 'spare-parts-inventory', toolName: 'reserve_parts' }
      ],
      alternatives: [
        [
          { serverId: 'predictive-maintenance-sensor', toolName: 'detect_anomaly', params: { assetId: 'AST-BR-0421' } },
          { serverId: 'work-order-manager', toolName: 'create_work_order', params: { sourceType: '예지보전', assetId: 'AST-BR-0421' } },
          { serverId: 'spare-parts-inventory', toolName: 'reserve_parts' }
        ]
      ],
      goal: { serverId: 'spare-parts-inventory', toolName: 'reserve_parts' },
      category: '시설·유지보수',
      difficulty: 'hard',
      source: 'manual',
      notes: '잔존수명 예측(get_remaining_useful_life) 또는 이상탐지(detect_anomaly) 어느 쪽으로 시작해도 동일하게 작업지시→부품예약으로 이어질 수 있음(alternatives). 두 경우 모두 assetId를 세 단계에 일관되게 유지해야 함.'
    },
    {
      id: 'bench-facility-10',
      query: '교량 AST-BR-0421에 대해 구조 상태, 센서 이상탐지, 부품 잔존수명 예측을 모두 확인해줘',
      expected: [
        { serverId: 'structure-inspection', toolName: 'get_structure_condition', params: { structureType: '교량', structureId: 'AST-BR-0421' } },
        { serverId: 'predictive-maintenance-sensor', toolName: 'detect_anomaly', params: { assetId: 'AST-BR-0421' } },
        { serverId: 'predictive-maintenance-sensor', toolName: 'get_remaining_useful_life', params: { assetId: 'AST-BR-0421', component: '교량 받침' } }
      ],
      ordered: false,
      category: '시설·유지보수',
      difficulty: 'hard',
      source: 'manual',
      notes: '동일 자산에 대한 세 개의 독립적 조회(구조상태·이상탐지·잔존수명 예측). 서로 의존관계 없이 병렬 수행 가능하므로 순서 무관(ordered:false).'
    }
  ]
};
