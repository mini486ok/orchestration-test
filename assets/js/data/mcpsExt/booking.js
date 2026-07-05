// ============================================================================
// mcpsExt/booking.js — 예매·발권(豫買·發券) 분야 신규 MCP 서버 7종
// SPEC §1 McpServer/Tool 데이터 모델 준수. 순수 ES module.
// 기존 3개(rail-reservation, ticket-issuance, rail-pass-manager)와 id 충돌 없이
// 단체 예매·환불/취소·좌석배치도·대기예약·할인쿠폰·모바일QR·예약변경 영역을 보완한다.
//
// [서버 인덱스]
//  1. group-reservation-desk : 단체 예매 데스크
//  2. fare-refund-center     : 운임 환불·취소 센터
//  3. seat-map-selector      : 좌석배치도 선택
//  4. waitlist-manager       : 대기예약(입석/취소표) 관리
//  5. discount-coupon-hub    : 할인·쿠폰 자격 허브
//  6. mobile-qr-ticket       : 모바일 QR 티켓
//  7. reservation-rebooking  : 예약 변경·재발권
//
// io 체이닝: 기존 rail-reservation.reserve_seat 의 reservationId, 기존
// ticket-issuance.issue_ticket 의 ticketId, 기존 kr-train-schedule.search_trains
// 의 trainNo 를 신규 서버들의 입력으로 재사용해 2~3단계 워크플로우가 성립하도록 설계.
// ============================================================================

