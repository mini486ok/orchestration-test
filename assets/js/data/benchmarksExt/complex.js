// ============================================================================
// benchmarksExt/complex.js — 복합 시나리오 검증 세트 (30문항)
// 각 문항은 서로 다른 MCP 서버 3개 이상(3~5단계)을 조합해야 풀리는 복합 질의.
// 분야 간 교차(기상→운행→예매, 안전→시설→작업지시 등) 오케스트레이션을 검증한다.
// 다중 정답: ordered:false(순서 무관) / alternatives(대안 워크플로우) / goal(목표 도구).
// ============================================================================

export const BENCH_COMPLEX = {
  id: 'bench-set-complex',
  name: '복합 시나리오 검증 세트',
  description: '서로 다른 MCP 서버 3개 이상을 조합해야 하는 복합 질의 30문항 — 분야 교차 오케스트레이션 검증',
  createdAt: '2026-07-06T00:00:00Z',
  items: [
// --------------------------------------------------------------------
  // 1. 기상 × 운행정보 × 예매(환불) — 3서버 3단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-1',
    query: '내일(7월 7일) 태풍이 남부권을 지나간다던데, 남부권 태풍 예보를 확인하고 지금 경부선 쪽에 운행 중단이나 우회 같은 중대 차질이 있는지도 봐줘. 상황이 심각하면 내가 끊어둔 부산행 KTX 승차권 TK-20260707-B2201이 환불 가능한지, 수수료는 얼마나 되는지 확인해줘.',
    expected: [
      { serverId: 'wind-typhoon-guard', toolName: 'get_typhoon_forecast', params: { region: '남부권' } },
      { serverId: 'train-delay-monitor', toolName: 'get_disruptions', params: { region: '경부선' } },
      { serverId: 'fare-refund-center', toolName: 'check_refund_eligibility', params: { ticketId: 'TK-20260707-B2201' } }
    ],
    alternatives: [
      [
        { serverId: 'disaster-alert', toolName: 'get_disaster_alerts', params: { region: '남부권' } },
        { serverId: 'train-delay-monitor', toolName: 'get_disruptions', params: { region: '경부선' } },
        { serverId: 'fare-refund-center', toolName: 'check_refund_eligibility', params: { ticketId: 'TK-20260707-B2201' } }
      ]
    ],
    goal: { serverId: 'fare-refund-center', toolName: 'check_refund_eligibility' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '기상→운행정보→예매환불로 이어지는 분야 교차 3단계. 태풍 예보(기상 서버)와 중대 운행 차질(지연 모니터)을 확인한 뒤 발권 승차권의 환불 자격 조회로 마무리. 태풍 예보 대신 재난특보 서버(disaster-alert)로 시작하는 대안 체인도 서버 3개로 정답 인정.'
  },

  // --------------------------------------------------------------------
  // 2. 시설: 예지보전 → 작업지시 → 부품 — 3서버 5단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-2',
    query: '교량 자산 AST-BR-0421의 센서에서 이상 징후가 잡혔는지 최근 이상 탐지 내역을 확인하고, 문제가 있으면 교량 받침 부품의 잔존수명을 예측해줘. 정비가 필요하면 예지보전 건으로 작업지시서를 만들어서 필요한 자재 목록을 확인하고, 그 부품을 재고에서 예약까지 해줘.',
    expected: [
      { serverId: 'predictive-maintenance-sensor', toolName: 'detect_anomaly', params: { assetId: 'AST-BR-0421' } },
      { serverId: 'predictive-maintenance-sensor', toolName: 'get_remaining_useful_life', params: { assetId: 'AST-BR-0421', component: '교량 받침' } },
      { serverId: 'work-order-manager', toolName: 'create_work_order', params: { sourceType: '예지보전' } },
      { serverId: 'work-order-manager', toolName: 'get_work_order' },
      { serverId: 'spare-parts-inventory', toolName: 'reserve_parts' }
    ],
    goal: { serverId: 'spare-parts-inventory', toolName: 'reserve_parts' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '시설 유지보수 정석 체인: 이상탐지(anomalyId)→잔존수명 예측→작업지시 생성(sourceId 주입)→작업지시 상세의 requiredParts 확인→부품 재고 예약. create_work_order의 sourceId/description, get_work_order의 workOrderId, reserve_parts의 workOrderId/partNo/quantity는 모두 이전 단계 출력에서 체인 주입.'
  },

  // --------------------------------------------------------------------
  // 3. 물류: 위험물 컴플라이언스 → 화차배정 → 통관 — 3서버 4단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-3',
    query: '수출용 질산암모늄 30톤을 오봉역에서 부산신항까지 철도로 보내야 해. 먼저 UN번호로 위험물을 분류하고 철도 운송이 가능한지와 어떤 화차 형식이 필요한지 확인한 다음, 화차 3량 배정을 요청하고, HS코드 3102.30, 신고가액 4,500만 원으로 수출 통관 신고까지 접수해줘.',
    expected: [
      { serverId: 'dangerous-goods-compliance', toolName: 'classify_dangerous_goods', params: { cargoName: '질산암모늄' } },
      { serverId: 'dangerous-goods-compliance', toolName: 'check_transport_eligibility' },
      { serverId: 'freight-car-allocator', toolName: 'request_car_allocation', params: { cargoType: '위험물', quantity: 3, from: '오봉', to: '부산신항' } },
      { serverId: 'customs-clearance-doc', toolName: 'submit_customs_declaration', params: { hsCode: '3102.30', cargoType: '질산암모늄', declaredValue: 45000000 } }
    ],
    goal: { serverId: 'customs-clearance-doc', toolName: 'submit_customs_declaration' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '위험물 수출 물류 체인: 분류(unNumber)→운송 적합성·요구 화차형식 확인(unNumber 주입)→화차 배정 요청→통관 신고 접수. check_transport_eligibility의 unNumber와 submit_customs_declaration의 trackingNo는 체인 주입이라 생략.'
  },

  // --------------------------------------------------------------------
  // 4. 물류: 운임 비교 → 컨테이너 확보 → 터미널 슬롯 — 3서버 5단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-4',
    query: '오봉에서 부산신항으로 컨테이너 화물 24톤을 보내려고 해. 운송사별 운임을 비교해서 가장 저렴한 요율을 한빛물류 명의로 잠가두고, 의왕ICD에서 쓸 수 있는 40ft 컨테이너를 찾아 확보해줘. 그리고 7월 9일 부산신항 터미널 하역 슬롯이 비는 시간대도 확인해줘.',
    expected: [
      { serverId: 'freight-rate-engine', toolName: 'compare_carrier_rates', params: { from: '오봉', to: '부산신항', cargoType: '컨테이너', weightTon: 24 } },
      { serverId: 'freight-rate-engine', toolName: 'lock_rate', params: { shipper: '한빛물류' } },
      { serverId: 'container-fleet-manager', toolName: 'search_available_containers', params: { location: '의왕ICD', sizeType: '40ft' } },
      { serverId: 'container-fleet-manager', toolName: 'reserve_container', params: { shipper: '한빛물류' } },
      { serverId: 'terminal-slot-scheduler', toolName: 'get_slot_availability', params: { terminal: '부산신항', date: '2026-07-09' } }
    ],
    alternatives: [
      [
        { serverId: 'cargo-booking', toolName: 'quote_freight', params: { from: '오봉', to: '부산신항', cargoType: '컨테이너', weightTon: 24 } },
        { serverId: 'cargo-booking', toolName: 'book_freight', params: { shipper: '한빛물류' } },
        { serverId: 'container-fleet-manager', toolName: 'search_available_containers', params: { location: '의왕ICD', sizeType: '40ft' } },
        { serverId: 'container-fleet-manager', toolName: 'reserve_container', params: { shipper: '한빛물류' } },
        { serverId: 'terminal-slot-scheduler', toolName: 'get_slot_availability', params: { terminal: '부산신항', date: '2026-07-09' } }
      ]
    ],
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '화물 견적·자산 확보·터미널 작업 계획을 잇는 물류 체인. 정석은 복수 운송사 비교 견적(rateId)→요율 잠금→컨테이너 검색(containerId)→예약→슬롯 가용 확인. 기존 cargo-booking의 단일 견적(quoteId)→운송 예약으로 요율을 확정하는 대안 체인(서버 3개)도 정답 인정.'
  },

  // --------------------------------------------------------------------
  // 5. 안전: 침입 감지 → CCTV → 사고 접수 → 대피 — 4서버 4단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-5',
    query: '경부선 감시구역 ZN-경부-014에서 침입 경보가 울렸어. 최근 침입 이벤트를 확인하고 해당 이벤트의 CCTV 녹화 클립을 확보해줘. 실제 사람이 선로에 들어간 거면 금천구청역 인근 선로 인명 위험으로 관제센터에 사고를 접수하고, 금천구청역 승강장에 대피 경보도 발령해줘.',
    expected: [
      { serverId: 'perimeter-intrusion-detector', toolName: 'detect_intrusion', params: { zoneId: 'ZN-경부-014' } },
      { serverId: 'safety-cctv-control', toolName: 'get_event_clip' },
      { serverId: 'emergency-dispatch', toolName: 'report_incident', params: { location: '금천구청역 인근 선로', incidentType: '인명' } },
      { serverId: 'evacuation-guidance', toolName: 'trigger_evacuation', params: { location: '금천구청역 승강장', reason: '기타' } }
    ],
    goal: { serverId: 'evacuation-guidance', toolName: 'trigger_evacuation' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '안전 사고 대응 4서버 체인: 침입 이벤트 조회(eventId)→CCTV 클립 확보(eventId 주입)→비상 사고 접수(incidentId 발급)→대피 발령(incidentId 연계 가능). 각 단계가 이전 출력에 의존하므로 순서 유지. trigger_evacuation의 reason enum(화재/침수/유해가스/기타)에서 침입은 기타로 매핑.'
  },

  // --------------------------------------------------------------------
  // 6. 재난기상 × 안전 × 시설: 지진 대응 — 4서버 5단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-6',
    query: '방금 경주 쪽에 지진이 났다는데, 규모 3.0 이상 지진의 노선 영향 평가를 확인하고, 동해선 42호 교량의 지진 센서 실측값을 조회해줘. 수치가 심상치 않으면 그 센서 기준으로 지진 경보를 발령하고, 동해선의 서행(속도제한) 구간을 확인한 다음, 그 교량에 대해 7월 8일 드론 정밀점검 일정을 잡아줘.',
    expected: [
      { serverId: 'disaster-alert', toolName: 'get_earthquake_impact', params: { minMagnitude: 3.0 } },
      { serverId: 'rail-seismic-sensor', toolName: 'get_seismic_reading', params: { station: '동해선 42호 교량' } },
      { serverId: 'rail-seismic-sensor', toolName: 'issue_seismic_alert' },
      { serverId: 'track-safety-monitor', toolName: 'get_speed_restriction', params: { line: '동해선' } },
      { serverId: 'structure-inspection', toolName: 'schedule_structure_inspection', params: { structureType: '교량', method: '드론', date: '2026-07-08' } }
    ],
    goal: { serverId: 'structure-inspection', toolName: 'schedule_structure_inspection' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '지진 재난 대응 4서버 체인: 지역 지진 영향 평가→개별 센서 실측(sensorId)→센서 기준 경보 발령(sensorId 주입)→서행 구간 확인→교량 드론 정밀점검 예약. issue_seismic_alert의 sensorId와 schedule_structure_inspection의 structureId는 앞 단계 출력·맥락에서 체인 주입.'
  },

  // --------------------------------------------------------------------
  // 7. 요금: 운임 계산 → 할인 → 결제 → 영수증 — 4서버 5단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-7',
    query: '만 68세이신 아버지의 서울에서 부산까지 KTX 일반실 운임을 계산하고, 경로 할인 자격을 판정해서 할인 코드를 적용한 최종 요금을 산출해줘. 그 금액을 신용카드로 결제하고 지출증빙용 영수증까지 발행해줘.',
    expected: [
      { serverId: 'fare-calculator', toolName: 'calculate_fare', params: { from: '서울', to: '부산', trainType: 'KTX', seatClass: '일반실' } },
      { serverId: 'discount-subsidy-calculator', toolName: 'calculate_discount_eligibility', params: { category: '경로', age: 68 } },
      { serverId: 'discount-subsidy-calculator', toolName: 'apply_combined_discount' },
      { serverId: 'payment-gateway', toolName: 'process_payment', params: { method: '신용카드' } },
      { serverId: 'invoice-receipt-manager', toolName: 'issue_receipt', params: { issueType: '지출증빙' } }
    ],
    goal: { serverId: 'invoice-receipt-manager', toolName: 'issue_receipt' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '요금 분야 4서버 결제 파이프라인: 운임 계산(baseFare)→할인 자격 판정(discountCode)→중복 할인 적용(finalFare)→결제 승인(transactionId)→영수증 발행. apply_combined_discount의 baseFare/discountCode, process_payment의 amount, issue_receipt의 transactionId는 체인 주입.'
  },

  // --------------------------------------------------------------------
  // 8. 분석: OD 행렬 → 부하 시뮬레이션 → 혼잡 예측 → 피크 분석 — 4서버 4단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-8',
    query: '지난 토요일(7월 4일)의 전체 역 간 OD 매트릭스를 만들어서 다음 토요일(7월 11일) 기준 네트워크 부하를 시뮬레이션해줘. 병목으로 나온 서울역은 시간대별 혼잡도 예측이랑 6월 피크시간 분석까지 뽑아줘.',
    expected: [
      { serverId: 'od-matrix-analyzer', toolName: 'build_full_od_matrix', params: { date: '2026-07-04' } },
      { serverId: 'passenger-flow-simulator', toolName: 'simulate_network_load', params: { date: '2026-07-11' } },
      { serverId: 'crowding-prediction', toolName: 'predict_station_crowding' },
      { serverId: 'ridership-analytics', toolName: 'get_peak_analysis', params: { station: '서울', month: '2026-06' } }
    ],
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '데이터분석 4서버 체인: OD 행렬 생성(odPairs)→네트워크 부하 시뮬레이션(odPairs 주입, 병목 stationId 산출)→병목역 혼잡도 예측(stationId 주입)→동일 역 피크타임 분석. predict_station_crowding의 stationId는 시뮬레이션 결과의 병목역에서 체인 주입.'
  },

  // --------------------------------------------------------------------
  // 9. 분석 병렬: 수요 예측 + 정시율 + 수익 — 3서버 3단계 (순서 무관)
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-9',
    query: '다음 주말 증편 검토 자료가 필요해. 7월 11일 경부고속선 수요 예측, 6월 한 달(6월 1일~30일) 경부고속선 정시율, 그리고 같은 기간 KTX-경부선 수익 요약을 각각 뽑아줘.',
    expected: [
      { serverId: 'demand-forecast', toolName: 'forecast_demand', params: { line: '경부고속선', date: '2026-07-11' } },
      { serverId: 'punctuality-analytics', toolName: 'get_punctuality', params: { line: '경부고속선', from: '2026-06-01', to: '2026-06-30' } },
      { serverId: 'revenue-analytics', toolName: 'get_revenue_summary', params: { lineId: 'KTX-경부선', startDate: '2026-06-01', endDate: '2026-06-30' } }
    ],
    ordered: false,
    category: '복합',
    difficulty: 'medium',
    source: 'manual',
    notes: '증편 의사결정용 자료 수집. 미래 수요 예측·과거 정시율·과거 수익은 서로 독립적인 조회라 호출 순서 무관(병렬 가능). 세 분석 서버를 각각 정확한 기간 파라미터로 호출하는지 확인.'
  },

  // --------------------------------------------------------------------
  // 10. 기상 × 시설 × 여객: 폭염 대응 — 3서버 4단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-10',
    query: '폭염이 심한데 대구역 야외승강장의 열지수를 확인하고, 그 역의 폭염 경보 단계와 온열 대응 조치 현황을 봐줘. 경보 단계면 대구역 대합실 공조를 냉방 24도로 설정하고, "폭염으로 승강장 대기 시 대합실을 이용해 주시기 바랍니다" 안내문을 영어로 번역해줘.',
    expected: [
      { serverId: 'heatwave-uv-monitor', toolName: 'get_heat_index', params: { station: '대구역 야외승강장' } },
      { serverId: 'heatwave-uv-monitor', toolName: 'get_platform_heat_alert' },
      { serverId: 'station-equipment-monitor', toolName: 'set_hvac_schedule', params: { station: '대구', zone: '대합실', mode: '냉방', targetTemp: 24 } },
      { serverId: 'multilingual-passenger-guide', toolName: 'translate_announcement', params: { text: '폭염으로 승강장 대기 시 대합실을 이용해 주시기 바랍니다', targetLang: '영어' } }
    ],
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '폭염 대응 분야 교차 체인: 열지수 실측(stationId)→폭염 경보·조치 확인(stationId 주입)→역사 공조 냉방 설정→외국인 승객용 안내문 번역. 기상 관측이 시설 제어와 여객 안내 조치로 이어지는 흐름.'
  },

  // --------------------------------------------------------------------
  // 11. 도시교통 × 운행정보 병렬: P&R + EV충전 + 열차 검색 — 3서버 3단계 (순서 무관)
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-11',
    query: '내일(7월 7일) 아침 전기차를 몰고 광명역으로 가서 부산행 KTX를 탈 거야. 광명역 근처 환승주차장, 광명역 인근 급속 충전소, 그리고 내일 오전 8시 이후 광명에서 부산 가는 KTX 편성을 각각 알아봐줘.',
    expected: [
      { serverId: 'park-and-ride', toolName: 'find_lots_near_station', params: { station: '광명' } },
      { serverId: 'ev-charging-network', toolName: 'find_charging_stations', params: { station: '광명', connectorType: '급속' } },
      { serverId: 'kr-train-schedule', toolName: 'search_trains', params: { from: '광명', to: '부산', date: '2026-07-07', departAfter: '08:00', trainType: 'KTX' } }
    ],
    ordered: false,
    category: '복합',
    difficulty: 'medium',
    source: 'manual',
    notes: '자가용(EV)→철도 환승 여정 준비. 주차장 탐색·충전소 탐색·열차 시간표 검색은 서로 독립적인 조회라 순서 무관(병렬 가능). 도시교통 2개 서버와 운행정보 서버의 분야 교차 조합.'
  },

  // --------------------------------------------------------------------
  // 12. 여객 × 도시교통 병렬: 교통약자 사전 점검 — 3서버 3단계 (순서 무관)
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-12',
    query: '거동이 불편하신 어머니와 오늘 오후 부산역에서 열차를 타. 부산역 엘리베이터 상태, 대여 가능한 전동휠체어 현황, KTX라운지 잔여 좌석을 한꺼번에 확인해줘.',
    expected: [
      { serverId: 'accessible-route-guide', toolName: 'get_elevator_status', params: { station: '부산' } },
      { serverId: 'mobility-equipment-rental', toolName: 'check_equipment_availability', params: { station: '부산', equipmentType: '전동휠체어' } },
      { serverId: 'station-lounge-service', toolName: 'check_lounge_availability', params: { station: '부산', loungeType: 'KTX라운지' } }
    ],
    ordered: false,
    category: '복합',
    difficulty: 'medium',
    source: 'manual',
    notes: '교통약자 동반 여행 사전 점검. 엘리베이터 상태·이동보조기기 재고·라운지 좌석은 서로 독립적인 조회라 순서 무관(병렬 가능). 도시교통(배리어프리)과 여객서비스 2개 서버의 교차 조합.'
  },

  // --------------------------------------------------------------------
  // 13. 운행정보 × 예매 × 할인 × 결제 × 발권 — 5서버 5단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-13',
    query: '7월 10일 서울에서 부산 가는 KTX를 검색해서 오전 편으로 일반실 좌석 하나를 예약해줘. 나는 1960년생 만 66세라 경로우대 할인 자격이 되는지 확인하고, 할인 반영된 금액을 간편결제로 결제한 다음 모바일 QR 승차권까지 발급해줘.',
    expected: [
      { serverId: 'kr-train-schedule', toolName: 'search_trains', params: { from: '서울', to: '부산', date: '2026-07-10', trainType: 'KTX' } },
      { serverId: 'rail-reservation', toolName: 'reserve_seat', params: { date: '2026-07-10', from: '서울', to: '부산', seatClass: '일반실', passengers: 1 } },
      { serverId: 'discount-coupon-hub', toolName: 'check_discount_eligibility', params: { passengerType: '경로우대', birthYear: 1960 } },
      { serverId: 'payment-gateway', toolName: 'process_payment', params: { method: '간편결제' } },
      { serverId: 'mobile-qr-ticket', toolName: 'generate_mobile_qr' }
    ],
    goal: { serverId: 'mobile-qr-ticket', toolName: 'generate_mobile_qr' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '검색→예약→할인→결제→발권의 5서버 예매 풀체인. reserve_seat의 trainNo는 검색 결과, process_payment의 amount는 할인 반영 운임, generate_mobile_qr의 reservationId는 예약 결과에서 각각 체인 주입.'
  },

  // --------------------------------------------------------------------
  // 14. 기상 × 재난 × 운행정보 × 공지 × 여객 알림: 집중호우 — 5서버 5단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-14',
    query: '장마전선 집중호우 상황이야. 남한강 수위를 확인하고 중앙선의 침수 위험 구간 등급을 평가해줘. 지금 중앙선에 지연 열차가 있는지 보고, 호우로 인한 중앙선 시각표 변경 공지가 있는지도 확인해줘. 마지막으로 내 번호 010-2477-8135로 지연 알림을 문자(SMS)로 받게 구독해줘.',
    expected: [
      { serverId: 'flood-drainage-monitor', toolName: 'get_river_level', params: { river: '남한강' } },
      { serverId: 'disaster-alert', toolName: 'get_flood_risk', params: { line: '중앙선' } },
      { serverId: 'train-delay-monitor', toolName: 'get_delays', params: { line: '중앙선' } },
      { serverId: 'timetable-change-notice', toolName: 'get_schedule_changes', params: { line: '중앙선' } },
      { serverId: 'passenger-alert-subscription', toolName: 'subscribe_alert', params: { alertType: '지연', channel: 'SMS', contact: '010-2477-8135' } }
    ],
    goal: { serverId: 'passenger-alert-subscription', toolName: 'subscribe_alert' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '집중호우 상황 인식→운행 영향 확인→알림 구독으로 이어지는 5서버 체인. 하천 수위 실측, 노선 침수 위험 평가, 실시간 지연, 시각표 변경 공지를 차례로 확인한 뒤 최종 목표인 지연 알림 SMS 구독(쓰기)으로 마무리.'
  },

  // --------------------------------------------------------------------
  // 15. 도시교통: 멀티모달 + 공유모빌리티 + 택시 비교 — 3서버 4단계
  // --------------------------------------------------------------------
  {
    id: 'bench-complex-15',
    query: '오늘 밤 판교에서 강남역까지 가야 해. 대중교통 조합으로 전체 여정을 짜주고, 강남역 근처 공유 킥보드 대여소를 찾아서 15분 이용 기준 요금을 계산해줘. 판교에서 강남역까지 택시 요금 견적도 내서 뭐가 나은지 비교해줘.',
    expected: [
      { serverId: 'multimodal-trip-planner', toolName: 'plan_multimodal_trip', params: { from: '판교', to: '강남역' } },
      { serverId: 'shared-mobility', toolName: 'find_nearby_stations', params: { station: '강남역', vehicleType: '킥보드' } },
      { serverId: 'shared-mobility', toolName: 'estimate_ride_fare', params: { vehicleType: '킥보드', minutes: 15 } },
      { serverId: 'taxi-dispatch', toolName: 'estimate_fare', params: { from: '판교', to: '강남역' } }
    ],
    alternatives: [
      [
        { serverId: 'subway-navigator', toolName: 'find_route', params: { from: '판교', to: '강남' } },
        { serverId: 'shared-mobility', toolName: 'find_nearby_stations', params: { station: '강남역', vehicleType: '킥보드' } },
        { serverId: 'shared-mobility', toolName: 'estimate_ride_fare', params: { vehicleType: '킥보드', minutes: 15 } },
        { serverId: 'taxi-dispatch', toolName: 'estimate_fare', params: { from: '판교', to: '강남역' } }
      ]
    ],
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '도시교통 수단 간 비용 비교 시나리오: 멀티모달 여정 설계→도착지 인근 킥보드 대여소 탐색→이용 요금 견적→택시 요금 견적 비교. 여정 설계를 지하철 경로 탐색(subway-navigator)으로 시작하는 대안 체인(서버 3개)도 정답 인정.'
  },
