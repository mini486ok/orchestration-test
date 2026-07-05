// ============================================================================
// mcpsExt/passenger.js — 여객서비스 분야 신규 MCP 서버 7종
// 기존(sampleMcps.js) 여객서비스 3종: passenger-assist, lost-and-found, station-guide
// 신규 7종은 위 3종과 id·기능이 겹치지 않도록 설계된 상호보완 서버.
// SPEC §3 McpServer/Tool 데이터 모델 준수. 순수 ES module.
//
// [신규 서버 인덱스]
//  1. mobility-equipment-rental    : 이동보조기기(휠체어·전동스쿠터) 대여
//  2. civil-complaint-center       : 민원 접수·처리 상태·만족도 피드백
//  3. baggage-locker-booking       : 물품보관함 사전예약·취소·수하물 배송
//  4. station-lounge-service       : 대합실·라운지 좌석 조회·예약·체크인
//  5. multilingual-passenger-guide : 다국어 안내방송 번역·환승경로·통역요청
//  6. passenger-alert-subscription : 지연·도착·게이트변경 알림 구독 관리
//  7. faq-chatbot-backend          : FAQ 검색·대화로그·상담원 에스컬레이션
//
// 전체 도구 수: 21개 (7개 서버 × 3)
// mock 샘플 포함 도구: 7개 (각 서버 대표 도구 1개씩)
// ============================================================================