export const MCPS_BOOKING = [
  // --------------------------------------------------------------------------
  // 1. 단체 예매 데스크
  // --------------------------------------------------------------------------
  {
    id: 'group-reservation-desk',
    name: 'Group Reservation Desk',
    nameKo: '단체 예매 데스크',
    icon: '👥',
    category: '예매·발권',
    description: '10인 이상 단체 승객의 좌석 블록 잔여 여부와 단체 할인율을 조회하고, 대표자 명의로 단체 예약을 생성·세금계산서를 발행한다.',
    version: '1.0.0',
    tags: ['단체예매', '단체할인', 'group', '세금계산서'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'search_group_availability',
        description: '지정 구간·날짜·인원(10인 이상)에 대해 좌석을 연속 블록으로 확보 가능한 열차와 단체 할인율을 조회한다. 개인 좌석 잔여석 조회(check_seat_availability)와 달리 블록 좌석 확보 가능 여부를 판단하는 데 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '승차역', examples: ['서울'] },
            to: { type: 'string', description: '하차역', examples: ['부산'] },
            date: { type: 'string', format: 'date', description: '탑승일 (YYYY-MM-DD)', examples: ['2026-07-10'] },
            groupSize: { type: 'integer', minimum: 10, description: '단체 인원 수', examples: [25] }
          },
          required: ['from', 'to', 'date', 'groupSize']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '블록 확보 가능 열차번호' },
            availableBlockSeats: { type: 'integer', description: '연속 배치 가능한 좌석 수' },
            groupDiscountRate: { type: 'number', description: '단체 할인율(%)' },
            quoteId: { type: 'string', description: '단체 예약 견적 ID' }
          }
        },
        mock: {
          latencyMs: [180, 600],
          samples: [
            {
              trainNo: 'KTX 105',
              availableBlockSeats: 32,
              groupDiscountRate: 15,
              quoteId: 'GQ-20260710-0041'
            }
          ]
        }
      },
      {
        name: 'create_group_reservation',
        description: '견적 ID를 바탕으로 대표자 명의의 단체 예약을 생성하고 좌석 블록을 선점한다. 견적 조회와 달리 실제 단체 예약 생성(쓰기)에 사용하며 개인 예약(reserve_seat)과 달리 대표자 1인이 다수 좌석을 일괄 관리한다.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '예약할 열차번호', examples: ['KTX 105'] },
            date: { type: 'string', format: 'date', description: '탑승일' },
            groupSize: { type: 'integer', minimum: 10, description: '단체 인원 수', examples: [25] },
            representativeName: { type: 'string', description: '단체 대표자 성명', examples: ['박서준'] },
            quoteId: { type: 'string', description: '사전 조회한 견적 ID(선택)', examples: ['GQ-20260710-0041'] }
          },
          required: ['trainNo', 'date', 'groupSize', 'representativeName']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '단체 예약번호' },
            trainNo: { type: 'string' },
            seats: { type: 'array', items: { type: 'string' }, description: '배정된 좌석 목록' },
            totalFare: { type: 'number', description: '단체 할인 적용 총 운임' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'request_group_invoice',
        description: '완료된 단체 예약에 대해 사업자등록번호를 포함한 세금계산서 발행을 요청한다. 예약 생성이 아닌 정산 서류 발급(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '세금계산서 발행 대상 단체 예약번호', examples: ['GRP-20260710-0041'] },
            businessRegNo: { type: 'string', description: '사업자등록번호(선택)', examples: ['123-45-67890'] }
          },
          required: ['reservationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            invoiceId: { type: 'string' },
            reservationId: { type: 'string' },
            amount: { type: 'number' },
            issuedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 2. 운임 환불·취소 센터
  // --------------------------------------------------------------------------
  {
    id: 'fare-refund-center',
    name: 'Fare Refund Center',
    nameKo: '운임 환불·취소 센터',
    icon: '💸',
    category: '예매·발권',
    description: '승차권의 환불 가능 여부·수수료율을 사전 확인하고, 열차 지연·천재지변 등 사유별 정식 환불 신청을 접수해 처리 상태를 추적한다.',
    version: '1.0.0',
    tags: ['환불', '취소', 'refund', '수수료'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'check_refund_eligibility',
        description: '발권된 승차권의 환불 가능 여부와 예상 수수료율·환불 신청 마감시각을 사전 조회한다. 실제 환불 처리(refund_ticket, submit_refund_request)와 달리 신청 전 확인 단계에서 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string', description: '조회할 승차권 번호', examples: ['TK-20260705-A7F19'] }
          },
          required: ['ticketId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string' },
            eligible: { type: 'boolean', description: '환불 가능 여부' },
            refundRate: { type: 'number', description: '환불 예상 비율(%)' },
            penaltyFee: { type: 'number', description: '위약금·수수료 예상액(원)' },
            deadline: { type: 'string', format: 'date-time', description: '환불 신청 마감시각' }
          }
        },
        mock: {
          latencyMs: [110, 400],
          samples: [
            {
              ticketId: 'TK-20260705-A7F19',
              eligible: true,
              refundRate: 90,
              penaltyFee: 5980,
              deadline: '2026-07-05T07:50:00'
            }
          ]
        }
      },
      {
        name: 'submit_refund_request',
        description: '열차 지연·천재지변·단순 변심 등 사유를 명시해 정식 환불 신청을 접수한다. 즉시 계산되는 단순 반환(refund_ticket)과 달리 사유에 따라 무료 환불 심사 등 별도 처리가 필요한 건에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string', description: '환불 신청 대상 승차권 번호', examples: ['TK-20260705-A7F19'] },
            reason: { type: 'string', description: '환불 신청 사유', examples: ['출발 2시간 초과 지연'] },
            requestType: { type: 'string', enum: ['단순변심', '천재지변', '열차지연', '기타'], default: '단순변심', description: '신청 유형(무료 환불 심사 대상 구분)' }
          },
          required: ['ticketId', 'reason']
        },
        outputSchema: {
          type: 'object',
          properties: {
            refundRequestId: { type: 'string' },
            ticketId: { type: 'string' },
            status: { type: 'string' },
            expectedProcessDays: { type: 'integer', description: '예상 처리 소요일' }
          }
        }
      },
      {
        name: 'track_refund_request',
        description: '접수된 환불 신청번호로 심사·지급 진행 상태와 최종 환불액을 조회한다. 신규 신청이 아닌 진행 중 건의 추적에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            refundRequestId: { type: 'string', description: '조회할 환불 신청번호', examples: ['RFQ-20260705-0088'] }
          },
          required: ['refundRequestId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            refundRequestId: { type: 'string' },
            status: { type: 'string', description: '접수/심사중/지급완료/반려' },
            refundAmount: { type: 'number' },
            processedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 3. 좌석배치도 선택
  // --------------------------------------------------------------------------
  {
    id: 'seat-map-selector',
    name: 'Seat Map Selector',
    nameKo: '좌석배치도 선택',
    icon: '💺',
    category: '예매·발권',
    description: '열차 호차별 좌석배치도를 좌석 단위로 시각화 조회하고, 원하는 좌석을 임시 선점하거나 기존 예약의 좌석을 다른 좌석으로 교체한다.',
    version: '1.0.0',
    tags: ['좌석배치도', '좌석선택', 'seatmap', '호차'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_seat_map',
        description: '지정 열차·호차의 좌석 배치도를 좌석번호별 상태(공석/예약/선점)와 좌석 유형(창측/복도측 등)으로 조회한다. 등급별 잔여석 수만 알려주는 check_seat_availability와 달리 좌석 단위 시각 배치를 제공.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] },
            date: { type: 'string', format: 'date', description: '탑승일 (YYYY-MM-DD)' },
            carNo: { type: 'integer', minimum: 1, description: '호차 번호(선택, 미지정시 1호차)', default: 1, examples: [4] }
          },
          required: ['trainNo', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            carNo: { type: 'integer' },
            seatLayout: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  seatNo: { type: 'string' },
                  status: { type: 'string', description: '공석/예약됨/선점중' },
                  type: { type: 'string', description: '창측/복도측/일반' }
                }
              }
            },
            legend: { type: 'string', description: '배치도 범례 설명' }
          }
        },
        mock: {
          latencyMs: [130, 470],
          samples: [
            {
              carNo: 4,
              seatLayout: [
                { seatNo: '4호차 11A', status: '공석', type: '창측' },
                { seatNo: '4호차 11B', status: '예약됨', type: '복도측' },
                { seatNo: '4호차 12A', status: '공석', type: '창측' }
              ],
              legend: '녹색=공석, 회색=예약됨, 노랑=선점중'
            }
          ]
        }
      },
      {
        name: 'hold_seat',
        description: '좌석배치도에서 선택한 특정 좌석번호를 결제 전까지 임시 선점(락)한다. 등급 단위 예약(reserve_seat)과 달리 사용자가 직접 고른 좌석 하나를 짧은 시간 붙잡아두는 데 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] },
            date: { type: 'string', format: 'date', description: '탑승일' },
            seatNo: { type: 'string', description: '선점할 좌석번호', examples: ['4호차 12A'] },
            holdMinutes: { type: 'integer', minimum: 1, maximum: 30, description: '선점 유지 시간(분)', default: 5 }
          },
          required: ['trainNo', 'date', 'seatNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            holdId: { type: 'string' },
            seatNo: { type: 'string' },
            holdExpiresAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'swap_seat',
        description: '이미 확정된 예약의 좌석을 좌석배치도상 다른 공석으로 교체한다. 신규 선점(hold_seat)이나 예약 취소가 아닌 기존 예약 건의 좌석 변경에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '좌석을 교체할 예약번호', examples: ['RSV-20260705-0012'] },
            currentSeatNo: { type: 'string', description: '현재 배정 좌석번호', examples: ['4호차 12A'] },
            targetSeatNo: { type: 'string', description: '교체 희망 좌석번호', examples: ['4호차 11A'] }
          },
          required: ['reservationId', 'currentSeatNo', 'targetSeatNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            newSeatNo: { type: 'string' },
            success: { type: 'boolean' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 4. 대기예약(입석/취소표) 관리
  // --------------------------------------------------------------------------
  {
    id: 'waitlist-manager',
    name: 'Waitlist Manager',
    nameKo: '대기예약 관리',
    icon: '⏳',
    category: '예매·발권',
    description: '매진된 열차에 대한 취소표 발생 시 자동 배정을 위한 대기예약을 등록·조회하고, 순번 도래 시 좌석을 자동 확정한다.',
    version: '1.0.0',
    tags: ['대기예약', '취소표', 'waitlist', '자동배정'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'join_waitlist',
        description: '매진된 열차·구간에 대해 취소표 발생 시 자동 배정받을 대기예약을 등록한다. 잔여석이 있는 상태의 즉시 예약(reserve_seat)과 달리 매진 시 순번 대기에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '대기할 열차번호', examples: ['KTX 101'] },
            date: { type: 'string', format: 'date', description: '탑승일 (YYYY-MM-DD)' },
            from: { type: 'string', description: '승차역', examples: ['서울'] },
            to: { type: 'string', description: '하차역', examples: ['부산'] },
            passengers: { type: 'integer', minimum: 1, maximum: 9, description: '대기 인원 수', default: 1 }
          },
          required: ['trainNo', 'date', 'from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            waitlistId: { type: 'string' },
            position: { type: 'integer', description: '현재 대기 순번' },
            trainNo: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [120, 430],
          samples: [
            {
              waitlistId: 'WL-20260705-0056',
              position: 4,
              trainNo: 'KTX 101'
            }
          ]
        }
      },
      {
        name: 'check_waitlist_status',
        description: '대기예약번호로 현재 대기 순번과 확정 예상 시각을 조회한다. 신규 등록이 아닌 기존 대기 건의 진행 상황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            waitlistId: { type: 'string', description: '조회할 대기예약번호', examples: ['WL-20260705-0056'] }
          },
          required: ['waitlistId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            waitlistId: { type: 'string' },
            position: { type: 'integer' },
            status: { type: 'string', description: '대기중/확정/취소' },
            estimatedConfirmAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'confirm_waitlist_seat',
        description: '취소표 발생으로 순번이 도래한 대기예약을 좌석 배정 예약으로 확정한다. 대기 등록·조회와 달리 실제 좌석 확정(쓰기)에 사용하며 이후 발권(issue_ticket)으로 이어진다.',
        inputSchema: {
          type: 'object',
          properties: {
            waitlistId: { type: 'string', description: '확정할 대기예약번호', examples: ['WL-20260705-0056'] }
          },
          required: ['waitlistId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '확정된 예약번호(발권 시 사용)' },
            seatNo: { type: 'string' },
            confirmed: { type: 'boolean' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 5. 할인·쿠폰 자격 허브
  // --------------------------------------------------------------------------
  {
    id: 'discount-coupon-hub',
    name: 'Discount Coupon Hub',
    nameKo: '할인·쿠폰 자격 허브',
    icon: '🎟️',
    category: '예매·발권',
    description: '승객 유형·연령·회원카드 기준 할인 자격을 판정하고 프로모션 쿠폰의 유효성을 검증한 뒤, 확정 할인을 예약 건에 적용한다.',
    version: '1.0.0',
    tags: ['할인', '쿠폰', 'coupon', '프로모션'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'check_discount_eligibility',
        description: '승객 유형(경로우대/장애인/청소년 등)과 출생연도·회원카드 보유 여부로 할인 자격과 할인율을 판정한다. 쿠폰 코드 검증(validate_coupon)과 달리 신분 기반 상시 할인 자격 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            passengerType: { type: 'string', enum: ['일반', '경로우대', '장애인', '청소년', '어린이', '국가유공자'], description: '승객 유형' },
            birthYear: { type: 'integer', minimum: 1900, maximum: 2026, description: '출생연도(선택, 연령 확인용)', examples: [1958] },
            hasCard: { type: 'boolean', description: '복지카드/우대증 보유 여부(선택)', default: false }
          },
          required: ['passengerType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            eligible: { type: 'boolean' },
            discountRate: { type: 'number', description: '적용 가능 할인율(%)' },
            discountCode: { type: 'string', description: '적용용 할인 코드' }
          }
        },
        mock: {
          latencyMs: [90, 340],
          samples: [
            {
              eligible: true,
              discountRate: 30,
              discountCode: 'DC-SENIOR-30'
            }
          ]
        }
      },
      {
        name: 'validate_coupon',
        description: '프로모션 쿠폰 코드의 유효 여부와 할인액·유효기한을 검증한다. 신분 기반 할인 자격 조회와 달리 발급된 쿠폰 코드 자체의 사용 가능 여부 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            couponCode: { type: 'string', description: '검증할 쿠폰 코드', examples: ['SUMMER2026-15'] },
            trainNo: { type: 'string', description: '적용 대상 열차번호(선택, 노선 제한 쿠폰 검증용)', examples: ['KTX 101'] }
          },
          required: ['couponCode']
        },
        outputSchema: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            discountAmount: { type: 'number', description: '할인 금액(원)' },
            expiresAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'apply_discount_to_reservation',
        description: '판정받은 할인 코드 또는 검증된 쿠폰 코드를 기존 예약 건에 적용해 최종 운임을 재계산한다. 자격 판정·쿠폰 검증과 달리 실제 예약에 반영(쓰기)하는 단계에서 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '할인 적용 대상 예약번호', examples: ['RSV-20260705-0012'] },
            discountCode: { type: 'string', description: '적용할 할인/쿠폰 코드', examples: ['DC-SENIOR-30'] }
          },
          required: ['reservationId', 'discountCode']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            finalFare: { type: 'number', description: '할인 적용 후 최종 운임' },
            appliedDiscountAmount: { type: 'number' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 6. 모바일 QR 티켓
  // --------------------------------------------------------------------------
  {
    id: 'mobile-qr-ticket',
    name: 'Mobile QR Ticket',
    nameKo: '모바일 QR 티켓',
    icon: '📱',
    category: '예매·발권',
    description: '예약 건을 모바일 전용 QR 토큰으로 발급해 스마트폰 화면 제시만으로 개찰이 가능하게 하고, 게이트 인식 검증과 QR 재전송을 지원한다.',
    version: '1.0.0',
    tags: ['모바일티켓', 'QR', '개찰', 'mobile'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'generate_mobile_qr',
        description: '예약번호에 대해 스마트폰 앱 표시용 QR 토큰을 생성한다. 결제 확정 후 실물/PDF 승차권을 발급하는 issue_ticket과 달리, 모바일 화면 제시 전용 QR 토큰만 별도 생성·재발급하는 데 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: 'QR 발급 대상 예약번호', examples: ['RSV-20260705-0012'] },
            deviceId: { type: 'string', description: '등록할 모바일 기기 ID(선택)', examples: ['DEV-A0913F'] }
          },
          required: ['reservationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            qrToken: { type: 'string', description: '모바일 화면 표시용 QR 토큰' },
            ticketId: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time', description: 'QR 토큰 유효 만료시각' }
          }
        },
        mock: {
          latencyMs: [140, 480],
          samples: [
            {
              qrToken: 'MQR:9d3ac71b20',
              ticketId: 'TK-20260705-A7F19',
              expiresAt: '2026-07-05T23:59:00'
            }
          ]
        }
      },
      {
        name: 'validate_qr_at_gate',
        description: '개찰구에서 스캔한 QR 토큰의 유효성을 실시간 검증하고 통과 가능 여부를 반환한다. QR 생성이 아닌 실제 게이트 통과 시점의 인증 처리에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            qrToken: { type: 'string', description: '스캔된 QR 토큰', examples: ['MQR:9d3ac71b20'] },
            gateId: { type: 'string', description: '개찰구 ID(선택)', examples: ['GATE-SEOUL-03'] }
          },
          required: ['qrToken']
        },
        outputSchema: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            ticketId: { type: 'string' },
            gateResult: { type: 'string', description: '통과/거부/중복사용' }
          }
        }
      },
      {
        name: 'resend_qr_ticket',
        description: '기기 변경이나 QR 표시 오류 시 발권된 승차권의 QR 토큰을 지정한 휴대폰번호로 재전송한다. 신규 생성이 아닌 기존 티켓의 재발송(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string', description: '재전송할 승차권 번호', examples: ['TK-20260705-A7F19'] },
            phoneNumber: { type: 'string', description: '수신 휴대폰번호', examples: ['010-1234-5678'] }
          },
          required: ['ticketId', 'phoneNumber']
        },
        outputSchema: {
          type: 'object',
          properties: {
            sent: { type: 'boolean' },
            sentAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 7. 예약 변경·재발권
  // --------------------------------------------------------------------------
  {
    id: 'reservation-rebooking',
    name: 'Reservation Rebooking',
    nameKo: '예약 변경·재발권',
    icon: '🔄',
    category: '예매·발권',
    description: '기존 예약의 열차·날짜·좌석 등급 변경 수수료를 계산해 처리하고, 발권된 승차권을 분실·정보오류 사유로 재발권하며 변경 이력을 조회한다.',
    version: '1.0.0',
    tags: ['예약변경', '재발권', 'rebooking', '변경수수료'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'change_reservation',
        description: '기존 예약의 열차번호·탑승일·좌석 등급을 변경하고 변경 수수료를 계산한다. 예약 취소(cancel_reservation)와 달리 예약을 유지한 채 조건만 바꾸는 데 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '변경할 예약번호', examples: ['RSV-20260705-0012'] },
            newTrainNo: { type: 'string', description: '변경할 열차번호(선택)', examples: ['KTX 107'] },
            newDate: { type: 'string', format: 'date', description: '변경할 탑승일(선택)', examples: ['2026-07-06'] },
            newSeatClass: { type: 'string', enum: ['일반실', '특실', '입석'], description: '변경할 좌석 등급(선택)' }
          },
          required: ['reservationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            changeFee: { type: 'number', description: '변경 수수료(원)' },
            updatedTrainNo: { type: 'string' },
            updatedDate: { type: 'string', format: 'date' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [150, 520],
          samples: [
            {
              reservationId: 'RSV-20260705-0012',
              changeFee: 2000,
              updatedTrainNo: 'KTX 107',
              updatedDate: '2026-07-06',
              status: '변경완료'
            }
          ]
        }
      },
      {
        name: 'reissue_ticket',
        description: '분실·훼손·인쇄오류 등 사유로 이미 발권된 승차권을 동일 조건으로 재발권한다. 신규 발권(issue_ticket)과 달리 기존 결제 건에 대한 승차권 재발급(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string', description: '재발권할 승차권 번호', examples: ['TK-20260705-A7F19'] },
            reason: { type: 'string', description: '재발권 사유', examples: ['모바일 앱 오류로 QR 인식 불가'] }
          },
          required: ['ticketId', 'reason']
        },
        outputSchema: {
          type: 'object',
          properties: {
            newTicketId: { type: 'string' },
            reissuedAt: { type: 'string', format: 'date-time' },
            fee: { type: 'number', description: '재발권 수수료(원, 무료인 경우 0)' }
          }
        }
      },
      {
        name: 'get_change_history',
        description: '예약번호 기준 변경·재발권 이력을 시간 순으로 조회한다. 변경 실행이 아닌 과거 변경 내역 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '조회할 예약번호', examples: ['RSV-20260705-0012'] }
          },
          required: ['reservationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            history: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  changeId: { type: 'string' },
                  changedAt: { type: 'string', format: 'date-time' },
                  changeType: { type: 'string', description: '열차변경/날짜변경/등급변경/재발권' },
                  fee: { type: 'number' }
                }
              }
            }
          }
        }
      }
    ]
  }
];
