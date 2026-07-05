// ============================================================================
// benchmarksExt/passenger.js — 여객서비스 분야 검증 세트 (10문항)
// 참조 서버: 기존 3종(passenger-assist, lost-and-found, station-guide)
//           + 신규 7종(mcpsExt/passenger.js: mobility-equipment-rental,
//             civil-complaint-center, baggage-locker-booking, station-lounge-service,
//             multilingual-passenger-guide, passenger-alert-subscription, faq-chatbot-backend)
// 구성: 1단계 4 / 2단계 4 / 3단계 2, easy 3 / medium 4 / hard 3
// 다중정답: alternatives 2문항(4,7), ordered:false 2문항(6,8), goal 4문항(5,7,9,10)
// io 체인: mobility-equipment-rental 조회→예약→반납(9), station-lounge-service 예약→체크인(5)
// ============================================================================

export const BENCH_PASSENGER = {
  id: 'bench-set-passenger',
  name: '여객서비스 검증 세트',
  description: '여객서비스 분야 오케스트레이션 검증 10문항',
  createdAt: '2026-07-05T00:00:00Z',
  items: [
    {
      id: 'bench-passenger-1',
      query: '서울역에 장애인 편의시설이 잘 갖춰져 있는지 확인해줘',
      expected: [
        { serverId: 'passenger-assist', toolName: 'get_accessible_facilities', params: { station: '서울' } }
      ],
      category: '여객서비스',
      difficulty: 'easy',
      source: 'manual',
      notes: '단일 도구 조회. 즉시 지원 요청(request_wheelchair)이 아닌 무장애 시설 현황 조회 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-passenger-2',
      query: '최근 2주 사이에 접수된 지갑 습득물이 있는지 찾아줘',
      expected: [
        { serverId: 'lost-and-found', toolName: 'search_found_items', params: { itemType: '지갑', days: 14 } }
      ],
      category: '여객서비스',
      difficulty: 'easy',
      source: 'manual',
      notes: '분실 신고(report_lost_item)가 아닌 습득물 검색 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-passenger-3',
      query: '부산역 KTX라운지에 잔여 좌석이 있는지, 대기시간은 얼마나 되는지 확인해줘',
      expected: [
        { serverId: 'station-lounge-service', toolName: 'check_lounge_availability', params: { station: '부산', loungeType: 'KTX라운지' } }
      ],
      category: '여객서비스',
      difficulty: 'easy',
      source: 'manual',
      notes: '실제 예약(reserve_lounge_seat)이 아닌 잔여 현황 조회 도구를 선택하는지 확인.'
    },
    {
      id: 'bench-passenger-4',
      query: '휠체어를 이용하는 승객이 대전역에서 KTX 101 열차를 타야 하는데 도움을 받을 방법을 알아봐줘',
      expected: [
        { serverId: 'passenger-assist', toolName: 'request_wheelchair', params: { station: '대전', trainNo: 'KTX 101' } }
      ],
      alternatives: [
        [ { serverId: 'passenger-assist', toolName: 'book_assistance', params: { station: '대전', trainNo: 'KTX 101' } } ]
      ],
      category: '여객서비스',
      difficulty: 'medium',
      source: 'manual',
      notes: '즉시 현장 지원 요청(request_wheelchair)과 사전 동행 예약(book_assistance) 모두 유효한 해석이므로 대안 워크플로우로 인정.'
    },
    {
      id: 'bench-passenger-5',
      query: '부산역 KTX라운지 좌석을 7월 6일로 예약하고, 발급된 티켓코드로 바로 체크인까지 처리해줘',
      expected: [
        { serverId: 'station-lounge-service', toolName: 'reserve_lounge_seat', params: { station: '부산', loungeType: 'KTX라운지', date: '2026-07-06' } },
        { serverId: 'station-lounge-service', toolName: 'checkin_lounge' }
      ],
      goal: { serverId: 'station-lounge-service', toolName: 'checkin_lounge' },
      category: '여객서비스',
      difficulty: 'medium',
      source: 'manual',
      notes: 'reserve_lounge_seat에서 발급된 ticketCode를 checkin_lounge 입력으로 그대로 전달하는 2단계 io 체이닝 확인(필수 체인).'
    },
    {
      id: 'bench-passenger-6',
      query: '서울역 물품보관함 잔여 현황이랑 전동스쿠터 대여 가능 여부를 같이 확인해줘',
      expected: [
        { serverId: 'station-guide', toolName: 'find_locker', params: { station: '서울' } },
        { serverId: 'mobility-equipment-rental', toolName: 'check_equipment_availability', params: { station: '서울', equipmentType: '전동스쿠터' } }
      ],
      ordered: false,
      category: '여객서비스',
      difficulty: 'medium',
      source: 'manual',
      notes: '서로 독립적인 두 조회이므로 호출 순서와 무관하게 정답으로 인정. 병렬 실행이 자연스러운지 확인.'
    },
    {
      id: 'bench-passenger-7',
      query: '탑승했던 KTX 안에서 냉방이 너무 약해서 불편했어. 민원으로 접수하고, 접수 후 처리 상태도 바로 확인할 수 있게 해줘',
      expected: [
        { serverId: 'civil-complaint-center', toolName: 'submit_complaint', params: { category: '시설', content: '열차 내 냉방이 너무 약합니다.' } },
        { serverId: 'civil-complaint-center', toolName: 'get_complaint_status' }
      ],
      alternatives: [
        [ { serverId: 'faq-chatbot-backend', toolName: 'search_faq', params: { query: '열차 냉방 민원', category: '시설' } } ]
      ],
      goal: { serverId: 'civil-complaint-center', toolName: 'get_complaint_status' },
      category: '여객서비스',
      difficulty: 'medium',
      source: 'manual',
      notes: '정식 민원 접수(complaintId 체이닝, 2단계)가 기본 정답. 단순 문의 성격이면 FAQ 검색만으로 답을 찾는 대안 워크플로우도 인정.'
    },
    {
      id: 'bench-passenger-8',
      query: 'KTX 101 지연 알림을 010-2222-3333으로 SMS 구독 신청하고, 예전에 만들어둔 구독(SUB-20260601-0099)은 이제 필요 없으니 해지해줘',
      expected: [
        { serverId: 'passenger-alert-subscription', toolName: 'subscribe_alert', params: { alertType: '지연', trainNo: 'KTX 101', channel: 'SMS', contact: '010-2222-3333' } },
        { serverId: 'passenger-alert-subscription', toolName: 'unsubscribe_alert', params: { subscriptionId: 'SUB-20260601-0099' } }
      ],
      ordered: false,
      category: '여객서비스',
      difficulty: 'hard',
      source: 'manual',
      notes: '신규 구독과 기존 구독 해지가 서로 다른 구독ID를 대상으로 하는 독립 작업이라 순서 무관. 두 식별자를 혼동하지 않는지 확인.'
    },
    {
      id: 'bench-passenger-9',
      query: '서울역에서 전동휠체어를 대여할 수 있는지 확인하고, 가능하면 내일 날짜로 예약한 뒤, 이용 후에는 부산역에서 반납 처리까지 한 번에 안내해줘',
      expected: [
        { serverId: 'mobility-equipment-rental', toolName: 'check_equipment_availability', params: { station: '서울', equipmentType: '전동휠체어' } },
        { serverId: 'mobility-equipment-rental', toolName: 'reserve_equipment', params: { station: '서울', date: '2026-07-06' } },
        { serverId: 'mobility-equipment-rental', toolName: 'return_equipment', params: { returnStation: '부산' } }
      ],
      goal: { serverId: 'mobility-equipment-rental', toolName: 'return_equipment' },
      category: '여객서비스',
      difficulty: 'hard',
      source: 'manual',
      notes: '조회에서 얻은 equipmentId가 예약 입력으로, 예약에서 발급된 reservationId가 반납 입력으로 이어지는 3단계 io 체이닝(필수 체인) 확인.'
    },
    {
      id: 'bench-passenger-10',
      query: '서울역에 대형 물품보관함이 남아있는지 확인하고, 있으면 내일 날짜로 예약한 다음, 보관한 짐을 서울시 강남구 테헤란로 123으로 배송 신청까지 해줘',
      expected: [
        { serverId: 'station-guide', toolName: 'find_locker', params: { station: '서울', size: '대형' } },
        { serverId: 'baggage-locker-booking', toolName: 'reserve_locker', params: { station: '서울', size: '대형', date: '2026-07-06' } },
        { serverId: 'baggage-locker-booking', toolName: 'request_baggage_delivery', params: { deliveryAddress: '서울시 강남구 테헤란로 123' } }
      ],
      goal: { serverId: 'baggage-locker-booking', toolName: 'request_baggage_delivery' },
      category: '여객서비스',
      difficulty: 'hard',
      source: 'manual',
      notes: '잔여현황 확인(station-guide)과 사전예약·배송 신청(baggage-locker-booking)이 서로 다른 서버로 이어지는 3단계 흐름. reserve_locker에서 발급된 reservationId가 배송 신청 입력으로 전달되는지 확인.'
    }
  ]
};