export const MCPS_PASSENGER = [
  // ==========================================================================
  // 1. 이동보조기기 대여 — 교통약자 이동지원(휠체어) 테마, passenger-assist(즉시 지원 요청·에스코트 예약)와
  //    달리 '장비 대여' 자체의 가용 조회→예약→반납 라이프사이클을 담당.
  // ==========================================================================
  {
    id: 'mobility-equipment-rental',
    name: 'Mobility Equipment Rental',
    nameKo: '이동보조기기 대여',
    icon: '🦽',
    category: '여객서비스',
    description: '교통약자를 위한 휠체어·전동스쿠터 등 이동보조기기의 역별 대여 가능 현황을 조회하고, 대여 예약과 반납 처리를 지원한다.',
    version: '1.0.0',
    tags: ['교통약자', '이동보조기기', '휠체어', '대여'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'check_equipment_availability',
        description: '역별로 대여 가능한 이동보조기기(수동휠체어·전동휠체어·전동스쿠터)의 종류와 잔여 수량을 조회한다. 실제 대여 신청이 아닌 가용 현황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회할 역', examples: ['서울'] },
            equipmentType: { type: 'string', enum: ['수동휠체어', '전동휠체어', '전동스쿠터', '전체'], default: '전체', description: '기기 종류' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            equipmentType: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  equipmentId: { type: 'string' },
                  model: { type: 'string' },
                  available: { type: 'integer' }
                }
              }
            },
            count: { type: 'integer', description: '조회된 기종 수' }
          }
        },
        mock: {
          latencyMs: [110, 380],
          samples: [
            {
              station: '서울',
              equipmentType: '전체',
              items: [
                { equipmentId: 'MEQ-WC-01', model: '수동휠체어 표준형', available: 4 },
                { equipmentId: 'MEQ-EW-02', model: '전동휠체어 A타입', available: 1 },
                { equipmentId: 'MEQ-ES-03', model: '전동스쿠터 소형', available: 2 }
              ],
              count: 3
            }
          ]
        }
      },
      {
        name: 'reserve_equipment',
        description: '조회된 이동보조기기를 특정 일시에 대여 예약해 예약번호와 수령 장소를 발급한다. 가용 현황 조회가 아닌 실제 대여 예약(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            equipmentId: { type: 'string', description: '대여할 기기 ID', examples: ['MEQ-WC-01'] },
            station: { type: 'string', description: '수령할 역', examples: ['서울'] },
            date: { type: 'string', format: 'date', description: '대여 이용일' },
            userName: { type: 'string', description: '이용자 성명', examples: ['김민준'] }
          },
          required: ['equipmentId', 'station', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            equipmentId: { type: 'string' },
            pickupLocation: { type: 'string' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'return_equipment',
        description: '대여했던 이동보조기기를 지정 역에서 반납 처리하고 반납 확인 정보를 기록한다. 신규 예약이 아닌 반납 처리(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '반납할 예약 ID', examples: ['MER-20260705-0012'] },
            returnStation: { type: 'string', description: '반납 역', examples: ['부산'] }
          },
          required: ['reservationId', 'returnStation']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            returnedAt: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 2. 민원·피드백 센터
  // ==========================================================================
  {
    id: 'civil-complaint-center',
    name: 'Civil Complaint Center',
    nameKo: '민원·피드백 센터',
    icon: '📮',
    category: '여객서비스',
    description: '승객이 제기하는 민원·불편사항을 분류별로 접수하고 처리 상태를 조회하며, 이용 만족도 피드백을 수집한다.',
    version: '1.0.0',
    tags: ['민원', '피드백', '고객의소리', '불편신고'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'submit_complaint',
        description: '지연·시설·서비스태도 등 불편사항이나 민원을 분류·내용과 함께 접수해 접수번호를 발급받는다. 상태 조회가 아닌 신규 접수(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['지연', '시설', '서비스태도', '안전', '기타'], description: '민원 분류' },
            station: { type: 'string', description: '관련 역(선택)', examples: ['대전'] },
            content: { type: 'string', description: '민원 상세 내용', examples: ['열차 내 냉방이 너무 약합니다.'] },
            contactPhone: { type: 'string', description: '회신받을 연락처(선택)' }
          },
          required: ['category', 'content']
        },
        outputSchema: {
          type: 'object',
          properties: {
            complaintId: { type: 'string' },
            status: { type: 'string' },
            expectedResponseDays: { type: 'integer', description: '예상 답변 소요일' }
          }
        },
        mock: {
          latencyMs: [130, 420],
          samples: [
            { complaintId: 'CC-20260705-0231', status: '접수완료', expectedResponseDays: 3 }
          ]
        }
      },
      {
        name: 'get_complaint_status',
        description: '접수번호로 민원 처리 진행 상태와 답변 내용을 조회한다. 신규 접수가 아닌 기접수 건 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            complaintId: { type: 'string', description: '조회할 민원 접수번호', examples: ['CC-20260705-0231'] }
          },
          required: ['complaintId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            complaintId: { type: 'string' },
            status: { type: 'string' },
            response: { type: 'string' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'submit_satisfaction_survey',
        description: '역·열차 이용 경험에 대한 만족도 점수와 의견을 제출한다. 민원 접수와 달리 정기 만족도 설문(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '이용 역', examples: ['수서'] },
            rating: { type: 'integer', minimum: 1, maximum: 5, description: '만족도 점수(1~5)' },
            comment: { type: 'string', description: '의견(선택)' }
          },
          required: ['station', 'rating']
        },
        outputSchema: {
          type: 'object',
          properties: {
            surveyId: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 3. 물품보관함 사전예약 — station-guide(find_locker 실시간 잔여 조회)와 달리
  //    사전예약·취소·수하물 배송 연계까지 포함.
  // ==========================================================================
  {
    id: 'baggage-locker-booking',
    name: 'Baggage Locker Booking',
    nameKo: '물품보관함 사전예약',
    icon: '🔐',
    category: '여객서비스',
    description: '역 물품보관함을 원하는 시간대에 사전 예약하고, 예약을 취소하거나 장기 보관 수하물을 지정 주소로 배송 신청한다.',
    version: '1.0.0',
    tags: ['물품보관함', '수하물', '예약', '배송'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'reserve_locker',
        description: '원하는 역·크기·이용일의 물품보관함을 사전 예약해 보관함 코드를 발급받는다. 실시간 잔여 현황 조회가 아닌 사전 예약(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '예약할 역', examples: ['서울'] },
            size: { type: 'string', enum: ['소형', '중형', '대형'], default: '소형', description: '보관함 크기' },
            date: { type: 'string', format: 'date', description: '이용일' },
            userName: { type: 'string', description: '예약자 성명', examples: ['최유진'] }
          },
          required: ['station', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            station: { type: 'string' },
            lockerCode: { type: 'string' },
            expireAt: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [120, 400],
          samples: [
            { reservationId: 'BLB-20260705-0088', station: '서울', lockerCode: 'L-3F-042', expireAt: '2026-07-05T22:00:00Z', status: '예약완료' }
          ]
        }
      },
      {
        name: 'cancel_locker_reservation',
        description: '기존 물품보관함 예약을 취소한다. 신규 예약이 아닌 예약 취소 처리(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '취소할 예약 ID', examples: ['BLB-20260705-0088'] }
          },
          required: ['reservationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'request_baggage_delivery',
        description: '보관함에 맡긴 수하물을 지정 주소로 배송 신청한다. 보관함 예약과 달리 배송 연계 서비스(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '배송할 보관함 예약 ID', examples: ['BLB-20260705-0088'] },
            deliveryAddress: { type: 'string', description: '배송지 주소', examples: ['서울시 강남구 테헤란로 123'] }
          },
          required: ['reservationId', 'deliveryAddress']
        },
        outputSchema: {
          type: 'object',
          properties: {
            deliveryId: { type: 'string' },
            reservationId: { type: 'string' },
            status: { type: 'string' },
            estimatedArrival: { type: 'string', format: 'date' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 4. 대합실·라운지 서비스
  // ==========================================================================
  {
    id: 'station-lounge-service',
    name: 'Station Lounge Service',
    nameKo: '대합실·라운지 서비스',
    icon: '🛋️',
    category: '여객서비스',
    description: '역 KTX 라운지·우선좌석 대합공간의 잔여 좌석과 대기시간을 조회하고, 좌석 이용을 예약·체크인 처리한다.',
    version: '1.0.0',
    tags: ['라운지', '대합실', '좌석예약', '우선좌석'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'check_lounge_availability',
        description: '역별 라운지·대합실 유형의 잔여 좌석 수와 예상 대기시간을 조회한다. 예약이 아닌 현황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회할 역', examples: ['부산'] },
            loungeType: { type: 'string', enum: ['KTX라운지', '우선좌석', '수유실대합공간', '전체'], default: '전체', description: '라운지 유형' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            loungeType: { type: 'string' },
            seatsAvailable: { type: 'integer' },
            waitTimeMin: { type: 'integer', description: '예상 대기시간(분)' }
          }
        },
        mock: {
          latencyMs: [100, 350],
          samples: [
            { station: '부산', loungeType: 'KTX라운지', seatsAvailable: 6, waitTimeMin: 0 }
          ]
        }
      },
      {
        name: 'reserve_lounge_seat',
        description: '라운지·대합실 좌석을 일시·인원수로 예약하고 입장용 티켓코드를 발급한다. 현황 조회가 아닌 실제 예약(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '예약할 역', examples: ['부산'] },
            loungeType: { type: 'string', enum: ['KTX라운지', '우선좌석', '수유실대합공간'], description: '라운지 유형' },
            date: { type: 'string', format: 'date', description: '이용일' },
            time: { type: 'string', format: 'time', description: '이용 희망 시각', examples: ['13:30'] },
            partySize: { type: 'integer', minimum: 1, maximum: 10, default: 1, description: '이용 인원' }
          },
          required: ['station', 'loungeType', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            station: { type: 'string' },
            seatNo: { type: 'string' },
            ticketCode: { type: 'string' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'checkin_lounge',
        description: '발급받은 티켓코드로 라운지 입장 체크인을 처리한다. 예약이 아닌 실제 입장 확인(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketCode: { type: 'string', description: '입장 티켓코드', examples: ['LNG-TCK-7734'] }
          },
          required: ['ticketCode']
        },
        outputSchema: {
          type: 'object',
          properties: {
            ticketCode: { type: 'string' },
            status: { type: 'string' },
            checkedInAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 5. 다국어 여객 안내
  // ==========================================================================
  {
    id: 'multilingual-passenger-guide',
    name: 'Multilingual Passenger Guide',
    nameKo: '다국어 여객 안내',
    icon: '🌐',
    category: '여객서비스',
    description: '외국인 승객을 위해 안내방송·표지 문구를 다국어로 번역하고, 환승 경로를 다국어로 안내하며 통역 도우미 동행을 요청한다.',
    version: '1.0.0',
    tags: ['다국어', '외국인', '번역', '통역'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'translate_announcement',
        description: '역 안내방송·공지 문구를 지정 언어로 번역한다. 경로 안내가 아닌 단순 문구 번역에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '번역할 원문', examples: ['3번 승강장 열차가 곧 도착합니다.'] },
            targetLang: { type: 'string', enum: ['영어', '중국어', '일본어', '베트남어'], description: '번역 대상 언어' }
          },
          required: ['text', 'targetLang']
        },
        outputSchema: {
          type: 'object',
          properties: {
            originalText: { type: 'string' },
            targetLang: { type: 'string' },
            translatedText: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [90, 300],
          samples: [
            { originalText: '3번 승강장 열차가 곧 도착합니다.', targetLang: '영어', translatedText: 'The train for platform 3 will arrive shortly.' }
          ]
        }
      },
      {
        name: 'get_multilingual_route_guide',
        description: '출발역에서 목적지까지의 환승 경로를 지정 언어로 단계별 안내한다. 단순 문구 번역이 아닌 경로 안내 생성에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '출발역', examples: ['서울'] },
            destination: { type: 'string', description: '목적지', examples: ['명동'] },
            lang: { type: 'string', enum: ['영어', '중국어', '일본어', '베트남어'], default: '영어', description: '안내 언어' }
          },
          required: ['station', 'destination']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            destination: { type: 'string' },
            lang: { type: 'string' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  order: { type: 'integer' },
                  instruction: { type: 'string' }
                }
              }
            }
          }
        }
      },
      {
        name: 'request_interpreter',
        description: '특정 역·시간에 외국어 통역 도우미 동행을 요청한다. 번역 텍스트 제공이 아닌 실제 인력 배치 요청(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '요청 역', examples: ['인천공항'] },
            lang: { type: 'string', enum: ['영어', '중국어', '일본어', '베트남어'], description: '필요 언어' },
            time: { type: 'string', format: 'time', description: '희망 시각', examples: ['09:00'] }
          },
          required: ['station', 'lang']
        },
        outputSchema: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            station: { type: 'string' },
            lang: { type: 'string' },
            assignedInterpreter: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 6. 승객 알림 구독
  // ==========================================================================
  {
    id: 'passenger-alert-subscription',
    name: 'Passenger Alert Subscription',
    nameKo: '승객 알림 구독',
    icon: '🔔',
    category: '여객서비스',
    description: '열차 지연·도착·게이트 변경 등 개인화 알림을 채널별로 구독 신청하고, 구독 상태를 조회하거나 해지한다.',
    version: '1.0.0',
    tags: ['알림', '구독', '푸시', 'SMS'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'subscribe_alert',
        description: '지연·도착·게이트변경 등 알림 유형을 열차·역 기준으로 구독 신청한다. 상태 조회가 아닌 신규 구독(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            alertType: { type: 'string', enum: ['지연', '도착', '게이트변경', '전체'], description: '알림 유형' },
            trainNo: { type: 'string', description: '대상 열차번호(선택)', examples: ['KTX 101'] },
            station: { type: 'string', description: '대상 역(선택)', examples: ['서울'] },
            channel: { type: 'string', enum: ['SMS', '앱푸시', '이메일'], default: '앱푸시', description: '알림 수신 채널' },
            contact: { type: 'string', description: '수신처(전화번호/이메일)', examples: ['010-1234-5678'] }
          },
          required: ['alertType', 'contact']
        },
        outputSchema: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string' },
            alertType: { type: 'string' },
            channel: { type: 'string' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [100, 320],
          samples: [
            { subscriptionId: 'SUB-20260705-0512', alertType: '지연', channel: '앱푸시', status: '구독중' }
          ]
        }
      },
      {
        name: 'unsubscribe_alert',
        description: '기존 알림 구독을 해지한다. 신규 구독이 아닌 구독 취소 처리(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string', description: '해지할 구독 ID', examples: ['SUB-20260705-0512'] }
          },
          required: ['subscriptionId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'get_subscription_status',
        description: '구독번호로 알림 활성 여부와 최근 발송 이력을 조회한다. 신규/해지가 아닌 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string', description: '조회할 구독 ID', examples: ['SUB-20260705-0512'] }
          },
          required: ['subscriptionId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string' },
            alertType: { type: 'string' },
            active: { type: 'boolean' },
            lastNotifiedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 7. FAQ 챗봇 백엔드
  // ==========================================================================
  {
    id: 'faq-chatbot-backend',
    name: 'FAQ Chatbot Backend',
    nameKo: 'FAQ 챗봇 백엔드',
    icon: '🤖',
    category: '여객서비스',
    description: '승객 대상 자주 묻는 질문을 검색하고 챗봇 대화 로그를 기록하며, FAQ로 해결되지 않은 문의를 상담원에게 에스컬레이션한다.',
    version: '1.0.0',
    tags: ['FAQ', '챗봇', '상담', '에스컬레이션'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'search_faq',
        description: '자연어 질의와 분류로 자주 묻는 질문·답변을 검색한다. 상담원 연결이 아닌 자동 답변 검색에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '질의 문장', examples: ['환불은 어떻게 하나요?'] },
            category: { type: 'string', enum: ['예매', '환불', '시설', '교통약자', '전체'], default: '전체', description: '질의 분류' }
          },
          required: ['query']
        },
        outputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  faqId: { type: 'string' },
                  question: { type: 'string' },
                  answer: { type: 'string' },
                  score: { type: 'number' }
                }
              }
            },
            count: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [80, 260],
          samples: [
            {
              query: '환불은 어떻게 하나요?',
              results: [
                { faqId: 'FAQ-0091', question: '승차권 환불 방법이 궁금합니다', answer: '출발 전에는 앱·역창구에서 수수료와 함께 환불 가능합니다.', score: 0.92 }
              ],
              count: 1
            }
          ]
        }
      },
      {
        name: 'log_chat_interaction',
        description: '챗봇 세션의 사용자·챗봇 발화를 대화 로그로 기록한다. 검색이 아닌 로그 적재(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: '챗봇 세션 ID', examples: ['SESS-9931'] },
            message: { type: 'string', description: '발화 내용' },
            role: { type: 'string', enum: ['user', 'bot'], description: '발화 주체' }
          },
          required: ['sessionId', 'message', 'role']
        },
        outputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            logged: { type: 'boolean' },
            turnCount: { type: 'integer', description: '누적 대화 턴 수' }
          }
        }
      },
      {
        name: 'escalate_to_agent',
        description: 'FAQ로 해결되지 않은 문의를 상담원에게 에스컬레이션하고 상담 대기 정보를 발급한다. 로그 기록이 아닌 실제 인계 처리(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: '에스컬레이션할 세션 ID', examples: ['SESS-9931'] },
            reason: { type: 'string', description: '에스컬레이션 사유', examples: ['환불 정책 예외 문의'] }
          },
          required: ['sessionId', 'reason']
        },
        outputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string' },
            sessionId: { type: 'string' },
            status: { type: 'string' },
            estimatedWaitMin: { type: 'integer' }
          }
        }
      }
    ]
  }
];
