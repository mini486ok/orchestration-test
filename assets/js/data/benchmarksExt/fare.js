// ============================================================================
// benchmarksExt/fare.js — 요금·정산 분야 검증 세트 (10문항)
// SPEC §10(계약서) 규격 준수. 순수 ES module.
//
// 참조 서버(요금·정산 분야, 총 10개):
//  ● 기존 3개: fare-calculator, transit-settlement, payment-gateway
//  ● 신규 7개: fare-policy-manager, discount-subsidy-calculator, interagency-clearing,
//              refund-settlement, prepaid-card-balance, invoice-receipt-manager,
//              dynamic-pricing-engine
//
// 구성: 1단계 질의 3개(#1~#3, easy) + 2단계 4개(#4~#7, easy1/medium3)
//       + 3단계 3개(#8~#10, hard).
// 난이도: easy 4 / medium 3 / hard 3.
// 다중 정답: ordered:false 3문항(#4,#5,#6) + alternatives 4문항(#1,#7,#8,#9),
//           goal 명시 4문항(#7,#8,#9,#10).
// io 체인 반영: 할인자격→discountCode→apply_combined_discount→finalFare→결제(#8),
//              결제→transactionId→영수증(#7)/환불정산(#10),
//              정산배치→batchId→잔액→확정(#9).
// ============================================================================

