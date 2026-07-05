// ============================================================================
// benchmarksExt/booking.js — 예매·발권 분야 검증 세트 (10문항)
// SPEC(계약서 v2 §10) 준수. serverId/toolName은 모두 실존 카탈로그 참조:
//  - 기존 3종: rail-reservation, ticket-issuance, rail-pass-manager
//              (assets/js/data/sampleMcps.js)
//  - 신규 7종: group-reservation-desk, fare-refund-center, seat-map-selector,
//              waitlist-manager, discount-coupon-hub, mobile-qr-ticket,
//              reservation-rebooking (assets/js/data/mcpsExt/booking.js)
//
// 구성: 1단계 4 / 2단계 4 / 3단계 2   |   easy 4 / medium 4 / hard 2
// 다중 정답 반영: ordered:false 2문항(#7, #8), alternatives 2문항(#9, #10),
//              goal 3문항(#5, #6, #10)
// io 체인: reserve_seat→reservationId→generate_mobile_qr(#5) /
//          check_discount_eligibility→discountCode→apply_discount_to_reservation(#6) /
//          check_refund_eligibility→submit_refund_request→refundRequestId→
//          track_refund_request(#9, 대안: ticket-issuance.refund_ticket 단발 환불) /
//          search_group_availability→create_group_reservation→reservationId→
//          request_group_invoice(#10, 대안: 견적조회 생략)
// ============================================================================