// --------------------------------------------------------------------------
  // (a) 재난/기상 대응 운영 — #16 지진 / #17 태풍 / #18 집중호우·침수
  // --------------------------------------------------------------------------
  {
    id: 'bench-complex-16',
    query: '방금 동해선 42호 교량 지진감지센서에 진동이 잡혔어. 센서 계측값(규모·최대지반가속도)을 확인하고, 관제센터에 비상상황으로 접수해줘. 동해선에 운행중단·차질 공지가 떴는지도 확인한 다음, 인근 포항역 승강장에 대피 방송을 발령하고, 외국인 승객 안내용으로 "지진으로 열차 운행이 중지되었습니다. 직원의 안내에 따라 대피해 주시기 바랍니다" 문구를 영어로 번역해줘.',
    expected: [
      { serverId: 'rail-seismic-sensor', toolName: 'get_seismic_reading', params: { station: '동해선 42호 교량' } },
      { serverId: 'emergency-dispatch', toolName: 'report_incident', params: { location: '동해선 42호 교량', incidentType: '기타' } },
      { serverId: 'train-delay-monitor', toolName: 'get_disruptions', params: { region: '동해선' } },
      { serverId: 'evacuation-guidance', toolName: 'trigger_evacuation', params: { location: '포항역 승강장', reason: '기타' } },
      { serverId: 'multilingual-passenger-guide', toolName: 'translate_announcement', params: { text: '지진으로 열차 운행이 중지되었습니다. 직원의 안내에 따라 대피해 주시기 바랍니다', targetLang: '영어' } }
    ],
    goal: { serverId: 'evacuation-guidance', toolName: 'trigger_evacuation' },
    alternatives: [
      [
        { serverId: 'rail-seismic-sensor', toolName: 'get_seismic_reading', params: { station: '동해선 42호 교량' } },
        { serverId: 'rail-seismic-sensor', toolName: 'issue_seismic_alert' },
        { serverId: 'evacuation-guidance', toolName: 'trigger_evacuation', params: { location: '포항역 승강장', reason: '기타' } },
        { serverId: 'multilingual-passenger-guide', toolName: 'translate_announcement', params: { text: '지진으로 열차 운행이 중지되었습니다. 직원의 안내에 따라 대피해 주시기 바랍니다', targetLang: '영어' } }
      ]
    ],
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '지진 감지→비상 접수→운행차질 확인→대피 발령→다국어 안내로 이어지는 5서버 재난 대응 체인. get_seismic_reading의 sensorId가 대안 경로의 issue_seismic_alert로, report_incident의 incidentId가 trigger_evacuation의 선택 파라미터로 체이닝됨. 센서망 자동 경보(issue_seismic_alert)가 관제 접수·차질 확인을 갈음하는 3서버 대안도 인정. goal=대피 발령.'
  },
  {
    id: 'bench-complex-17',
    query: '제8호 태풍이 북상 중이라 남부권 대응 점검이 필요해. 남부권 태풍 예상 경로·상륙 시점, 경전선 진주-광양 구간의 실측 풍속, 영남권 재난 특보 발령 현황, 그리고 경전선 쪽 운행중단·우회 공지가 있는지 한꺼번에 확인해줘.',
    expected: [
      { serverId: 'wind-typhoon-guard', toolName: 'get_typhoon_forecast', params: { region: '남부권' } },
      { serverId: 'wind-typhoon-guard', toolName: 'get_wind_speed', params: { section: '경전선 진주-광양' } },
      { serverId: 'disaster-alert', toolName: 'get_disaster_alerts', params: { region: '영남권' } },
      { serverId: 'train-delay-monitor', toolName: 'get_disruptions', params: { region: '경전선' } }
    ],
    ordered: false,
    category: '복합',
    difficulty: 'medium',
    source: 'manual',
    notes: '태풍 내습 전 점검 시나리오. 예보(태풍 경로)·실측(풍속)·특보(재난)·운행차질(공지) 네 가지 독립 조회를 3개 서버에 분배해 병렬 수행. 상호 의존이 없으므로 호출 순서 무관(ordered:false).'
  },
  {
    id: 'bench-complex-18',
    query: '장마 집중호우가 이어지고 있어. 남한강 수위와 상승률을 확인하고, 그 지점에 연계된 배수펌프장 가동 현황을 점검해줘. 충북선의 구간별 침수 위험 등급도 확인한 다음, 위험 수준이면 오송역 지하 대합실에 침수 사유로 대피를 발령하고, 담당자 010-4477-8899가 후속 상황을 계속 받아보도록 전체 알림을 구독해줘.',
    expected: [
      { serverId: 'flood-drainage-monitor', toolName: 'get_river_level', params: { river: '남한강' } },
      { serverId: 'flood-drainage-monitor', toolName: 'get_drainage_pump_status' },
      { serverId: 'disaster-alert', toolName: 'get_flood_risk', params: { line: '충북선' } },
      { serverId: 'evacuation-guidance', toolName: 'trigger_evacuation', params: { location: '오송역 지하 대합실', reason: '침수' } },
      { serverId: 'passenger-alert-subscription', toolName: 'subscribe_alert', params: { alertType: '전체', contact: '010-4477-8899' } }
    ],
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '집중호우 대응 4서버 5단계 체인. get_river_level 출력의 stationId(배수펌프장 식별자)가 get_drainage_pump_status 입력으로 체이닝(파라미터 생략). 하천 실측→배수설비 점검→노선 침수위험 평가→대피 발령→담당자 알림 구독의 실무 순서를 따르는지 확인.'
  },

  // --------------------------------------------------------------------------
  // (b) 물류 end-to-end — #19 위험물 / #20 컨테이너 환적·통관 / #21 운임·정산
  // --------------------------------------------------------------------------
  {
    id: 'bench-complex-19',
    query: '한국화학(주)이 여수에서 오봉까지 황산 22,000kg을 철도로 운송하려고 해. 먼저 황산의 UN번호와 위험물 등급을 분류하고, 철도 운송 가능 여부와 요구 화차 형식을 검증한 뒤, 화주 명의로 운송 승인서를 발급해줘. 이어서 규정에 맞는 탱크화차 2량을 여수→오봉 구간에 배정 요청하고, 배정된 화물열차의 위험물 적재 명세까지 최종 확인해줘.',
    expected: [
      { serverId: 'dangerous-goods-compliance', toolName: 'classify_dangerous_goods', params: { cargoName: '황산' } },
      { serverId: 'dangerous-goods-compliance', toolName: 'check_transport_eligibility' },
      { serverId: 'dangerous-goods-compliance', toolName: 'issue_transport_permit', params: { shipper: '한국화학(주)', quantityKg: 22000 } },
      { serverId: 'freight-car-allocator', toolName: 'request_car_allocation', params: { cargoType: '위험물', quantity: 2, from: '여수', to: '오봉', wagonType: '탱크화차' } },
      { serverId: 'hazmat-watch', toolName: 'get_hazmat_manifest' }
    ],
    goal: { serverId: 'hazmat-watch', toolName: 'get_hazmat_manifest' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '위험물 운송 end-to-end. classify의 unNumber가 check_transport_eligibility→issue_transport_permit으로, 적합성 검증 결과의 wagonType이 화차 배정 요청으로, request_car_allocation 출력의 trainNo가 get_hazmat_manifest 입력으로 체이닝(체인 파라미터 생략). 분류→적합성→승인→배정→적재명세 확인의 규정 순서 준수 여부 확인. goal=적재 명세 최종 확인(질의의 최종 확인 대상).'
  },
  {
    id: 'bench-complex-20',
    query: '중국에서 부산신항에 해상으로 도착한 40ft 컨테이너 CTR-40HC-8821(운송장 CN-KR-778102)을 의왕ICD까지 철도로 옮기려고 해. 먼저 해당 컨테이너의 손상 여부(상태 등급)를 확인하고, 부산신항에서 해상→철도 환적 일정을 등록해줘. 컨테이너 화차 4량을 부산신항→의왕ICD 구간에 배정 요청하고, HS코드 0303.89 냉동수산물, 신고가액 8,500만원으로 수입 통관 신고를 제출한 뒤, 현재 화물 운송 추적 상태까지 확인해줘.',
    expected: [
      { serverId: 'container-fleet-manager', toolName: 'get_container_condition', params: { containerId: 'CTR-40HC-8821' } },
      { serverId: 'intermodal-transfer-hub', toolName: 'schedule_transload', params: { containerId: 'CTR-40HC-8821', fromMode: '해상', toMode: '철도', terminal: '부산신항' } },
      { serverId: 'freight-car-allocator', toolName: 'request_car_allocation', params: { cargoType: '컨테이너', quantity: 4, from: '부산신항', to: '의왕ICD' } },
      { serverId: 'customs-clearance-doc', toolName: 'submit_customs_declaration', params: { trackingNo: 'CN-KR-778102', hsCode: '0303.89', cargoType: '냉동수산물', declaredValue: 85000000 } },
      { serverId: 'freight-tracking', toolName: 'track_shipment', params: { trackingNo: 'CN-KR-778102' } }
    ],
    goal: { serverId: 'freight-tracking', toolName: 'track_shipment' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '수입 컨테이너의 환적→화차 배정→통관→추적 5서버 end-to-end. 동일 containerId/trackingNo가 상태 확인·환적 등록·통관 신고·운송 추적에 일관되게 전달되는지, 신고가액(8,500만원→85000000) 단위 변환을 정확히 하는지 확인. goal=운송 추적 상태 확인(질의의 최종 확인 대상).'
  },
  {
    id: 'bench-complex-21',
    query: '대한제지(주)(거래처 ID CUST-5521)가 오봉에서 부산신항까지 컨테이너 화물 24톤을 보내려고 해. 운송사별 운임을 비교 견적해서 가장 저렴한 운임을 화주 명의로 확정 잠금하고, 그 운임 기준으로 컨테이너 화차 3량을 오봉→부산신항 구간에 배정 요청해줘. 마지막으로 2026년 7월분 법인 청구서를 생성해줘. 참고로 이 거래처는 장기계약 요율이 있으니 계약 단가가 더 유리하면 그쪽을 적용해도 돼.',
    expected: [
      { serverId: 'freight-rate-engine', toolName: 'compare_carrier_rates', params: { from: '오봉', to: '부산신항', cargoType: '컨테이너', weightTon: 24 } },
      { serverId: 'freight-rate-engine', toolName: 'lock_rate', params: { shipper: '대한제지(주)' } },
      { serverId: 'freight-car-allocator', toolName: 'request_car_allocation', params: { cargoType: '컨테이너', quantity: 3, from: '오봉', to: '부산신항' } },
      { serverId: 'invoice-receipt-manager', toolName: 'generate_invoice', params: { billingPeriod: '2026-07', customerId: 'CUST-5521' } }
    ],
    goal: { serverId: 'invoice-receipt-manager', toolName: 'generate_invoice' },
    alternatives: [
      [
        { serverId: 'freight-rate-engine', toolName: 'get_contract_tariff', params: { customerId: 'CUST-5521', cargoType: '컨테이너' } },
        { serverId: 'freight-car-allocator', toolName: 'request_car_allocation', params: { cargoType: '컨테이너', quantity: 3, from: '오봉', to: '부산신항' } },
        { serverId: 'invoice-receipt-manager', toolName: 'generate_invoice', params: { billingPeriod: '2026-07', customerId: 'CUST-5521' } }
      ]
    ],
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '운임 견적→확정→화차 배정→법인 정산 체인. compare_carrier_rates의 최저가 rateId가 lock_rate로, lock_rate의 lockId가 request_car_allocation의 선택 파라미터로 체이닝. 장기계약 거래처이므로 비교 견적 대신 계약 단가(get_contract_tariff)를 적용하는 3서버 대안 경로도 동일 목표(청구서 생성) 달성 시 인정. goal=법인 청구서 생성.'
  },

  // --------------------------------------------------------------------------
  // (c) 유지보수 파이프라인 — #22 센서이상→작업지시→부품 / #23 병렬 점검 / #24 궤도
  // --------------------------------------------------------------------------
  {
    id: 'bench-complex-22',
    query: '최근 1시간 내 예지보전 센서에서 이상 징후가 감지된 자산이 있는지 확인해줘. 이상이 확인되면 그 경보를 근거로 예지보전 사유의 긴급 작업지시서를 생성하고, 생성된 작업지시의 필요 부품 목록을 확인한 뒤, 해당 부품을 재고에서 이 작업지시 앞으로 예약해줘.',
    expected: [
      { serverId: 'predictive-maintenance-sensor', toolName: 'detect_anomaly', params: { sinceMin: 60 } },
      { serverId: 'work-order-manager', toolName: 'create_work_order', params: { sourceType: '예지보전', description: '예지보전 센서 이상 징후 점검·조치', priority: '긴급' } },
      { serverId: 'work-order-manager', toolName: 'get_work_order' },
      { serverId: 'spare-parts-inventory', toolName: 'reserve_parts' }
    ],
    goal: { serverId: 'spare-parts-inventory', toolName: 'reserve_parts' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '유지보수 파이프라인 정석 io 체인. detect_anomaly의 anomalyId가 create_work_order의 sourceId로, workOrderId가 get_work_order(필요 부품 확인)→reserve_parts로, requiredParts의 partNo/quantity가 부품 예약 입력으로 순차 체이닝(체인 파라미터 생략). goal=부품 예약.'
  },
  {
    id: 'bench-complex-23',
    query: '정비 현황 세 가지만 점검해줘. 전동차 EMU-341-08의 차륜 마모 상태, 교량 자산 AST-BR-0421의 "교량 받침" 잔존수명 예측, 그리고 대전자재창고의 제동패드 재고 수량.',
    expected: [
      { serverId: 'rolling-stock-maintenance', toolName: 'get_wheel_wear', params: { vehicleNo: 'EMU-341-08' } },
      { serverId: 'predictive-maintenance-sensor', toolName: 'get_remaining_useful_life', params: { assetId: 'AST-BR-0421', component: '교량 받침' } },
      { serverId: 'spare-parts-inventory', toolName: 'check_part_stock', params: { partName: '제동패드', depot: '대전자재창고' } }
    ],
    ordered: false,
    category: '복합',
    difficulty: 'medium',
    source: 'manual',
    notes: '차량 마모·자산 잔존수명·부품 재고라는 서로 독립적인 3개 정비 점검을 서버 3곳에 병렬 요청. 상호 의존이 없어 호출 순서 무관(ordered:false). 차량 전반 건전도(get_vehicle_health)가 아닌 차륜 마모 전용 도구를 고르는지도 확인.'
  },
  {
    id: 'bench-complex-24',
    query: '호남선 궤도 틀림 경보를 경계 등급 이상으로 스크리닝해줘. 기준 초과 구간이 있으면 익산~정읍 구간에 궤도검측 정밀점검을 2026년 7월 9일로 예약하고, 그 경보를 근거로 선로결함 사유의 긴급 작업지시를 생성해줘. 이어서 레일 체결장치 부품 재고를 확인하고, 부족하면 발주 요청까지 해줘.',
    expected: [
      { serverId: 'track-geometry-monitor', toolName: 'get_geometry_alert', params: { line: '호남선', minSeverity: '경계' } },
      { serverId: 'track-maintenance', toolName: 'schedule_inspection', params: { line: '호남선', section: '익산~정읍', inspectionType: '궤도검측', date: '2026-07-09' } },
      { serverId: 'work-order-manager', toolName: 'create_work_order', params: { sourceType: '선로결함', description: '호남선 궤도 틀림 기준 초과 구간 보수', priority: '긴급' } },
      { serverId: 'spare-parts-inventory', toolName: 'check_part_stock', params: { partName: '레일 체결장치' } },
      { serverId: 'spare-parts-inventory', toolName: 'request_part_order' }
    ],
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '궤도 계측 경보→정밀점검 예약→작업지시→부품 재고·발주로 이어지는 4서버 5단계 파이프라인. get_geometry_alert의 alertId가 create_work_order의 sourceId로, check_part_stock의 partNo가 request_part_order 입력으로 체이닝(체인 파라미터 생략). 계측(track-geometry-monitor)과 점검 일정(track-maintenance)의 역할 구분을 아는지 확인.'
  },

  // --------------------------------------------------------------------------
  // (d) 수익/요금 분석 — #25 OD·수요→정책 시뮬 / #26 수익·불균형·동적요금
  // --------------------------------------------------------------------------
  {
    id: 'bench-complex-25',
    query: '요금 정책 개정 검토용 분석을 해줘. 서울(SEL)→부산(BSN) OD 통행량이 작년 같은 날(2025-07-06) 대비 오늘(2026-07-06) 얼마나 늘었는지 증감률을 구하고, 경부고속선의 2026년 7월 13일 수요도 예측해줘. 그리고 수도권에 적용 중인 요금 정책을 조회한 뒤, 그 정책 기준으로 40km 이용 시 요금이 어떻게 달라지는지 영향 시뮬레이션까지 돌려줘.',
    expected: [
      { serverId: 'od-matrix-analyzer', toolName: 'compute_od_growth_rate', params: { originStationId: 'SEL', destStationId: 'BSN', baselineDate: '2025-07-06', compareDate: '2026-07-06' } },
      { serverId: 'demand-forecast', toolName: 'forecast_demand', params: { line: '경부고속선', date: '2026-07-13' } },
      { serverId: 'fare-policy-manager', toolName: 'get_fare_policy', params: { region: '수도권' } },
      { serverId: 'fare-policy-manager', toolName: 'simulate_policy_impact', params: { distanceKm: 40 } }
    ],
    goal: { serverId: 'fare-policy-manager', toolName: 'simulate_policy_impact' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '요금 개정 근거 분석 체인. OD 증감률·미래 수요 예측이라는 두 근거 조회 후 get_fare_policy 출력의 policyId를 simulate_policy_impact에 체이닝(파라미터 생략)해 영향 분석까지 완주하는지 확인. "작년 같은 날/오늘"을 정확한 날짜로 변환하는지도 채점 포인트. goal=정책 영향 시뮬레이션.'
  },
  {
    id: 'bench-complex-26',
    query: '수익 분석 리포트용으로 세 가지를 각각 뽑아줘. 이번달 수익 상위 5개 노선 순위, KTX-경부선의 오늘(2026-07-06) 상·하행 수요 불균형 추정, 그리고 GTX-A-01 구간의 향후 6시간 동적 요금 변동 전망.',
    expected: [
      { serverId: 'revenue-analytics', toolName: 'rank_top_revenue_routes', params: { period: '이번달', topN: 5 } },
      { serverId: 'od-matrix-analyzer', toolName: 'estimate_directional_imbalance', params: { lineId: 'KTX-경부선', date: '2026-07-06' } },
      { serverId: 'dynamic-pricing-engine', toolName: 'forecast_price_window', params: { routeId: 'GTX-A-01', hoursAhead: 6 } }
    ],
    ordered: false,
    category: '복합',
    difficulty: 'medium',
    source: 'manual',
    notes: '수익 랭킹·방향별 수요 불균형·동적 요금 전망이라는 독립적인 3개 분석을 서버 3곳에서 병렬 수행(ordered:false). 현재 배율 조회(get_dynamic_multiplier)가 아닌 미래 구간 예측(forecast_price_window)을 선택하는지 확인.'
  },

  // --------------------------------------------------------------------------
  // (e) 도시 복합환승 — #27 멀티모달+공유모빌리티+교통카드 / #28 P&R+EV+열차예약
  // --------------------------------------------------------------------------
  {
    id: 'bench-complex-27',
    query: '오늘 저녁 판교에서 강남역까지 가야 해. 지하철과 공유 모빌리티를 섞은 복합환승 경로를 짜주고, 경로상 대여소의 실시간 재고를 확인해서 자전거 1대를 예약해줘. 결제는 교통카드 CARD-3021-9987로 할 거니까 잔액도 확인해줘. 만약 대여소에 자전거가 없으면 마지막 구간은 택시 호출로 대체해도 좋아.',
    expected: [
      { serverId: 'multimodal-trip-planner', toolName: 'plan_multimodal_trip', params: { from: '판교', to: '강남역' } },
      { serverId: 'shared-mobility', toolName: 'get_station_availability' },
      { serverId: 'shared-mobility', toolName: 'reserve_vehicle', params: { vehicleType: '자전거' } },
      { serverId: 'prepaid-card-balance', toolName: 'get_card_balance', params: { cardId: 'CARD-3021-9987' } }
    ],
    goal: { serverId: 'shared-mobility', toolName: 'reserve_vehicle' },
    alternatives: [
      {
        steps: [
          { serverId: 'multimodal-trip-planner', toolName: 'plan_multimodal_trip', params: { from: '판교', to: '강남역' } },
          { serverId: 'taxi-dispatch', toolName: 'request_dispatch' },
          { serverId: 'prepaid-card-balance', toolName: 'get_card_balance', params: { cardId: 'CARD-3021-9987' } }
        ],
        goal: { serverId: 'taxi-dispatch', toolName: 'request_dispatch' } // 택시 대체 경로의 실제 목표
      }
    ],
    category: '복합',
    difficulty: 'medium',
    source: 'manual',
    notes: '멀티모달 경로 설계 후 plan_multimodal_trip 출력의 stationId(인근 대여소 ID)를 get_station_availability→reserve_vehicle로 체이닝(파라미터 생략)하고 교통카드 잔액까지 확인. 대여소 재고가 없을 때 마지막 구간을 택시 배차로 대체하는 3서버 대안 경로(택시 출발·도착지는 경로 결과에서 도출)도 인정. goal=공유 자전거 예약.'
  },
  {
    id: 'bench-complex-28',
    query: '내일(2026년 7월 7일) 아침 전기차를 몰고 수서역으로 가서 SRT로 부산까지 갈 거야. 수서역 인근 환승주차장을 찾아 07:30 입차로 자리를 예약해주고, 역 근처 급속 충전소도 검색해줘. 그리고 수서→부산 08:00 이후 출발 SRT를 검색해서 일반실 1석 예약까지 진행해줘.',
    expected: [
      { serverId: 'park-and-ride', toolName: 'find_lots_near_station', params: { station: '수서' } },
      { serverId: 'park-and-ride', toolName: 'reserve_spot', params: { date: '2026-07-07', arriveTime: '07:30' } },
      { serverId: 'ev-charging-network', toolName: 'find_charging_stations', params: { station: '수서', connectorType: '급속' } },
      { serverId: 'kr-train-schedule', toolName: 'search_trains', params: { from: '수서', to: '부산', date: '2026-07-07', departAfter: '08:00', trainType: 'SRT' } },
      { serverId: 'rail-reservation', toolName: 'reserve_seat', params: { date: '2026-07-07', from: '수서', to: '부산', seatClass: '일반실', passengers: 1 } }
    ],
    goal: { serverId: 'rail-reservation', toolName: 'reserve_seat' },
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '자가용(전기차)→환승주차→고속철도의 복합환승 4서버 5단계. find_lots_near_station의 lotId가 reserve_spot으로, search_trains의 trainNo가 reserve_seat로 체이닝(체인 파라미터 생략). "내일"을 2026-07-07로 변환하고 SRT 종별·출발시각 필터를 정확히 넣는지 확인. goal=좌석 예약.'
  },

  // --------------------------------------------------------------------------
  // (f) 여객 민원/서비스 복합 — #29 지연 민원→환불→알림 / #30 외국인 관광객 지원
  // --------------------------------------------------------------------------
  {
    id: 'bench-complex-29',
    query: '어제(2026-07-05) 경부선 KTX 101이 크게 지연돼서 중요한 회의를 놓쳤어. 승차권 번호는 TK-20260705-A7F19야. 먼저 경부선 지연 현황과 사유를 확인하고, 지연 분류로 정식 민원을 접수해줘. 그다음 이 승차권의 환불 가능 여부와 수수료를 확인한 뒤 열차지연 사유로 환불 신청을 넣고, 앞으로는 KTX 101 지연 알림을 010-9911-3322로 받아보게 구독해줘.',
    expected: [
      { serverId: 'train-delay-monitor', toolName: 'get_delays', params: { line: '경부선' } },
      { serverId: 'civil-complaint-center', toolName: 'submit_complaint', params: { category: '지연', content: '경부선 KTX 101 지연으로 회의 일정 차질' } },
      { serverId: 'fare-refund-center', toolName: 'check_refund_eligibility', params: { ticketId: 'TK-20260705-A7F19' } },
      { serverId: 'fare-refund-center', toolName: 'submit_refund_request', params: { ticketId: 'TK-20260705-A7F19', reason: '열차 지연', requestType: '열차지연' } },
      { serverId: 'passenger-alert-subscription', toolName: 'subscribe_alert', params: { alertType: '지연', trainNo: 'KTX 101', contact: '010-9911-3322' } }
    ],
    goal: { serverId: 'fare-refund-center', toolName: 'submit_refund_request' },
    alternatives: [
      {
        steps: [
          { serverId: 'train-delay-monitor', toolName: 'get_delays', params: { line: '경부선' } },
          { serverId: 'civil-complaint-center', toolName: 'submit_complaint', params: { category: '지연', content: '경부선 KTX 101 지연으로 회의 일정 차질' } },
          { serverId: 'ticket-issuance', toolName: 'refund_ticket', params: { ticketId: 'TK-20260705-A7F19', reason: '열차 지연' } },
          { serverId: 'passenger-alert-subscription', toolName: 'subscribe_alert', params: { alertType: '지연', trainNo: 'KTX 101', contact: '010-9911-3322' } }
        ],
        goal: { serverId: 'ticket-issuance', toolName: 'refund_ticket' } // 즉시 반환 경로의 실제 목표
      }
    ],
    category: '복합',
    difficulty: 'hard',
    source: 'manual',
    notes: '지연 피해 승객의 민원→보상 환불→재발 방지 알림 4서버 체인. 지연 사유(무료 환불 심사 대상)이므로 자격 확인 후 submit_refund_request(requestType=열차지연) 경로가 정석이며, 즉시 반환(ticket-issuance.refund_ticket)으로 갈음하는 4서버 대안도 동일 목표(환불) 달성 시 인정. goal=환불 신청 접수.'
  },
  {
    id: 'bench-complex-30',
    query: '일본인 관광객 일행을 안내 중이야. 서울역에서 명동까지 가는 환승 경로를 일본어 안내문으로 만들어주고, 오늘(2026-07-06) 서울역 대형 물품보관함을 하나 예약해줘. 그리고 서울역 KTX라운지 좌석도 오늘 3명으로 예약해줘.',
    expected: [
      { serverId: 'multilingual-passenger-guide', toolName: 'get_multilingual_route_guide', params: { station: '서울', destination: '명동', lang: '일본어' } },
      { serverId: 'baggage-locker-booking', toolName: 'reserve_locker', params: { station: '서울', size: '대형', date: '2026-07-06' } },
      { serverId: 'station-lounge-service', toolName: 'reserve_lounge_seat', params: { station: '서울', loungeType: 'KTX라운지', date: '2026-07-06', partySize: 3 } }
    ],
    ordered: false,
    category: '복합',
    difficulty: 'medium',
    source: 'manual',
    notes: '외국인 관광객 지원 시나리오. 다국어 경로 안내·보관함 사전예약·라운지 좌석 예약은 서로 독립 요청이라 순서 무관(ordered:false). 단순 문구 번역(translate_announcement)이 아닌 경로 안내 생성 도구를 고르는지, "오늘"을 2026-07-06으로 변환하는지 확인.'
  }
  ]
};