export const BENCH_FARE = {
  id: 'bench-set-fare',
  name: '요금·정산 검증 세트',
  description: '철도 요금·정산 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    // ------------------------------------------------------------------
    // 1단계 질의 (easy) — 3문항
    // ------------------------------------------------------------------
    {
      id: 'bench-fare-1',
      query: '서울에서 부산까지 KTX 일반실 요금이 얼마인지 계산해줘.',
      expected: [
        { serverId: 'fare-calculator', toolName: 'calculate_fare', params: { from: '서울', to: '부산', trainType: 'KTX', seatClass: '일반실' } }
      ],
      alternatives: [
        [ { serverId: 'fare-calculator', toolName: 'get_fare_table', params: { from: '서울', trainType: 'KTX' } } ]
      ],
      category: '요금·정산',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 도구 여객 운임 계산. 서울 기준 출발역의 도착역별 요금표 전체를 조회(get_fare_table)해 그중 부산행 요금을 확인하는 대안 경로도 정답으로 인정.'
    },
    {
      id: 'bench-fare-2',
      query: '수도권 지역에 현재 적용 중인 요금 정책의 기본운임과 거리비례율을 조회해줘.',
      expected: [
        { serverId: 'fare-policy-manager', toolName: 'get_fare_policy', params: { region: '수도권' } }
      ],
      category: '요금·정산',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 도구 정책 조회. 개별 승차권 요금 계산(fare-calculator.calculate_fare)이 아닌 정책 원칙 조회 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-fare-3',
      query: '어제(2026년 7월 4일)자 결제 승인 내역과 실제 승차 실적을 대사해서 불일치 건이 있는지 확인해줘.',
      expected: [
        { serverId: 'payment-gateway', toolName: 'reconcile_payments', params: { date: '2026-07-04' } }
      ],
      category: '요금·정산',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 도구 결제 대사(감사) 작업. 개별 거래 조회(get_transaction)와 혼동하지 않고 일자 기준 대사 도구를 선택하는지, "어제"를 정확한 날짜로 변환하는지 확인.'
    },

    // ------------------------------------------------------------------
    // 2단계 (easy 1 / medium 3) — 4문항
    // ------------------------------------------------------------------
    {
      id: 'bench-fare-4',
      query: '이번 달 환승 정산 보고서 요약이랑, 카드 CARD-3021-9987 현재 잔액을 같이 확인해줘.',
      expected: [
        { serverId: 'transit-settlement', toolName: 'get_settlement_report', params: { period: '2026-07', format: '요약' } },
        { serverId: 'prepaid-card-balance', toolName: 'get_card_balance', params: { cardId: 'CARD-3021-9987' } }
      ],
      ordered: false,
      category: '요금·정산',
      difficulty: 'easy',
      source: 'manual',
      notes: '서로 무관한 두 조회(환승 정산 보고서, 카드 잔액)를 한 질의에 병렬 요청. 두 서버 모두 호출하되 호출 순서는 무관함(ordered:false).'
    },
    {
      id: 'bench-fare-5',
      query: '카드 CARD-3021-9987의 2026년 6월 이용내역이랑, 청구서 INV-2026-07-4471 완납 여부를 같이 확인해줘.',
      expected: [
        { serverId: 'prepaid-card-balance', toolName: 'get_card_history', params: { cardId: 'CARD-3021-9987', period: '2026-06' } },
        { serverId: 'invoice-receipt-manager', toolName: 'get_invoice_status', params: { invoiceId: 'INV-2026-07-4471' } }
      ],
      ordered: false,
      category: '요금·정산',
      difficulty: 'medium',
      source: 'manual',
      notes: '선불카드 이용내역 조회와 청구서 상태 조회는 서로 독립적인 요청이라 순서 무관. 카드 잔액 단건 조회(get_card_balance)가 아닌 기간별 이력 조회(get_card_history)를 선택하는지 함께 확인.'
    },
    {
      id: 'bench-fare-6',
      query: '공급가액 54364원에 대한 부가세를 계산하고, GTX-A-01 노선의 현재 동적 요금 배율도 같이 알려줘.',
      expected: [
        { serverId: 'invoice-receipt-manager', toolName: 'calculate_vat', params: { supplyAmount: 54364 } },
        { serverId: 'dynamic-pricing-engine', toolName: 'get_dynamic_multiplier', params: { routeId: 'GTX-A-01' } }
      ],
      ordered: false,
      category: '요금·정산',
      difficulty: 'medium',
      source: 'manual',
      notes: '부가세 계산과 동적 요금 배율 조회는 서로 다른 서버의 독립 요청. 두 도구 모두 호출하며 순서는 무관함(ordered:false).'
    },
    {
      id: 'bench-fare-7',
      query: '법인 출장으로 SRT 승차권을 신용카드로 68000원 결제하고, 지출증빙용 영수증을 발급해줘.',
      expected: [
        { serverId: 'payment-gateway', toolName: 'process_payment', params: { amount: 68000, method: '신용카드' } },
        { serverId: 'invoice-receipt-manager', toolName: 'issue_receipt', params: { issueType: '지출증빙' } }
      ],
      goal: { serverId: 'invoice-receipt-manager', toolName: 'issue_receipt' },
      alternatives: [
        [
          { serverId: 'payment-gateway', toolName: 'process_payment', params: { amount: 68000, method: '신용카드' } },
          { serverId: 'invoice-receipt-manager', toolName: 'generate_invoice', params: { billingPeriod: '2026-07', customerId: 'CORP-4471' } }
        ]
      ],
      category: '요금·정산',
      difficulty: 'medium',
      source: 'manual',
      notes: 'process_payment 출력의 transactionId를 issue_receipt 입력으로 그대로 연결하는 io 체이닝(결제→transactionId→영수증). 법인 고객이라 개별 영수증 대신 월별 법인 청구서(generate_invoice)로 갈음하는 대안도 동일 목적(지출 증빙)으로 인정. goal=영수증/청구서 발급.'
    },

    // ------------------------------------------------------------------
    // 3단계 (hard) — 3문항
    // ------------------------------------------------------------------
    {
      id: 'bench-fare-8',
      query: '장애인 할인 자격을 확인하고, 그 할인코드로 기본운임 59800원 기준 최종 요금을 계산한 다음, 간편결제로 결제까지 진행해줘.',
      expected: [
        { serverId: 'discount-subsidy-calculator', toolName: 'calculate_discount_eligibility', params: { category: '장애인' } },
        { serverId: 'discount-subsidy-calculator', toolName: 'apply_combined_discount', params: { baseFare: 59800 } },
        { serverId: 'payment-gateway', toolName: 'process_payment', params: { method: '간편결제' } }
      ],
      goal: { serverId: 'payment-gateway', toolName: 'process_payment' },
      alternatives: [
        [
          { serverId: 'fare-calculator', toolName: 'apply_discount', params: { baseFare: 59800, discountType: '장애인' } },
          { serverId: 'payment-gateway', toolName: 'process_payment', params: { method: '간편결제' } }
        ]
      ],
      category: '요금·정산',
      difficulty: 'hard',
      source: 'manual',
      notes: '할인자격 확인→discountCode를 apply_combined_discount에 전달→finalFare로 결제까지 이어지는 3단계 정석 io 체인. 단일 할인 적용 도구(fare-calculator.apply_discount)로 2단계에 축약해도 동일 목표(결제 완료) 달성 시 대안으로 인정. goal=결제 처리.'
    },
    {
      id: 'bench-fare-9',
      query: '2026년 7월 5일자 정산 배치를 새로 만들고, 기관별 잔액을 확인한 다음, 문제 없으면 정산팀장 명의로 확정 처리까지 해줘.',
      expected: [
        { serverId: 'interagency-clearing', toolName: 'create_clearing_batch', params: { settlementDate: '2026-07-05' } },
        { serverId: 'interagency-clearing', toolName: 'get_clearing_balance' },
        { serverId: 'interagency-clearing', toolName: 'confirm_clearing', params: { approver: '정산팀장' } }
      ],
      goal: { serverId: 'interagency-clearing', toolName: 'confirm_clearing' },
      alternatives: [
        [
          { serverId: 'interagency-clearing', toolName: 'create_clearing_batch', params: { settlementDate: '2026-07-05' } },
          { serverId: 'interagency-clearing', toolName: 'confirm_clearing', params: { approver: '정산팀장' } }
        ]
      ],
      category: '요금·정산',
      difficulty: 'hard',
      source: 'manual',
      notes: '정산 배치 생성→batchId로 잔액 확인→동일 batchId로 확정 처리까지 이어지는 3단계 io 체인. 잔액 확인을 생략하고 곧바로 확정하는 2단계 경로도 동일 목표(정산 확정) 달성 시 대안으로 인정. goal=정산 확정.'
    },
    {
      id: 'bench-fare-10',
      query: 'SRT 승차권을 신용카드로 45000원 결제했는데 열차 지연으로 취소해야 해. 위약금 규정에 따라 환불액을 산정하고, 산정된 금액으로 환불 처리까지 진행해줘.',
      expected: [
        { serverId: 'payment-gateway', toolName: 'process_payment', params: { amount: 45000, method: '신용카드' } },
        { serverId: 'refund-settlement', toolName: 'calculate_refund', params: { cancelReason: '열차지연' } },
        { serverId: 'refund-settlement', toolName: 'process_refund_payout' }
      ],
      goal: { serverId: 'refund-settlement', toolName: 'process_refund_payout' },
      category: '요금·정산',
      difficulty: 'hard',
      source: 'manual',
      notes: 'process_payment 출력의 transactionId가 calculate_refund→process_refund_payout까지 그대로 체이닝되는 3단계 흐름(결제→transactionId→환불정산). 취소 사유(열차지연)에 따른 위약금율 적용 여부와, 산정액을 실제 환불 실행까지 이어가는지 확인. goal=환불 처리 완료.'
    }
  ]
};
