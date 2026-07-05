// ============================================================================
// 물류·화물(物流·貨物) 분야 검증 세트 — 10문항
// 참조 서버: 기존 3개(freight-tracking, cargo-booking, rail-yard-manager)
//          + 신규 7개(container-fleet-manager, freight-car-allocator,
//            dangerous-goods-compliance, freight-rate-engine,
//            intermodal-transfer-hub, terminal-slot-scheduler,
//            customs-clearance-doc)
// 1단계 3문항 / 2단계 4문항 / 3단계 3문항, easy 3 / medium 4 / hard 3.
// ordered:false 3문항, alternatives 3문항, goal 4문항 반영.
// ============================================================================

export const BENCH_FREIGHT = {
  id: 'bench-set-freight',
  name: '물류·화물 검증 세트',
  description: '철도 물류·화물 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    {
      id: 'bench-freight-1',
      query: '운송장번호 CN-KR-778102 화물이 지금 어디까지 이동했는지 확인해줘',
      expected: [
        { serverId: 'freight-tracking', toolName: 'track_shipment', params: { trackingNo: 'CN-KR-778102' } }
      ],
      category: '물류·화물',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 도구 호출 기본 검증(화물 위치 추적). 여객열차 조회 도구와 혼동하지 않는지 확인.'
    },
    {
      id: 'bench-freight-2',
      query: '오봉 조차장 유치선별 점유 화차 수와 여유 용량을 알려줘',
      expected: [
        { serverId: 'rail-yard-manager', toolName: 'get_yard_status', params: { yard: '오봉' } }
      ],
      category: '물류·화물',
      difficulty: 'easy',
      source: 'manual',
      notes: '야드 유치선 점유 현황 단일 조회. 운송 예약이 아닌 야드 내 선로 현황 파악 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-freight-3',
      query: '제천에서 여수엑스포까지 유류 40톤 화물 운임을 견적받아줘',
      expected: [
        { serverId: 'cargo-booking', toolName: 'quote_freight', params: { from: '제천', to: '여수엑스포', cargoType: '유류', weightTon: 40 } }
      ],
      category: '물류·화물',
      difficulty: 'easy',
      source: 'manual',
      notes: '화물 운임 견적 단일 호출. 여객 요금 계산(fare-calculator)과 구분되는지, 화물종류·중량을 정확히 추출하는지 확인.'
    },
    {
      id: 'bench-freight-4',
      query: '부산신항 터미널 2026-07-06 하역 작업 슬롯 가용 현황을 확인하고, 제천 조차장 유치선 현황도 같이 알려줘',
      expected: [
        { serverId: 'terminal-slot-scheduler', toolName: 'get_slot_availability', params: { terminal: '부산신항', date: '2026-07-06' } },
        { serverId: 'rail-yard-manager', toolName: 'get_yard_status', params: { yard: '제천' } }
      ],
      category: '물류·화물',
      difficulty: 'medium',
      source: 'manual',
      notes: '서로 다른 두 서버에 대한 독립 병렬 조회(순서 무관). 터미널 슬롯 현황과 야드 현황을 모두 누락 없이 호출하는지 확인.',
      ordered: false
    },
    {
      id: 'bench-freight-5',
      query: '운송장번호 CN-KR-778102 화물의 현재 위치를 추적하고, 도착 예정 시각도 같이 확인해줘',
      expected: [
        { serverId: 'freight-tracking', toolName: 'track_shipment', params: { trackingNo: 'CN-KR-778102' } },
        { serverId: 'freight-tracking', toolName: 'estimate_freight_eta', params: { trackingNo: 'CN-KR-778102' } }
      ],
      category: '물류·화물',
      difficulty: 'medium',
      source: 'manual',
      notes: '동일 화물에 대한 두 조회(위치 추적·도착 예정)를 병렬 독립 호출로 처리하는지 확인(순서 무관).',
      ordered: false
    },
    {
      id: 'bench-freight-6',
      query: "의왕ICD에서 40ft HC 규격 가용 컨테이너를 찾아서 화주 '한국물류(주)' 이름으로 확보해줘",
      expected: [
        { serverId: 'container-fleet-manager', toolName: 'search_available_containers', params: { location: '의왕ICD', sizeType: '40ft HC' } },
        { serverId: 'container-fleet-manager', toolName: 'reserve_container', params: { containerId: 'CTR-40HC-8821', shipper: '한국물류(주)' } }
      ],
      category: '물류·화물',
      difficulty: 'medium',
      source: 'manual',
      notes: '2단계 컨테이너 확보 흐름(재고 검색→예약). 검색 결과의 containerId를 예약 호출에 일관되게 전달하는지 확인. 다른 가용 컨테이너를 선택해도 목표 달성으로 인정(대안 반영).',
      alternatives: [[
        { serverId: 'container-fleet-manager', toolName: 'search_available_containers', params: { location: '의왕ICD', sizeType: '40ft HC' } },
        { serverId: 'container-fleet-manager', toolName: 'reserve_container', params: { containerId: 'CTR-20GP-4410', shipper: '한국물류(주)' } }
      ]],
      goal: { serverId: 'container-fleet-manager', toolName: 'reserve_container' }
    },
    {
      id: 'bench-freight-7',
      query: "오봉에서 부산신항까지 컨테이너 화물 24톤 운임을 여러 운송사로 비교하고, 가장 유리한 조건으로 화주 '한국물류(주)' 명의로 확정해줘",
      expected: [
        { serverId: 'freight-rate-engine', toolName: 'compare_carrier_rates', params: { from: '오봉', to: '부산신항', cargoType: '컨테이너', weightTon: 24 } },
        { serverId: 'freight-rate-engine', toolName: 'lock_rate', params: { rateId: 'RT-20260705-0011', shipper: '한국물류(주)' } }
      ],
      category: '물류·화물',
      difficulty: 'medium',
      source: 'manual',
      notes: '2단계 운임 확정 흐름(운송사 비교→운임 잠금). 최저가가 아닌 다른 운송사 견적을 확정해도 목표 달성으로 인정(대안 반영).',
      alternatives: [[
        { serverId: 'freight-rate-engine', toolName: 'compare_carrier_rates', params: { from: '오봉', to: '부산신항', cargoType: '컨테이너', weightTon: 24 } },
        { serverId: 'freight-rate-engine', toolName: 'lock_rate', params: { rateId: 'RT-20260705-0012', shipper: '한국물류(주)' } }
      ]],
      goal: { serverId: 'freight-rate-engine', toolName: 'lock_rate' }
    },
    {
      id: 'bench-freight-8',
      query: "화물명 '황산'을 위험물로 분류하고, 탱크화차로 철도 운송이 가능한지 적격성을 확인한 다음, 오봉에서 부산신항까지 탱크화차 10량을 배정해줘",
      expected: [
        { serverId: 'dangerous-goods-compliance', toolName: 'classify_dangerous_goods', params: { cargoName: '황산' } },
        { serverId: 'dangerous-goods-compliance', toolName: 'check_transport_eligibility', params: { wagonType: '탱크화차' } },
        { serverId: 'freight-car-allocator', toolName: 'request_car_allocation', params: { cargoType: '위험물', quantity: 10, from: '오봉', to: '부산신항', wagonType: '탱크화차' } }
      ],
      category: '물류·화물',
      difficulty: 'hard',
      source: 'manual',
      notes: '3단계 위험물 운송 흐름(분류→적격성 확인→화차 배정). 화물명에서 위험물 여부를 인지하고, 화차 배정을 조차장 선로 배정(rail-yard-manager)과 구분하는지 확인.',
      goal: { serverId: 'freight-car-allocator', toolName: 'request_car_allocation' }
    },
    {
      id: 'bench-freight-9',
      query: '의왕ICD에서 40ft HC 가용 컨테이너를 찾아 확보한 다음, 부산신항 터미널에서 철도에서 해상으로 환적 일정을 예약해줘',
      expected: [
        { serverId: 'container-fleet-manager', toolName: 'search_available_containers', params: { location: '의왕ICD', sizeType: '40ft HC' } },
        { serverId: 'container-fleet-manager', toolName: 'reserve_container', params: { containerId: 'CTR-40HC-8821' } },
        { serverId: 'intermodal-transfer-hub', toolName: 'schedule_transload', params: { containerId: 'CTR-40HC-8821', fromMode: '철도', toMode: '해상', terminal: '부산신항' } }
      ],
      category: '물류·화물',
      difficulty: 'hard',
      source: 'manual',
      notes: '3단계 컨테이너 환적 흐름(재고 검색→예약→환적 일정). 예약과 환적 일정 등록을 혼동하지 않고 동일 containerId로 연결하는지 확인. 다른 가용 컨테이너로 진행해도 목표 달성 인정(대안 반영).',
      alternatives: [[
        { serverId: 'container-fleet-manager', toolName: 'search_available_containers', params: { location: '의왕ICD', sizeType: '40ft HC' } },
        { serverId: 'container-fleet-manager', toolName: 'reserve_container', params: { containerId: 'CTR-20GP-4410' } },
        { serverId: 'intermodal-transfer-hub', toolName: 'schedule_transload', params: { containerId: 'CTR-20GP-4410', fromMode: '철도', toMode: '해상', terminal: '부산신항' } }
      ]],
      goal: { serverId: 'intermodal-transfer-hub', toolName: 'schedule_transload' }
    },
    {
      id: 'bench-freight-10',
      query: '제천 조차장 유치선 점유 현황을 확인하고, 오봉에서 부산신항까지 시멘트 30톤 화물 운임을 견적받고, 운송장번호 CN-KR-9002 화물을 HS코드 2523.29·신고가액 1200만원으로 통관 신고까지 한번에 처리해줘',
      expected: [
        { serverId: 'rail-yard-manager', toolName: 'get_yard_status', params: { yard: '제천' } },
        { serverId: 'cargo-booking', toolName: 'quote_freight', params: { from: '오봉', to: '부산신항', cargoType: '시멘트', weightTon: 30 } },
        { serverId: 'customs-clearance-doc', toolName: 'submit_customs_declaration', params: { trackingNo: 'CN-KR-9002', hsCode: '2523.29', cargoType: '시멘트', declaredValue: 12000000 } }
      ],
      category: '물류·화물',
      difficulty: 'hard',
      source: 'manual',
      notes: '서로 다른 3개 서버(야드·화물예약·통관)에 대한 완전 독립 병렬 처리(순서 무관). 공통 데이터 의존이 없는 3개 요청을 모두 빠짐없이 처리하는지 확인.',
      ordered: false
    }
  ]
};