export const BENCH_BOOKING = {
  id: 'bench-set-booking',
  name: '예매·발권 검증 세트',
  description: '승차권 예매·발권 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    // ------------------------------------------------------------------
    // 1단계 질의 (easy) — 4문항
    // ------------------------------------------------------------------
    {
      id: 'bench-booking-1',
      query: '2026-07-05일 서울에서 부산 가는 KTX 101 열차 좌석 등급별 잔여석이 몇 자리인지 확인해줘',
      expected: [
        { serverId: 'rail-reservation', toolName: 'check_seat_availability', params: { trainNo: 'KTX 101', date: '2026-07-05', from: '서울', to: '부산' } }
      ],
      category: '예매·발권',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 도구 잔여석 조회. 좌석 단위 배치도 조회(seat-map-selector.get_seat_map)와 혼동하지 않고 등급별 잔여석 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-booking-2',
      query: 'KTX 105 열차 2026-07-10일 4호차 좌석배치도를 좌석 단위로 보여줘. 어디가 창측이고 비어있는지 알고 싶어',
      expected: [
        { serverId: 'seat-map-selector', toolName: 'get_seat_map', params: { trainNo: 'KTX 105', date: '2026-07-10', carNo: 4 } }
      ],
      category: '예매·발권',
      difficulty: 'easy',
      source: 'manual',
      notes: '등급별 잔여석 수만 알려주는 check_seat_availability가 아니라 좌석 단위 배치도 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-booking-3',
      query: '승차권 TK-20260705-A7F19 지금 환불하면 얼마나 돌려받을 수 있는지, 신청 마감이 언제인지 미리 확인해줘',
      expected: [
        { serverId: 'fare-refund-center', toolName: 'check_refund_eligibility', params: { ticketId: 'TK-20260705-A7F19' } }
      ],
      category: '예매·발권',
      difficulty: 'easy',
      source: 'manual',
      notes: '사전 확인 단계. 실제 환불 신청 접수(submit_refund_request)나 즉시 반환(ticket-issuance.refund_ticket)을 실행하지 않고 가능 여부·수수료만 조회하는지 확인.'
    },
    {
      id: 'bench-booking-4',
      query: '수원에서 서울 구간으로 매일 통근하는데 쓸만한 통근정기권 상품 좀 찾아줘',
      expected: [
        { serverId: 'rail-pass-manager', toolName: 'search_passes', params: { passType: '통근정기권', from: '수원', to: '서울' } }
      ],
      category: '예매·발권',
      difficulty: 'easy',
      source: 'manual',
      notes: '필수 파라미터가 없는 도구(required: [])에서도 문맥상 유의미한 선택적 파라미터(passType/from/to)를 채우는지 확인. 낱장 승차권 예매(rail-reservation)와 혼동하지 않는지 확인.'
    },

    // ------------------------------------------------------------------
    // 2단계 체인 (medium) — 4문항
    // ------------------------------------------------------------------
    {
      id: 'bench-booking-5',
      query: '2026-07-06일 서울에서 대전 가는 KTX 107 열차 특실로 2명 예약하고, 그 예약으로 모바일 QR 티켓까지 바로 발급해줘',
      expected: [
        { serverId: 'rail-reservation', toolName: 'reserve_seat', params: { trainNo: 'KTX 107', date: '2026-07-06', from: '서울', to: '대전', seatClass: '특실', passengers: 2 } },
        { serverId: 'mobile-qr-ticket', toolName: 'generate_mobile_qr' }
      ],
      goal: { serverId: 'mobile-qr-ticket', toolName: 'generate_mobile_qr' },
      category: '예매·발권',
      difficulty: 'medium',
      source: 'manual',
      notes: 'io체이닝(예약 생성→reservationId→모바일 QR 발급). reservationId는 1단계 reserve_seat이 새로 발급하는 값이라 사전에 알 수 없으므로 2단계 params는 미채점. 목표 도구는 QR 발급 완료.'
    },
    {
      id: 'bench-booking-6',
      query: '1958년생 경로우대 승객인데 할인 자격이 되는지 확인하고, 이미 만든 예약 RSV-20260705-0012에 그 할인을 적용해줘',
      expected: [
        { serverId: 'discount-coupon-hub', toolName: 'check_discount_eligibility', params: { passengerType: '경로우대', birthYear: 1958 } },
        { serverId: 'discount-coupon-hub', toolName: 'apply_discount_to_reservation', params: { reservationId: 'RSV-20260705-0012' } }
      ],
      goal: { serverId: 'discount-coupon-hub', toolName: 'apply_discount_to_reservation' },
      category: '예매·발권',
      difficulty: 'medium',
      source: 'manual',
      notes: 'io체이닝(할인 자격 판정→discountCode→예약 적용). reservationId는 사용자가 직접 지정했으므로 채점하되, discountCode는 1단계 출력에서만 정해지므로 미채점. 목표 도구는 할인 적용 완료.'
    },
    {
      id: 'bench-booking-7',
      query: '예약 RSV-20260705-0012를 KTX 109, 2026-07-07일로 변경해주고, 이 예약의 변경 이력도 같이 보여줘',
      expected: [
        { serverId: 'reservation-rebooking', toolName: 'change_reservation', params: { reservationId: 'RSV-20260705-0012', newTrainNo: 'KTX 109', newDate: '2026-07-07' } },
        { serverId: 'reservation-rebooking', toolName: 'get_change_history', params: { reservationId: 'RSV-20260705-0012' } }
      ],
      ordered: false,
      category: '예매·발권',
      difficulty: 'medium',
      source: 'manual',
      notes: '두 호출 모두 사용자가 직접 지정한 동일 예약번호만으로 실행 가능해 서로 의존관계가 없다(순서 무관). 변경 실행과 이력 조회 중 한쪽만 하지 않는지 확인.'
    },
    {
      id: 'bench-booking-8',
      query: 'KTX 107 열차 2026-07-08일 서울에서 부산 구간이 매진이라 대기예약을 걸고 싶어. 그리고 그 열차 좌석배치도도 같이 보여줘',
      expected: [
        { serverId: 'waitlist-manager', toolName: 'join_waitlist', params: { trainNo: 'KTX 107', date: '2026-07-08', from: '서울', to: '부산' } },
        { serverId: 'seat-map-selector', toolName: 'get_seat_map', params: { trainNo: 'KTX 107', date: '2026-07-08' } }
      ],
      ordered: false,
      category: '예매·발권',
      difficulty: 'medium',
      source: 'manual',
      notes: '대기예약 등록과 좌석배치도 조회는 서로 독립적인 등록/조회라 순서 무관. 잔여석이 있을 때 쓰는 즉시 예약(rail-reservation.reserve_seat)이 아닌 매진 시 대기예약 도구를 선택하는지도 확인.'
    },

    // ------------------------------------------------------------------
    // 3단계 체인 (hard) — 2문항
    // ------------------------------------------------------------------
    {
      id: 'bench-booking-9',
      query: '승차권 TK-20260705-A7F19을 열차 지연으로 환불받고 싶어. 환불 가능 여부부터 확인하고 정식으로 환불 신청을 접수한 다음, 처리 상태까지 추적해줘',
      expected: [
        { serverId: 'fare-refund-center', toolName: 'check_refund_eligibility', params: { ticketId: 'TK-20260705-A7F19' } },
        { serverId: 'fare-refund-center', toolName: 'submit_refund_request', params: { ticketId: 'TK-20260705-A7F19', reason: '열차 지연', requestType: '열차지연' } },
        { serverId: 'fare-refund-center', toolName: 'track_refund_request' }
      ],
      alternatives: [
        [
          { serverId: 'ticket-issuance', toolName: 'refund_ticket', params: { ticketId: 'TK-20260705-A7F19', reason: '열차 지연' } }
        ]
      ],
      category: '예매·발권',
      difficulty: 'hard',
      source: 'manual',
      notes: '3단계 정식 환불 흐름(사전확인→신청접수→상태추적). refundRequestId는 2단계 출력이라 3단계 params는 미채점. 열차 지연 사유는 즉시 반환 처리 도구(ticket-issuance.refund_ticket) 한 번으로 끝내는 대안도 정답 인정(두 경로의 최종 도구가 다르므로 goal은 명시하지 않고 채택된 gold 시퀀스의 마지막 step을 기준으로 채점).'
    },
    {
      id: 'bench-booking-10',
      query: '2026-07-15일 서울에서 부산 가는 열차로 30명 단체 예약이 가능한지 확인하고, 가능하면 대표자 박서준 명의로 단체 예약을 생성한 뒤 세금계산서까지 발행해줘',
      expected: [
        { serverId: 'group-reservation-desk', toolName: 'search_group_availability', params: { from: '서울', to: '부산', date: '2026-07-15', groupSize: 30 } },
        { serverId: 'group-reservation-desk', toolName: 'create_group_reservation', params: { date: '2026-07-15', groupSize: 30, representativeName: '박서준' } },
        { serverId: 'group-reservation-desk', toolName: 'request_group_invoice' }
      ],
      alternatives: [
        [
          { serverId: 'group-reservation-desk', toolName: 'create_group_reservation', params: { date: '2026-07-15', groupSize: 30, representativeName: '박서준' } },
          { serverId: 'group-reservation-desk', toolName: 'request_group_invoice' }
        ]
      ],
      goal: { serverId: 'group-reservation-desk', toolName: 'request_group_invoice' },
      category: '예매·발권',
      difficulty: 'hard',
      source: 'manual',
      notes: '정식 흐름(견적 조회→예약 생성→세금계산서 발행) 또는 견적 조회를 생략하고 곧바로 예약 생성부터 시작하는 2단계 대안 흐름 모두 정답 처리(두 경로 모두 최종 도구는 request_group_invoice). create_group_reservation의 trainNo는 견적 조회 출력에 의존하므로 params 미채점.'
    }
  ]
};
