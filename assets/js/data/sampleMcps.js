// ============================================================================
// sampleMcps.js — 철도·교통 분야 샘플 MCP 서버 30종 (카테고리 10종 × 3개)
// SPEC §3 McpServer/Tool 데이터 모델 준수. 순수 ES module.
//
// [카테고리별 서버 인덱스]
//  ● 운행정보     : kr-train-schedule, train-position-tracker, train-delay-monitor
//  ● 예매·발권    : rail-reservation, ticket-issuance, rail-pass-manager
//  ● 안전·관제    : signal-control, track-safety-monitor, emergency-dispatch
//  ● 시설·유지보수: track-maintenance, facility-asset-manager, catenary-power-monitor
//  ● 물류·화물    : freight-tracking, cargo-booking, rail-yard-manager
//  ● 도시교통     : subway-navigator, bus-transit, platform-congestion
//  ● 여객서비스   : passenger-assist, lost-and-found, station-guide
//  ● 기상·환경    : rail-weather, air-quality-monitor, disaster-alert
//  ● 데이터분석   : ridership-analytics, punctuality-analytics, demand-forecast
//  ● 요금·정산    : fare-calculator, transit-settlement, payment-gateway
//
// 전체 도구 수: 90개 (28개 서버 × 3 + subway-navigator 4 + air-quality-monitor 2)
// mock 샘플 포함 도구: 30개 (각 서버 대표 도구 1개씩, 전체의 1/3)
// ============================================================================

export const SAMPLE_MCPS = [
  // ==========================================================================
  // 1. 운행정보 (運行情報)
  // ==========================================================================
  {
    id: 'kr-train-schedule',
    name: 'KR Train Schedule',
    nameKo: '열차 운행정보 조회',
    icon: '🚆',
    category: '운행정보',
    description: '전국 KTX·SRT·일반열차의 시간표와 편성을 출발역·도착역·날짜 기준으로 검색하고, 역별 시간표와 특정 열차의 정차역 상세를 제공한다.',
    version: '1.0.0',
    tags: ['KTX', 'SRT', '시간표', 'schedule'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'search_trains',
        description: '출발역·도착역·날짜(선택적으로 출발 희망시각·열차종별)로 이용 가능한 열차 편성을 검색한다. "몇 시 기차 있어?", "서울에서 부산 가는 KTX" 같은 시간표 조회에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발역 이름', examples: ['서울', '수서'] },
            to: { type: 'string', description: '도착역 이름', examples: ['부산', '동대구'] },
            date: { type: 'string', format: 'date', description: '출발 희망일 (YYYY-MM-DD)', examples: ['2026-07-05'] },
            departAfter: { type: 'string', format: 'time', description: '이 시각 이후 출발 편성만 조회 (HH:MM)', examples: ['08:00'] },
            trainType: { type: 'string', enum: ['KTX', 'SRT', 'ITX', '무궁화', '전체'], default: '전체', description: '열차 종별 필터' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trains: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  trainNo: { type: 'string', description: '열차번호' },
                  type: { type: 'string', description: '열차 종별' },
                  departure: { type: 'string', description: '출발 시각' },
                  arrival: { type: 'string', description: '도착 시각' },
                  duration: { type: 'string', description: '소요 시간' },
                  fare: { type: 'number', description: '일반실 운임(원)' },
                  seatsAvailable: { type: 'boolean', description: '잔여석 유무' }
                }
              }
            },
            count: { type: 'integer', description: '검색된 편성 수' }
          }
        },
        mock: {
          latencyMs: [150, 550],
          samples: [
            {
              trains: [
                { trainNo: 'KTX 101', type: 'KTX', departure: '08:00', arrival: '10:39', duration: '2시간39분', fare: 59800, seatsAvailable: true },
                { trainNo: 'KTX 103', type: 'KTX', departure: '08:30', arrival: '11:12', duration: '2시간42분', fare: 59800, seatsAvailable: true },
                { trainNo: 'ITX-새마을 1003', type: 'ITX', departure: '08:20', arrival: '13:05', duration: '4시간45분', fare: 42600, seatsAvailable: false }
              ],
              count: 3
            }
          ]
        }
      },
      {
        name: 'get_station_timetable',
        description: '특정 역의 상·하행 출발/도착 시간표를 시간대별로 조회한다. 편성 검색이 아니라 "이 역에서 출발하는 열차 목록"이 필요할 때 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회할 역 이름', examples: ['대전'] },
            direction: { type: 'string', enum: ['상행', '하행', '전체'], default: '전체', description: '운행 방향' },
            date: { type: 'string', format: 'date', description: '조회 날짜 (YYYY-MM-DD)' },
            hour: { type: 'integer', minimum: 0, maximum: 23, description: '조회 시간대(시)', examples: [9] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            timetable: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  trainNo: { type: 'string' },
                  type: { type: 'string' },
                  scheduledTime: { type: 'string' },
                  destination: { type: 'string' },
                  platform: { type: 'string' },
                  direction: { type: 'string' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_train_detail',
        description: '열차번호로 해당 열차의 전체 정차역·역별 도착/출발 시각·승강장을 조회한다. "이 KTX가 어디어디 서?" 같은 정차역 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] },
            date: { type: 'string', format: 'date', description: '운행 날짜 (YYYY-MM-DD)' }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            type: { type: 'string' },
            operator: { type: 'string' },
            totalStops: { type: 'integer' },
            route: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  station: { type: 'string' },
                  arrival: { type: 'string' },
                  departure: { type: 'string' },
                  platform: { type: 'string' }
                }
              }
            }
          }
        }
      }
    ]
  },
  {
    id: 'train-position-tracker',
    name: 'Train Position Tracker',
    nameKo: '실시간 열차 위치 추적',
    icon: '📍',
    category: '운행정보',
    description: '운행 중인 열차의 실시간 GPS 위치와 다음 정차역 도착 예정시각(ETA)을 추적하고, 노선 단위의 전체 운행 상황을 한눈에 제공한다.',
    version: '1.0.0',
    tags: ['실시간', 'GPS', 'ETA', 'tracking'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'track_train',
        description: '특정 열차번호의 현재 실시간 위치(구간·좌표·속도)를 추적한다. "지금 이 기차 어디쯤 왔어?" 같은 현재 위치 확인에 사용. 시간표 조회가 아님.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '추적할 열차번호', examples: ['KTX 101', 'SRT 301'] }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            currentSection: { type: 'string', description: '현재 운행 구간' },
            lat: { type: 'number' },
            lon: { type: 'number' },
            speed: { type: 'number', description: '현재 속도(km/h)' },
            nextStation: { type: 'string' },
            delayMin: { type: 'integer', description: '지연(분)' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [90, 350],
          samples: [
            {
              trainNo: 'KTX 101',
              currentSection: '천안아산~오송',
              lat: 36.7845,
              lon: 127.1042,
              speed: 298,
              nextStation: '오송',
              delayMin: 0,
              updatedAt: '2026-07-04T09:12:30'
            }
          ]
        }
      },
      {
        name: 'estimate_arrival',
        description: '특정 열차가 지정한 역에 언제 도착할지 실시간 운행 데이터 기반 ETA를 계산한다. 마중·환승 타이밍 계산에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] },
            station: { type: 'string', description: '도착 예정을 알고 싶은 역', examples: ['동대구'] }
          },
          required: ['trainNo', 'station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            station: { type: 'string' },
            scheduledArrival: { type: 'string' },
            estimatedArrival: { type: 'string' },
            delayMin: { type: 'integer' },
            confidence: { type: 'number', description: '예측 신뢰도(%)' }
          }
        }
      },
      {
        name: 'get_line_status',
        description: '노선(예: 경부선) 전체에서 현재 운행 중인 모든 열차의 위치·지연을 한 번에 조회한다. 개별 열차가 아니라 노선 전반 상황 파악에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부선', '호남선'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            activeTrains: { type: 'integer' },
            avgDelayMin: { type: 'number' },
            trains: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  trainNo: { type: 'string' },
                  currentSection: { type: 'string' },
                  delayMin: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    ]
  },
  {
    id: 'train-delay-monitor',
    name: 'Train Delay Monitor',
    nameKo: '열차 지연·운행중단 현황',
    icon: '⏱️',
    category: '운행정보',
    description: '열차 지연 현황과 지연 원인, 사고·재해로 인한 운행중단·감축 정보를 제공하고, 특정 열차에 대한 지연 알림 구독을 관리한다.',
    version: '1.0.0',
    tags: ['지연', '운행중단', 'delay', '알림'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_delays',
        description: '현재 지연 중인 열차 목록과 지연 시간·사유를 조회한다. 노선이나 역으로 범위를 좁힐 수 있다. "오늘 기차 많이 밀려?" 같은 지연 현황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명(선택)', examples: ['경부선'] },
            minDelay: { type: 'integer', minimum: 0, description: '이 값(분) 이상 지연된 편성만 조회', default: 5 }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            delayedTrains: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  trainNo: { type: 'string' },
                  line: { type: 'string' },
                  delayMin: { type: 'integer' },
                  cause: { type: 'string' }
                }
              }
            },
            count: { type: 'integer' },
            avgDelayMin: { type: 'number' }
          }
        },
        mock: {
          latencyMs: [120, 450],
          samples: [
            {
              delayedTrains: [
                { trainNo: 'ITX-새마을 1015', line: '경부선', delayMin: 12, cause: '선행열차 지연 연쇄' },
                { trainNo: '무궁화 1207', line: '경부선', delayMin: 8, cause: '승강장 혼잡으로 인한 정차 지연' },
                { trainNo: 'KTX 121', line: '경부선', delayMin: 6, cause: '기상(집중호우) 서행' }
              ],
              count: 3,
              avgDelayMin: 8.7
            }
          ]
        }
      },
      {
        name: 'get_disruptions',
        description: '사고·자연재해·시설장애로 인한 운행중단·우회·감축 등 서비스 장애 공지를 조회한다. 단순 지연이 아닌 중대 운행 차질 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '지역/노선(선택)', examples: ['호남선'] },
            date: { type: 'string', format: 'date', description: '조회 날짜' }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            disruptions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  line: { type: 'string' },
                  section: { type: 'string' },
                  type: { type: 'string', description: '중단/우회/감축 등' },
                  reason: { type: 'string' },
                  since: { type: 'string', format: 'date-time' },
                  expectedRecovery: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        }
      },
      {
        name: 'subscribe_delay_alert',
        description: '특정 열차의 지연 발생 시 알림을 받도록 구독을 등록한다. 조회가 아니라 알림 등록(쓰기) 작업에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '알림 받을 열차번호', examples: ['KTX 101'] },
            channel: { type: 'string', enum: ['SMS', '앱푸시', '이메일'], default: '앱푸시', description: '알림 채널' },
            thresholdMin: { type: 'integer', minimum: 1, description: '이 지연(분) 초과 시 알림', default: 5 }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string' },
            trainNo: { type: 'string' },
            channel: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 2. 예매·발권 (豫買·發券)
  // ==========================================================================
  {
    id: 'rail-reservation',
    name: 'Rail Reservation',
    nameKo: '열차 좌석 예매',
    icon: '🎫',
    category: '예매·발권',
    description: '열차 편성의 잔여 좌석을 조회하고 원하는 좌석을 예약·취소한다. 운임 결제 전 좌석 선점과 예약 관리를 담당한다.',
    version: '1.0.0',
    tags: ['예매', '좌석', 'reservation', '잔여석'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'check_seat_availability',
        description: '특정 열차의 좌석 등급별(일반/특실) 잔여석 수와 잔여 좌석 위치를 조회한다. 예약 실행 전 좌석 여유 확인에 사용. 시간표 검색과 구분됨.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] },
            date: { type: 'string', format: 'date', description: '탑승일 (YYYY-MM-DD)', examples: ['2026-07-05'] },
            from: { type: 'string', description: '승차역', examples: ['서울'] },
            to: { type: 'string', description: '하차역', examples: ['부산'] }
          },
          required: ['trainNo', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            classes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  seatClass: { type: 'string', description: '좌석 등급' },
                  available: { type: 'integer', description: '잔여석 수' },
                  fare: { type: 'number' }
                }
              }
            },
            standingAvailable: { type: 'boolean', description: '입석 가능 여부' }
          }
        },
        mock: {
          latencyMs: [110, 400],
          samples: [
            {
              trainNo: 'KTX 101',
              classes: [
                { seatClass: '일반실', available: 47, fare: 59800 },
                { seatClass: '특실', available: 9, fare: 83700 }
              ],
              standingAvailable: true
            }
          ]
        }
      },
      {
        name: 'reserve_seat',
        description: '지정한 열차·구간·인원으로 좌석을 예약(선점)한다. 조회가 아닌 실제 예약 생성(쓰기)에 사용하며 예약번호를 반환한다.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] },
            date: { type: 'string', format: 'date', description: '탑승일' },
            from: { type: 'string', description: '승차역', examples: ['서울'] },
            to: { type: 'string', description: '하차역', examples: ['부산'] },
            seatClass: { type: 'string', enum: ['일반실', '특실', '입석'], default: '일반실', description: '좌석 등급' },
            passengers: { type: 'integer', minimum: 1, maximum: 9, description: '승객 수', default: 1 }
          },
          required: ['trainNo', 'date', 'from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            trainNo: { type: 'string' },
            seats: { type: 'array', items: { type: 'string' } },
            totalFare: { type: 'number' },
            holdExpiresAt: { type: 'string', format: 'date-time', description: '결제 기한' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'cancel_reservation',
        description: '예약번호로 좌석 예약을 취소한다. 이미 발권된 승차권 환불과 달리 결제 전 예약 선점 해제에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '취소할 예약번호', examples: ['RSV-20260705-0012'] }
          },
          required: ['reservationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            status: { type: 'string' },
            releasedSeats: { type: 'integer' }
          }
        }
      }
    ]
  },
  {
    id: 'ticket-issuance',
    name: 'Ticket Issuance',
    nameKo: '승차권 발권·환불',
    icon: '🖨️',
    category: '예매·발권',
    description: '예약 또는 즉시 구매 건을 결제와 함께 승차권으로 발권하고 QR/바코드를 발급하며, 발권된 승차권의 조회와 환불·반환 수수료 처리를 담당한다.',
    version: '1.0.0',
    tags: ['발권', 'QR', '환불', 'ticket'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'issue_ticket',
        description: '예약번호에 대해 결제를 확정하고 QR코드 승차권을 발권한다. 좌석 예약(선점)과 달리 최종 승차권 발급(결제 완료)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string', description: '발권 대상 예약번호', examples: ['RSV-20260705-0012'] },
            paymentMethod: { type: 'string', enum: ['카드', '간편결제', '포인트', '현장'], default: '카드', description: '결제 수단' }
          },
          required: ['reservationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string' },
            qrCode: { type: 'string', description: 'QR 인증 코드' },
            trainNo: { type: 'string' },
            seats: { type: 'array', items: { type: 'string' } },
            paidAmount: { type: 'number' },
            issuedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [200, 700],
          samples: [
            {
              ticketId: 'TK-20260705-A7F19',
              qrCode: 'QR:8f21ac09e4',
              trainNo: 'KTX 101',
              seats: ['4호차 12A'],
              paidAmount: 59800,
              issuedAt: '2026-07-04T09:20:15'
            }
          ]
        }
      },
      {
        name: 'get_ticket',
        description: '승차권 번호로 발권된 승차권의 상세(열차·좌석·QR·상태)를 조회한다. 발권이나 환불이 아닌 기존 승차권 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string', description: '승차권 번호', examples: ['TK-20260705-A7F19'] }
          },
          required: ['ticketId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string' },
            trainNo: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            departure: { type: 'string', format: 'date-time' },
            seats: { type: 'array', items: { type: 'string' } },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'refund_ticket',
        description: '발권된 승차권을 반환·환불하고 출발 시각 기준 반환 수수료를 계산해 환불액을 산정한다. 예약 취소(결제 전)와 달리 결제 완료 건 환불에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string', description: '환불할 승차권 번호', examples: ['TK-20260705-A7F19'] },
            reason: { type: 'string', description: '환불 사유(선택)', examples: ['개인 일정 변경'] }
          },
          required: ['ticketId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string' },
            paidAmount: { type: 'number' },
            feeAmount: { type: 'number', description: '반환 수수료' },
            refundAmount: { type: 'number' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },
  {
    id: 'rail-pass-manager',
    name: 'Rail Pass Manager',
    nameKo: '정기권·레일패스 관리',
    icon: '🪪',
    category: '예매·발권',
    description: '통근용 정기권과 기간형 레일패스(내일로 등) 상품을 검색·구매하고, 보유 정기권의 잔여 기간·횟수를 조회한다.',
    version: '1.0.0',
    tags: ['정기권', '레일패스', 'pass', '통근'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'search_passes',
        description: '이용 구간·유형(통근/기간형)에 맞는 정기권·레일패스 상품과 가격을 검색한다. 낱장 승차권 예매가 아닌 정기 상품 탐색에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            passType: { type: 'string', enum: ['통근정기권', '기간형패스', '청소년패스', '전체'], default: '전체', description: '패스 유형' },
            from: { type: 'string', description: '주 이용 구간 출발역(통근권)', examples: ['수원'] },
            to: { type: 'string', description: '주 이용 구간 도착역(통근권)', examples: ['서울'] }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            passes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  productId: { type: 'string' },
                  name: { type: 'string' },
                  passType: { type: 'string' },
                  durationDays: { type: 'integer' },
                  price: { type: 'number' },
                  benefit: { type: 'string' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [130, 480],
          samples: [
            {
              passes: [
                { productId: 'PASS-CM-30', name: '광역전철 통근정기권(30일)', passType: '통근정기권', durationDays: 30, price: 62700, benefit: '지정 구간 무제한' },
                { productId: 'PASS-NR-5', name: '내일로 5일권', passType: '기간형패스', durationDays: 5, price: 68500, benefit: '무궁화·누리로 자유이용' },
                { productId: 'PASS-YT-7', name: '청소년 레일패스 7일', passType: '청소년패스', durationDays: 7, price: 79000, benefit: '만 25세 이하 할인' }
              ]
            }
          ]
        }
      },
      {
        name: 'purchase_pass',
        description: '선택한 정기권/패스 상품을 구매하고 사용 시작일을 지정한다. 상품 검색과 달리 실제 구매(쓰기) 처리에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'string', description: '구매할 상품 ID', examples: ['PASS-NR-5'] },
            startDate: { type: 'string', format: 'date', description: '사용 개시일 (YYYY-MM-DD)', examples: ['2026-07-10'] },
            holderName: { type: 'string', description: '이용자 성명', examples: ['김민준'] }
          },
          required: ['productId', 'startDate']
        },
        outputSchema: {
          type: 'object',
          properties: {
            passId: { type: 'string' },
            productName: { type: 'string' },
            validFrom: { type: 'string', format: 'date' },
            validTo: { type: 'string', format: 'date' },
            paidAmount: { type: 'number' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'check_pass_balance',
        description: '보유한 정기권/패스의 잔여 유효기간·잔여 이용 횟수를 조회한다. 상품 구매가 아닌 보유 패스 잔량 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            passId: { type: 'string', description: '조회할 패스 ID', examples: ['PASS-20260710-0034'] }
          },
          required: ['passId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            passId: { type: 'string' },
            productName: { type: 'string' },
            validTo: { type: 'string', format: 'date' },
            remainingDays: { type: 'integer' },
            remainingRides: { type: 'integer', description: '잔여 횟수(횟수형만)' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 3. 안전·관제 (安全·管制)
  // ==========================================================================
  {
    id: 'signal-control',
    name: 'Signal Control',
    nameKo: '신호 시스템 관제',
    icon: '🚦',
    category: '안전·관제',
    description: '지상·차상 신호기의 현시 상태와 연동장치·진로 설정 상태를 감시하고, 신호 장애를 관제실에 신고한다.',
    version: '1.0.0',
    tags: ['신호', '연동장치', 'signal', '관제'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_signal_status',
        description: '특정 역·구간 신호기의 현재 현시(정지/주의/진행)와 점등 상태를 조회한다. 선로 점유나 서행과 달리 신호기 자체 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회 역/신호소', examples: ['대전조차장'] },
            signalId: { type: 'string', description: '특정 신호기 ID(선택)', examples: ['SIG-DJ-14'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            signals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  signalId: { type: 'string' },
                  aspect: { type: 'string', description: '현시(정지/주의/감속/진행)' },
                  lamp: { type: 'string', description: '점등 상태' },
                  status: { type: 'string' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [80, 300],
          samples: [
            {
              station: '대전조차장',
              signals: [
                { signalId: 'SIG-DJ-14', aspect: '진행', lamp: '녹색', status: '정상' },
                { signalId: 'SIG-DJ-15', aspect: '주의', lamp: '황색', status: '정상' },
                { signalId: 'SIG-DJ-16', aspect: '정지', lamp: '적색', status: '정상' }
              ]
            }
          ]
        }
      },
      {
        name: 'get_interlocking',
        description: '연동장치의 진로 설정·쇄정 상태와 선로전환기 개통 방향을 조회한다. 신호 현시가 아닌 진로·전철기 연동 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회 역', examples: ['동대구'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            routes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  routeId: { type: 'string' },
                  fromTrack: { type: 'string' },
                  toTrack: { type: 'string' },
                  locked: { type: 'boolean' },
                  switchPosition: { type: 'string', description: '정위/반위' }
                }
              }
            }
          }
        }
      },
      {
        name: 'report_signal_fault',
        description: '신호기 오작동·소등 등 장애를 관제실에 신고하고 접수번호를 발급한다. 상태 조회가 아닌 장애 신고(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            signalId: { type: 'string', description: '장애 신호기 ID', examples: ['SIG-DJ-14'] },
            faultType: { type: 'string', enum: ['소등', '오현시', '점멸', '통신두절', '기타'], description: '장애 유형' },
            note: { type: 'string', description: '상세 설명(선택)' }
          },
          required: ['signalId', 'faultType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reportId: { type: 'string' },
            signalId: { type: 'string' },
            priority: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },
  {
    id: 'track-safety-monitor',
    name: 'Track Safety Monitor',
    nameKo: '선로 안전 관제',
    icon: '🛡️',
    category: '안전·관제',
    description: '선로 점유 상태와 지장물·장애물 감지 현황을 실시간 감시하고, 재해·공사에 따른 서행(속도제한) 구간을 관리한다.',
    version: '1.0.0',
    tags: ['선로안전', '지장물', '서행', 'safety'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_track_occupancy',
        description: '지정 구간의 궤도회로별 열차 점유 상태를 조회한다. 신호기 현시가 아닌 어느 블록에 열차가 있는지 점유 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부선'] },
            section: { type: 'string', description: '구간(선택)', examples: ['서울~광명'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            blocks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  blockId: { type: 'string' },
                  occupied: { type: 'boolean' },
                  trainNo: { type: 'string' }
                }
              }
            }
          }
        }
      },
      {
        name: 'detect_obstacle',
        description: '선로 위 지장물·낙석·침입자 등 장애물 감지 이벤트를 조회한다. 점유·서행과 구분되는 이상 지장물 탐지에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['중앙선'] },
            sinceMin: { type: 'integer', minimum: 1, description: '최근 N분 이내 이벤트', default: 60 }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  eventId: { type: 'string' },
                  location: { type: 'string' },
                  obstacleType: { type: 'string', description: '낙석/침입/동물/기타' },
                  severity: { type: 'string' },
                  detectedAt: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [100, 400],
          samples: [
            {
              events: [
                { eventId: 'OBS-20260704-003', location: '중앙선 원주~제천 K142.6', obstacleType: '낙석', severity: '경고', detectedAt: '2026-07-04T08:47:00' }
              ]
            }
          ]
        }
      },
      {
        name: 'get_speed_restriction',
        description: '공사·재해·선로결함으로 설정된 서행(속도제한) 구간과 제한속도를 조회한다. 지연 조회가 아닌 구간별 속도 제한 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['호남선'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            restrictions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  section: { type: 'string' },
                  limitKmh: { type: 'integer' },
                  reason: { type: 'string' },
                  until: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        }
      }
    ]
  },
  {
    id: 'emergency-dispatch',
    name: 'Emergency Dispatch',
    nameKo: '비상 관제·사고 대응',
    icon: '🚨',
    category: '안전·관제',
    description: '철도 사고·인명·화재 등 비상상황을 접수하고 유관 부서 출동을 지령하며, 사고 처리 진행 상황을 추적한다.',
    version: '1.0.0',
    tags: ['비상', '사고대응', 'emergency', '지령'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'report_incident',
        description: '철도 사고·인명사고·화재·탈선 등 비상상황을 관제센터에 접수하고 사고번호를 발급한다. 신호/시설 장애 신고와 달리 인명·안전 비상 접수에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '사고 발생 위치(역/구간)', examples: ['동대구역 3번 승강장'] },
            incidentType: { type: 'string', enum: ['인명', '화재', '탈선', '충돌', '정전', '기타'], description: '사고 유형' },
            severity: { type: 'string', enum: ['경미', '중대', '심각'], default: '중대', description: '심각도' },
            description: { type: 'string', description: '상황 설명', examples: ['승강장 승객 선로 추락'] }
          },
          required: ['location', 'incidentType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            incidentId: { type: 'string' },
            severity: { type: 'string' },
            status: { type: 'string' },
            reportedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [90, 320],
          samples: [
            {
              incidentId: 'INC-20260704-0007',
              severity: '중대',
              status: '접수완료',
              reportedAt: '2026-07-04T09:05:12'
            }
          ]
        }
      },
      {
        name: 'dispatch_response',
        description: '접수된 사고에 대해 소방·구급·복구반 등 대응 자원의 출동을 지령한다. 사고 접수와 달리 대응 인력·장비 파견(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            incidentId: { type: 'string', description: '대상 사고번호', examples: ['INC-20260704-0007'] },
            units: { type: 'array', description: '출동 요청 자원 목록', items: { type: 'string' } }
          },
          required: ['incidentId', 'units']
        },
        outputSchema: {
          type: 'object',
          properties: {
            dispatchId: { type: 'string' },
            incidentId: { type: 'string' },
            dispatchedUnits: { type: 'array', items: { type: 'string' } },
            etaMin: { type: 'integer' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'get_incident_status',
        description: '사고번호로 대응 진행 상황·투입 자원·복구 예상시각을 조회한다. 신규 접수·출동 지령이 아닌 진행 중 사고 추적에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            incidentId: { type: 'string', description: '조회할 사고번호', examples: ['INC-20260704-0007'] }
          },
          required: ['incidentId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            incidentId: { type: 'string' },
            phase: { type: 'string', description: '접수/대응/복구/종결' },
            unitsOnSite: { type: 'integer' },
            expectedRecovery: { type: 'string', format: 'date-time' },
            affectedTrains: { type: 'integer' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 4. 시설·유지보수 (施設·維持補修)
  // ==========================================================================
  {
    id: 'track-maintenance',
    name: 'Track Maintenance',
    nameKo: '선로 유지보수',
    icon: '🛠️',
    category: '시설·유지보수',
    description: '선로(레일·침목·도상)의 점검 일정을 등록하고 과거 점검 이력을 조회하며, 발견된 궤도 결함을 보고한다.',
    version: '1.0.0',
    tags: ['선로점검', '레일', '유지보수', 'maintenance'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'schedule_inspection',
        description: '지정 구간의 선로 점검(궤도검측·육안점검) 작업을 야간 선로차단 시간대에 예약 등록한다. 점검 이력 조회가 아닌 신규 점검 일정 생성에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부선'] },
            section: { type: 'string', description: '점검 구간', examples: ['천안~조치원'] },
            inspectionType: { type: 'string', enum: ['궤도검측', '육안점검', '초음파탐상', '레일연마'], description: '점검 종류' },
            date: { type: 'string', format: 'date', description: '점검 예정일 (YYYY-MM-DD)', examples: ['2026-07-08'] }
          },
          required: ['line', 'section', 'inspectionType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            inspectionId: { type: 'string' },
            section: { type: 'string' },
            windowStart: { type: 'string', format: 'date-time' },
            windowEnd: { type: 'string', format: 'date-time' },
            crew: { type: 'string' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'get_inspection_history',
        description: '특정 구간·시설의 과거 점검 기록과 결과(양호/주의/불량)를 조회한다. 신규 점검 등록이 아닌 이력 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['호남선'] },
            section: { type: 'string', description: '구간(선택)', examples: ['익산~정읍'] },
            months: { type: 'integer', minimum: 1, maximum: 60, description: '최근 N개월 이력', default: 12 }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            records: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  inspectionId: { type: 'string' },
                  date: { type: 'string', format: 'date' },
                  inspectionType: { type: 'string' },
                  result: { type: 'string' },
                  findings: { type: 'integer', description: '지적 건수' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [140, 520],
          samples: [
            {
              records: [
                { inspectionId: 'INS-20260601-021', date: '2026-06-01', inspectionType: '궤도검측', result: '양호', findings: 0 },
                { inspectionId: 'INS-20260415-014', date: '2026-04-15', inspectionType: '초음파탐상', result: '주의', findings: 2 },
                { inspectionId: 'INS-20260210-008', date: '2026-02-10', inspectionType: '육안점검', result: '양호', findings: 1 }
              ]
            }
          ]
        }
      },
      {
        name: 'report_defect',
        description: '점검 중 발견한 레일 균열·체결구 이완·도상 침하 등 결함을 보고하고 보수 우선순위를 산정한다. 상태 조회가 아닌 결함 등록(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '결함 위치(km정 표기 권장)', examples: ['경부선 K124.3 상선'] },
            defectType: { type: 'string', enum: ['레일균열', '체결구이완', '도상침하', '침목손상', '이음매불량'], description: '결함 유형' },
            severity: { type: 'string', enum: ['경미', '주의', '긴급'], default: '주의', description: '심각도' }
          },
          required: ['location', 'defectType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            defectId: { type: 'string' },
            priority: { type: 'string' },
            recommendedAction: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },
  {
    id: 'facility-asset-manager',
    name: 'Facility Asset Manager',
    nameKo: '시설 자산 관리',
    icon: '🏗️',
    category: '시설·유지보수',
    description: '역사·교량·터널·스크린도어 등 철도 시설 자산의 상태와 내용연수를 관리하고, 교체·정비가 임박한 자산 목록과 정비 이력을 제공한다.',
    version: '1.0.0',
    tags: ['자산관리', '시설', 'asset', '내용연수'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_asset_status',
        description: '특정 시설 자산(교량·터널·승강기·스크린도어 등)의 건전도 등급과 최근 상태를 조회한다. 선로 결함이 아닌 구조물·설비 자산 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: '자산 ID(선택)', examples: ['AST-BR-0421'] },
            facilityType: { type: 'string', enum: ['교량', '터널', '승강기', '스크린도어', '역사', '전체'], default: '전체', description: '시설 종류' },
            station: { type: 'string', description: '소재 역(선택)', examples: ['부산'] }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            assets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  assetId: { type: 'string' },
                  facilityType: { type: 'string' },
                  location: { type: 'string' },
                  healthGrade: { type: 'string', description: 'A~E 건전도' },
                  status: { type: 'string' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [120, 460],
          samples: [
            {
              assets: [
                { assetId: 'AST-BR-0421', facilityType: '교량', location: '경부선 낙동강교량', healthGrade: 'B', status: '정상' },
                { assetId: 'AST-PSD-1188', facilityType: '스크린도어', location: '부산역 4번 승강장', healthGrade: 'C', status: '점검중' }
              ]
            }
          ]
        }
      },
      {
        name: 'list_assets_due',
        description: '내용연수 초과 임박 또는 교체 주기가 도래한 자산 목록을 우선순위와 함께 조회한다. 개별 상태 조회가 아닌 교체 대상 스크리닝에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            withinMonths: { type: 'integer', minimum: 1, maximum: 36, description: '향후 N개월 내 도래 대상', default: 6 },
            facilityType: { type: 'string', enum: ['교량', '터널', '승강기', '스크린도어', '역사', '전체'], default: '전체', description: '시설 종류' }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            dueAssets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  assetId: { type: 'string' },
                  facilityType: { type: 'string' },
                  location: { type: 'string' },
                  dueDate: { type: 'string', format: 'date' },
                  priority: { type: 'string' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      },
      {
        name: 'log_maintenance',
        description: '자산에 수행한 정비·교체 작업 내역을 기록한다. 상태 조회가 아닌 정비 이력 등록(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: '정비한 자산 ID', examples: ['AST-PSD-1188'] },
            workType: { type: 'string', enum: ['정기점검', '부품교체', '수리', '전면교체'], description: '작업 종류' },
            performedAt: { type: 'string', format: 'date', description: '작업 수행일', examples: ['2026-07-04'] },
            note: { type: 'string', description: '작업 상세(선택)' }
          },
          required: ['assetId', 'workType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            logId: { type: 'string' },
            assetId: { type: 'string' },
            nextDueDate: { type: 'string', format: 'date' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },
  {
    id: 'catenary-power-monitor',
    name: 'Catenary Power Monitor',
    nameKo: '전차선·전력 감시',
    icon: '⚡',
    category: '시설·유지보수',
    description: '전차선(가선)의 급전 상태와 전압·장력을 감시하고, 변전소 급전 구간의 정전·전력 장애를 감지·보고한다.',
    version: '1.0.0',
    tags: ['전차선', '급전', '전력', 'catenary'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_power_status',
        description: '급전 구간(변전소~구분소)의 급전 상태와 공급 전압을 조회한다. 신호·자산이 아닌 전력 급전 계통 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string', description: '급전 구간/변전소', examples: ['경부선 대전급전구분소'] }
          },
          required: ['section']
        },
        outputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string' },
            energized: { type: 'boolean', description: '급전 여부' },
            voltageKv: { type: 'number', description: '가선 전압(kV)' },
            loadPercent: { type: 'number', description: '부하율(%)' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [100, 380],
          samples: [
            {
              section: '경부선 대전급전구분소',
              energized: true,
              voltageKv: 25.4,
              loadPercent: 63.2,
              status: '정상'
            }
          ]
        }
      },
      {
        name: 'get_catenary_tension',
        description: '전차선(조가선·트롤리선)의 장력과 편위·높이 등 가선 기하 상태를 조회한다. 급전 전압이 아닌 가선 물리 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['호남선'] },
            section: { type: 'string', description: '구간(선택)', examples: ['익산~광주송정'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            spans: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  spanId: { type: 'string' },
                  tensionKn: { type: 'number', description: '장력(kN)' },
                  heightMm: { type: 'number', description: '가선 높이(mm)' },
                  stagger: { type: 'number', description: '편위(mm)' },
                  status: { type: 'string' }
                }
              }
            }
          }
        }
      },
      {
        name: 'report_power_fault',
        description: '정전·지락·단전 등 전력 계통 장애를 보고하고 급전 재개 조치를 요청한다. 상태 조회가 아닌 전력 장애 신고(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string', description: '장애 발생 급전 구간', examples: ['경부선 대전급전구분소'] },
            faultType: { type: 'string', enum: ['정전', '지락', '단전', '전압강하', '기타'], description: '장애 유형' }
          },
          required: ['section', 'faultType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reportId: { type: 'string' },
            section: { type: 'string' },
            affectedTrains: { type: 'integer' },
            estimatedRestore: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 5. 물류·화물 (物流·貨物)
  // ==========================================================================
  {
    id: 'freight-tracking',
    name: 'Freight Tracking',
    nameKo: '화물 운송 추적',
    icon: '📦',
    category: '물류·화물',
    description: '화물열차와 컨테이너·화차의 실시간 위치를 추적하고 화물열차 운행 시간표와 도착 예정시각을 제공한다.',
    version: '1.0.0',
    tags: ['화물', '컨테이너', 'freight', '추적'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'track_shipment',
        description: '운송장번호 또는 컨테이너번호로 화물의 현재 위치와 운송 단계를 추적한다. 여객열차 추적이 아닌 화물 화주용 배송 추적에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trackingNo: { type: 'string', description: '운송장/컨테이너 번호', examples: ['CN-KR-778102'] }
          },
          required: ['trackingNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trackingNo: { type: 'string' },
            cargoType: { type: 'string' },
            currentLocation: { type: 'string' },
            phase: { type: 'string', description: '적재/운송중/도착/하역' },
            trainNo: { type: 'string' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [110, 420],
          samples: [
            {
              trackingNo: 'CN-KR-778102',
              cargoType: '컨테이너(40ft)',
              currentLocation: '오봉역 인근 경부선',
              phase: '운송중',
              trainNo: 'F-3012',
              updatedAt: '2026-07-04T09:15:40'
            }
          ]
        }
      },
      {
        name: 'get_freight_schedule',
        description: '출발 조차장·목적지 기준 화물열차 운행 시간표를 조회한다. 여객 시간표가 아닌 화물열차 편성 스케줄 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발 조차장/역', examples: ['오봉'] },
            to: { type: 'string', description: '도착 조차장/역', examples: ['부산신항'] },
            date: { type: 'string', format: 'date', description: '운행일' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            services: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  trainNo: { type: 'string' },
                  departure: { type: 'string' },
                  arrival: { type: 'string' },
                  cargoTypes: { type: 'array', items: { type: 'string' } },
                  capacityTon: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'estimate_freight_eta',
        description: '운송 중인 화물의 목적지 도착 예정시각(ETA)을 계산한다. 여객 ETA와 달리 화물열차의 조차·중계 지연을 반영해 산정한다.',
        inputSchema: {
          type: 'object',
          properties: {
            trackingNo: { type: 'string', description: '운송장/컨테이너 번호', examples: ['CN-KR-778102'] }
          },
          required: ['trackingNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trackingNo: { type: 'string' },
            destination: { type: 'string' },
            estimatedArrival: { type: 'string', format: 'date-time' },
            delayMin: { type: 'integer' },
            confidence: { type: 'number' }
          }
        }
      }
    ]
  },
  {
    id: 'cargo-booking',
    name: 'Cargo Booking',
    nameKo: '화물 운송 예약',
    icon: '🚛',
    category: '물류·화물',
    description: '화물 운송 운임을 견적하고 화차·컨테이너 운송을 예약하며, 예약된 컨테이너의 배차·적재 상태를 관리한다.',
    version: '1.0.0',
    tags: ['화물예약', '운임', 'cargo', '컨테이너'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'quote_freight',
        description: '화물 종류·중량·구간으로 철도 운송 운임을 견적한다. 여객 운임 계산이 아닌 화물 물류 견적에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '발송 조차장/역', examples: ['오봉'] },
            to: { type: 'string', description: '도착 조차장/역', examples: ['부산신항'] },
            cargoType: { type: 'string', enum: ['컨테이너', '시멘트', '유류', '광석', '자갈', '일반'], description: '화물 종류' },
            weightTon: { type: 'number', minimum: 1, description: '중량(톤)', examples: [24] }
          },
          required: ['from', 'to', 'cargoType', 'weightTon']
        },
        outputSchema: {
          type: 'object',
          properties: {
            quoteId: { type: 'string' },
            baseFare: { type: 'number' },
            surcharge: { type: 'number', description: '특수화물 할증' },
            totalFare: { type: 'number' },
            transitDays: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [150, 560],
          samples: [
            {
              quoteId: 'FQ-20260704-0231',
              baseFare: 412000,
              surcharge: 38000,
              totalFare: 450000,
              transitDays: 1
            }
          ]
        }
      },
      {
        name: 'book_freight',
        description: '견적을 바탕으로 화차/컨테이너 운송을 예약하고 운송장을 발행한다. 견적 조회와 달리 실제 운송 계약 예약(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            quoteId: { type: 'string', description: '견적 ID', examples: ['FQ-20260704-0231'] },
            shipper: { type: 'string', description: '화주명', examples: ['한국물류(주)'] },
            pickupDate: { type: 'string', format: 'date', description: '발송 희망일' }
          },
          required: ['quoteId', 'shipper']
        },
        outputSchema: {
          type: 'object',
          properties: {
            bookingId: { type: 'string' },
            trackingNo: { type: 'string' },
            assignedTrain: { type: 'string' },
            totalFare: { type: 'number' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'get_container_status',
        description: '예약된 컨테이너/화차의 배차·적재·봉인 상태를 조회한다. 운송 추적(위치)이 아닌 예약 건의 준비 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            bookingId: { type: 'string', description: '예약 ID', examples: ['FB-20260704-0119'] }
          },
          required: ['bookingId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            bookingId: { type: 'string' },
            containerNo: { type: 'string' },
            loadingStatus: { type: 'string', description: '배차대기/적재중/적재완료/봉인' },
            yard: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },
  {
    id: 'rail-yard-manager',
    name: 'Rail Yard Manager',
    nameKo: '조차장·입환 관리',
    icon: '🏭',
    category: '물류·화물',
    description: '조차장(야드)의 유치선 점유 현황을 관리하고 화차 입환(조성·해방) 작업을 계획하며, 열차 조성에 선로를 배정한다.',
    version: '1.0.0',
    tags: ['조차장', '입환', 'yard', '유치선'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_yard_status',
        description: '조차장의 유치선별 점유 화차 수와 여유 용량을 조회한다. 운송 예약이 아닌 야드 내 선로 점유 현황 파악에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            yard: { type: 'string', description: '조차장명', examples: ['오봉', '제천'] }
          },
          required: ['yard']
        },
        outputSchema: {
          type: 'object',
          properties: {
            yard: { type: 'string' },
            tracks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  trackId: { type: 'string' },
                  occupiedCars: { type: 'integer' },
                  capacity: { type: 'integer' },
                  status: { type: 'string' }
                }
              }
            },
            totalIdleCars: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [120, 440],
          samples: [
            {
              yard: '오봉',
              tracks: [
                { trackId: '1선', occupiedCars: 18, capacity: 24, status: '정상' },
                { trackId: '2선', occupiedCars: 24, capacity: 24, status: '만선' },
                { trackId: '3선', occupiedCars: 6, capacity: 24, status: '정상' }
              ],
              totalIdleCars: 48
            }
          ]
        }
      },
      {
        name: 'schedule_shunting',
        description: '화차 입환(조성·분리·이동) 작업을 시간대와 입환기관차에 배정해 계획한다. 조회가 아닌 입환 작업 계획 등록(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            yard: { type: 'string', description: '조차장명', examples: ['오봉'] },
            operation: { type: 'string', enum: ['조성', '해방', '이동', '검수회송'], description: '입환 작업 종류' },
            targetTrain: { type: 'string', description: '대상 열차/화차군', examples: ['F-3012'] },
            plannedAt: { type: 'string', format: 'date-time', description: '작업 예정 일시' }
          },
          required: ['yard', 'operation']
        },
        outputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            assignedLoco: { type: 'string', description: '배정 입환기' },
            windowStart: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'assign_track',
        description: '조성 예정 열차에 유치선/발착선을 배정한다. 야드 현황 조회나 입환 계획과 달리 특정 선로 지정 배정에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            yard: { type: 'string', description: '조차장명', examples: ['제천'] },
            trainNo: { type: 'string', description: '조성 대상 열차번호', examples: ['F-3105'] },
            preferredTrack: { type: 'string', description: '선호 선로(선택)', examples: ['4선'] }
          },
          required: ['yard', 'trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            assignedTrack: { type: 'string' },
            departureSlot: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 6. 도시교통 (都市交通)
  // ==========================================================================
  {
    id: 'subway-navigator',
    name: 'Subway Navigator',
    nameKo: '지하철 경로·환승 안내',
    icon: '🚇',
    category: '도시교통',
    description: '도시철도 역 간 최적 경로와 환승 정보를 안내하고, 소요시간·요금·환승 동선과 역 출구 정보를 제공한다.',
    version: '1.0.0',
    tags: ['지하철', '환승', 'subway', '경로'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'find_route',
        description: '지하철 출발역에서 도착역까지 최소시간/최소환승 경로를 탐색한다. 간선철도(KTX) 검색이 아닌 도시철도 역 간 길찾기에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발 지하철역', examples: ['강남'] },
            to: { type: 'string', description: '도착 지하철역', examples: ['홍대입구'] },
            preference: { type: 'string', enum: ['최소시간', '최소환승', '최소도보'], default: '최소시간', description: '경로 선호' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            totalMin: { type: 'integer' },
            transfers: { type: 'integer' },
            fare: { type: 'number' },
            path: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  line: { type: 'string' },
                  board: { type: 'string' },
                  alight: { type: 'string' },
                  stops: { type: 'integer' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [90, 350],
          samples: [
            {
              totalMin: 34,
              transfers: 1,
              fare: 1500,
              path: [
                { line: '2호선', board: '강남', alight: '을지로3가', stops: 9 },
                { line: '2호선', board: '을지로3가', alight: '홍대입구', stops: 7 }
              ]
            }
          ]
        }
      },
      {
        name: 'get_transfer_info',
        description: '특정 환승역에서 노선 간 환승 동선·소요시간·빠른환승 위치(승차칸)를 안내한다. 전체 경로 탐색이 아닌 단일 환승역 상세 안내에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '환승역', examples: ['사당'] },
            fromLine: { type: 'string', description: '환승 전 노선', examples: ['2호선'] },
            toLine: { type: 'string', description: '환승 후 노선', examples: ['4호선'] }
          },
          required: ['station', 'fromLine', 'toLine']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            walkMin: { type: 'number', description: '환승 도보 시간(분)' },
            fastTransferCar: { type: 'string', description: '빠른환승 승차 위치' },
            direction: { type: 'string' }
          }
        }
      },
      {
        name: 'get_station_exits',
        description: '지하철역의 출구별 인근 주요 시설·버스정류장 연계 정보를 조회한다. 경로 안내가 아닌 목적지 출구 찾기에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '지하철역', examples: ['시청'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            exits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  exitNo: { type: 'string' },
                  landmarks: { type: 'array', items: { type: 'string' } },
                  busStop: { type: 'boolean' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_first_last_train',
        description: '특정 역·노선의 첫차·막차 시각을 조회한다. 일반 경로/시간표가 아닌 첫차·막차 확인에 특화.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '지하철역', examples: ['잠실'] },
            line: { type: 'string', description: '노선', examples: ['2호선'] },
            direction: { type: 'string', description: '방향(선택)', examples: ['외선순환'] }
          },
          required: ['station', 'line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            line: { type: 'string' },
            firstTrain: { type: 'string', format: 'time' },
            lastTrain: { type: 'string', format: 'time' }
          }
        }
      }
    ]
  },
  {
    id: 'bus-transit',
    name: 'Bus Transit',
    nameKo: '버스 정보·환승',
    icon: '🚌',
    category: '도시교통',
    description: '시내·광역버스 노선을 검색하고 정류장별 실시간 도착정보를 제공하며, 버스-지하철 간 연계 환승 경로를 안내한다.',
    version: '1.0.0',
    tags: ['버스', '도착정보', 'bus', '환승'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'search_bus_routes',
        description: '노선번호 또는 출발·도착지로 버스 노선을 검색한다. 지하철 경로가 아닌 버스 노선 자체 조회에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            routeNo: { type: 'string', description: '버스 노선번호(선택)', examples: ['472', 'M6410'] },
            from: { type: 'string', description: '출발지(선택)', examples: ['서울역'] },
            to: { type: 'string', description: '도착지(선택)', examples: ['강남역'] }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            routes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  routeNo: { type: 'string' },
                  type: { type: 'string', description: '간선/지선/광역/마을' },
                  firstStop: { type: 'string' },
                  lastStop: { type: 'string' },
                  intervalMin: { type: 'integer' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_bus_arrival',
        description: '특정 정류장에 도착 예정인 버스의 실시간 도착정보(남은 정류장·예상시간)를 조회한다. 노선 검색이 아닌 정류장 도착 예측에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            stopName: { type: 'string', description: '정류장 이름', examples: ['서울역버스환승센터'] },
            routeNo: { type: 'string', description: '특정 노선만(선택)', examples: ['472'] }
          },
          required: ['stopName']
        },
        outputSchema: {
          type: 'object',
          properties: {
            stopName: { type: 'string' },
            arrivals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  routeNo: { type: 'string' },
                  etaMin: { type: 'integer' },
                  remainingStops: { type: 'integer' },
                  congestion: { type: 'string', description: '여유/보통/혼잡' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [80, 300],
          samples: [
            {
              stopName: '서울역버스환승센터',
              arrivals: [
                { routeNo: '472', etaMin: 3, remainingStops: 2, congestion: '보통' },
                { routeNo: '지하철9호선', etaMin: 7, remainingStops: 4, congestion: '혼잡' },
                { routeNo: 'M6410', etaMin: 11, remainingStops: 6, congestion: '여유' }
              ]
            }
          ]
        }
      },
      {
        name: 'find_transfer',
        description: '버스와 지하철을 연계한 복합 환승 경로를 안내한다. 지하철 전용 경로나 버스 노선 검색과 달리 버스↔지하철 연계 동선 계산에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발지', examples: ['일산'] },
            to: { type: 'string', description: '도착지', examples: ['판교'] }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            totalMin: { type: 'integer' },
            fare: { type: 'number' },
            legs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  mode: { type: 'string', description: '버스/지하철/도보' },
                  name: { type: 'string' },
                  board: { type: 'string' },
                  alight: { type: 'string' }
                }
              }
            }
          }
        }
      }
    ]
  },
  {
    id: 'platform-congestion',
    name: 'Platform Congestion',
    nameKo: '승강장 혼잡도',
    icon: '👥',
    category: '도시교통',
    description: '역 승강장과 열차 칸별 실시간 혼잡도를 제공하고, 시간대별 혼잡 패턴을 학습해 향후 혼잡을 예측한다.',
    version: '1.0.0',
    tags: ['혼잡도', '승강장', 'congestion', '칸별'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_congestion',
        description: '특정 역 승강장의 현재 실시간 혼잡도(여유/보통/혼잡/매우혼잡)를 조회한다. 예측이 아닌 지금 이 순간의 승강장 밀집도 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '지하철역', examples: ['사당'] },
            line: { type: 'string', description: '노선(선택)', examples: ['2호선'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            level: { type: 'string', description: '여유/보통/혼잡/매우혼잡' },
            occupancyPercent: { type: 'number' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [80, 280],
          samples: [
            {
              station: '사당',
              level: '매우혼잡',
              occupancyPercent: 174.5,
              updatedAt: '2026-07-04T08:35:00'
            }
          ]
        }
      },
      {
        name: 'get_car_congestion',
        description: '진입 예정 열차의 객차 칸별 혼잡도를 조회해 여유로운 칸을 안내한다. 승강장 전체가 아닌 열차 칸 단위 혼잡 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '지하철역', examples: ['잠실'] },
            line: { type: 'string', description: '노선', examples: ['2호선'] },
            direction: { type: 'string', description: '방향', examples: ['성수 방면'] }
          },
          required: ['station', 'line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            cars: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  carNo: { type: 'integer' },
                  level: { type: 'string' },
                  occupancyPercent: { type: 'number' }
                }
              }
            },
            leastCrowdedCar: { type: 'integer' }
          }
        }
      },
      {
        name: 'predict_congestion',
        description: '특정 역의 지정 시간대 예상 혼잡도를 과거 패턴 기반으로 예측한다. 실시간 조회와 달리 미래 시점 혼잡 전망에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '지하철역', examples: ['강남'] },
            date: { type: 'string', format: 'date', description: '예측 날짜' },
            hour: { type: 'integer', minimum: 0, maximum: 23, description: '예측 시간대(시)', examples: [18] }
          },
          required: ['station', 'hour']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            predictedLevel: { type: 'string' },
            predictedOccupancy: { type: 'number' },
            confidence: { type: 'number' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 7. 여객서비스 (旅客서비스)
  // ==========================================================================
  {
    id: 'passenger-assist',
    name: 'Passenger Assist',
    nameKo: '교통약자 지원',
    icon: '♿',
    category: '여객서비스',
    description: '휠체어·거동불편 승객의 승하차 지원을 요청하고 역별 무장애(배리어프리) 편의시설을 안내하며, 동행 도우미 서비스를 예약한다.',
    version: '1.0.0',
    tags: ['교통약자', '배리어프리', 'accessibility', '휠체어'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'request_wheelchair',
        description: '특정 열차·역에서 휠체어 리프트·승하차 지원 인력을 요청한다. 시설 조회가 아닌 실제 지원 요청(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '지원 필요 역', examples: ['대전'] },
            trainNo: { type: 'string', description: '탑승 열차번호', examples: ['KTX 101'] },
            time: { type: 'string', format: 'time', description: '지원 희망 시각', examples: ['10:20'] },
            note: { type: 'string', description: '요청 상세(선택)' }
          },
          required: ['station', 'trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            station: { type: 'string' },
            assignedStaff: { type: 'string' },
            meetingPoint: { type: 'string' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'get_accessible_facilities',
        description: '역의 엘리베이터·경사로·장애인화장실·점자안내 등 무장애 편의시설 현황과 가동 여부를 조회한다. 일반 편의시설이 아닌 교통약자 시설 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회할 역', examples: ['서울'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            facilities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  facility: { type: 'string', description: '엘리베이터/경사로 등' },
                  location: { type: 'string' },
                  operational: { type: 'boolean' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [100, 360],
          samples: [
            {
              station: '서울',
              facilities: [
                { facility: '엘리베이터', location: '중앙대합실~3번 승강장', operational: true },
                { facility: '장애인화장실', location: '서편 대합실', operational: true },
                { facility: '휠체어리프트', location: '9번 승강장', operational: false }
              ]
            }
          ]
        }
      },
      {
        name: 'book_assistance',
        description: '역 도착부터 승차까지 동행하는 도우미(1:1 에스코트) 서비스를 사전 예약한다. 즉시 지원 요청과 달리 사전 예약(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '출발역', examples: ['용산'] },
            date: { type: 'string', format: 'date', description: '이용일' },
            trainNo: { type: 'string', description: '탑승 열차', examples: ['KTX 501'] },
            passengerName: { type: 'string', description: '이용자 성명', examples: ['이서연'] }
          },
          required: ['station', 'date', 'trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            bookingId: { type: 'string' },
            station: { type: 'string' },
            serviceTime: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },
  {
    id: 'lost-and-found',
    name: 'Lost and Found',
    nameKo: '유실물 센터',
    icon: '🧳',
    category: '여객서비스',
    description: '열차·역에서 발생한 유실물을 신고하고 습득물 데이터베이스를 검색하며, 본인 확인 후 유실물 수령을 신청한다.',
    version: '1.0.0',
    tags: ['유실물', '습득물', 'lost', '분실'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'report_lost_item',
        description: '분실한 물건의 특징·분실 장소를 신고해 유실물 접수번호를 발급받는다. 습득물 검색이 아닌 분실 신고(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            itemType: { type: 'string', description: '물품 종류', examples: ['지갑', '노트북', '우산'] },
            lostAt: { type: 'string', description: '분실 추정 장소(열차/역)', examples: ['KTX 101 4호차'] },
            date: { type: 'string', format: 'date', description: '분실 추정일' },
            description: { type: 'string', description: '색상·브랜드 등 특징', examples: ['검정 가죽 장지갑'] }
          },
          required: ['itemType', 'lostAt']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reportId: { type: 'string' },
            matchedCandidates: { type: 'integer', description: '즉시 매칭된 습득물 수' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'search_found_items',
        description: '습득물 보관 데이터베이스를 물품 종류·습득 장소·기간으로 검색한다. 분실 신고가 아닌 이미 접수된 습득물 조회에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            itemType: { type: 'string', description: '물품 종류', examples: ['지갑'] },
            foundAt: { type: 'string', description: '습득 장소/노선(선택)', examples: ['경부선'] },
            days: { type: 'integer', minimum: 1, maximum: 90, description: '최근 N일 이내', default: 14 }
          },
          required: ['itemType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  itemId: { type: 'string' },
                  itemType: { type: 'string' },
                  foundAt: { type: 'string' },
                  foundDate: { type: 'string', format: 'date' },
                  storageLocation: { type: 'string' }
                }
              }
            },
            count: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [120, 440],
          samples: [
            {
              items: [
                { itemId: 'LF-20260703-0451', itemType: '지갑', foundAt: 'KTX 101 4호차', foundDate: '2026-07-03', storageLocation: '서울역 유실물센터' },
                { itemId: 'LF-20260702-0388', itemType: '지갑', foundAt: '동대구역 대합실', foundDate: '2026-07-02', storageLocation: '동대구역 고객센터' }
              ],
              count: 2
            }
          ]
        }
      },
      {
        name: 'claim_item',
        description: '검색된 습득물에 대해 본인 확인 정보를 제출하고 수령(택배/방문)을 신청한다. 검색이 아닌 수령 신청(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            itemId: { type: 'string', description: '수령할 습득물 ID', examples: ['LF-20260703-0451'] },
            claimantName: { type: 'string', description: '신청자 성명', examples: ['박지훈'] },
            deliveryMethod: { type: 'string', enum: ['방문수령', '택배'], default: '방문수령', description: '수령 방법' }
          },
          required: ['itemId', 'claimantName']
        },
        outputSchema: {
          type: 'object',
          properties: {
            claimId: { type: 'string' },
            itemId: { type: 'string' },
            pickupInfo: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },
  {
    id: 'station-guide',
    name: 'Station Guide',
    nameKo: '역 안내·편의시설',
    icon: '🏢',
    category: '여객서비스',
    description: '역의 일반 편의시설(매장·수유실·주차장 등)과 물품보관함 이용 현황, 역 위치·운영시간 등 기본 정보를 안내한다.',
    version: '1.0.0',
    tags: ['역안내', '편의시설', 'station', '보관함'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_station_facilities',
        description: '역 내 편의점·식음료·수유실·환전소·주차장 등 일반 편의시설 목록과 위치를 조회한다. 교통약자 전용 시설이 아닌 일반 승객 편의시설 안내에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회할 역', examples: ['부산'] },
            category: { type: 'string', enum: ['식음료', '편의점', '수유실', '주차장', '환전', '전체'], default: '전체', description: '시설 분류' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            facilities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  category: { type: 'string' },
                  location: { type: 'string' },
                  hours: { type: 'string' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [100, 380],
          samples: [
            {
              station: '부산',
              facilities: [
                { name: 'GS25 부산역점', category: '편의점', location: '1층 대합실', hours: '24시간' },
                { name: '수유실', category: '수유실', location: '2층 맞이방 서편', hours: '05:00~24:00' },
                { name: '역구내주차장', category: '주차장', location: '역 광장 지하', hours: '24시간' }
              ]
            }
          ]
        }
      },
      {
        name: 'find_locker',
        description: '역 물품보관함의 크기별 잔여 개수와 위치·요금을 조회한다. 편의시설 전반이 아닌 보관함 이용 가능 여부 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '역명', examples: ['서울'] },
            size: { type: 'string', enum: ['소형', '중형', '대형', '전체'], default: '전체', description: '보관함 크기' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            lockers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  size: { type: 'string' },
                  available: { type: 'integer' },
                  location: { type: 'string' },
                  hourlyFee: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_station_info',
        description: '역의 주소·운영시간·연계 교통·대표 전화 등 기본 정보를 조회한다. 시설·보관함이 아닌 역 자체의 개요 정보 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '역명', examples: ['광주송정'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            address: { type: 'string' },
            operatingHours: { type: 'string' },
            lines: { type: 'array', items: { type: 'string' } },
            phone: { type: 'string' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 8. 기상·환경 (氣象·環境)
  // ==========================================================================
  {
    id: 'rail-weather',
    name: 'Rail Weather',
    nameKo: '철도 기상 정보',
    icon: '🌦️',
    category: '기상·환경',
    description: '노선 구간별 현재 기상과 예보를 제공하고, 강우·강설·강풍이 열차 운행에 미치는 영향(서행·중단 기준)을 평가한다.',
    version: '1.0.0',
    tags: ['기상', '예보', 'weather', '운행영향'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_weather',
        description: '특정 역·구간의 현재 기상(기온·강수·풍속·시정)을 조회한다. 예보나 운행영향 평가가 아닌 현재 실황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '역/구간/지역', examples: ['강릉', '태백선 구간'] }
          },
          required: ['location']
        },
        outputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            condition: { type: 'string', description: '맑음/비/눈 등' },
            tempC: { type: 'number' },
            windMs: { type: 'number', description: '풍속(m/s)' },
            rainfallMm: { type: 'number', description: '시간당 강수량(mm)' },
            visibilityM: { type: 'integer', description: '시정(m)' }
          }
        },
        mock: {
          latencyMs: [90, 340],
          samples: [
            {
              location: '강릉',
              condition: '비',
              tempC: 21.4,
              windMs: 8.6,
              rainfallMm: 32.5,
              visibilityM: 1200
            }
          ]
        }
      },
      {
        name: 'get_weather_forecast',
        description: '역·구간의 시간대별 기상 예보를 조회한다. 현재 실황이 아닌 향후 예보 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '역/구간/지역', examples: ['평창'] },
            hours: { type: 'integer', minimum: 1, maximum: 48, description: '예보 시간 범위(시간)', default: 12 }
          },
          required: ['location']
        },
        outputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            forecast: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'string', format: 'date-time' },
                  condition: { type: 'string' },
                  tempC: { type: 'number' },
                  rainfallMm: { type: 'number' },
                  windMs: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_weather_impact',
        description: '현재/예보 기상이 특정 노선 운행에 미치는 영향(정상·서행·중단 기준 초과 여부)을 평가하고 권고 조치를 제시한다. 단순 기상 조회가 아닌 운행 리스크 판단에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['영동선', '경부고속선'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            riskLevel: { type: 'string', description: '정상/주의/경계/심각' },
            triggers: { type: 'array', items: { type: 'string' } },
            recommendation: { type: 'string', description: '권고 조치' },
            affectedSections: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    ]
  },
  {
    id: 'air-quality-monitor',
    name: 'Air Quality Monitor',
    nameKo: '역사·터널 공기질',
    icon: '🌫️',
    category: '기상·환경',
    description: '지하역사·터널 내부의 미세먼지·이산화탄소 등 실내 공기질을 측정하고 기준 초과 시 경보 현황을 제공한다.',
    version: '1.0.0',
    tags: ['공기질', '미세먼지', 'air', '역사'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_station_air_quality',
        description: '지하역사 승강장·대합실의 실시간 미세먼지(PM10/PM2.5)·CO2 농도를 조회한다. 실외 기상이 아닌 역사 실내 공기질 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '지하철역', examples: ['사당', '고속터미널'] },
            zone: { type: 'string', enum: ['승강장', '대합실', '전체'], default: '전체', description: '측정 구역' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            pm10: { type: 'number', description: 'PM10(㎍/㎥)' },
            pm25: { type: 'number', description: 'PM2.5(㎍/㎥)' },
            co2: { type: 'integer', description: 'CO2(ppm)' },
            grade: { type: 'string', description: '좋음/보통/나쁨/매우나쁨' }
          }
        },
        mock: {
          latencyMs: [90, 330],
          samples: [
            {
              station: '사당',
              pm10: 58,
              pm25: 34,
              co2: 780,
              grade: '보통'
            }
          ]
        }
      },
      {
        name: 'get_air_alert',
        description: '공기질 기준을 초과한 역사·구간의 경보 발령 현황과 환기 조치 상태를 조회한다. 개별 측정값이 아닌 경보/조치 현황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선(선택)', examples: ['2호선'] },
            grade: { type: 'string', enum: ['나쁨', '매우나쁨', '전체'], default: '전체', description: '경보 등급 필터' }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            alerts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  station: { type: 'string' },
                  pollutant: { type: 'string' },
                  value: { type: 'number' },
                  grade: { type: 'string' },
                  ventilation: { type: 'string', description: '환기 조치 상태' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      }
    ]
  },
  {
    id: 'disaster-alert',
    name: 'Disaster Alert',
    nameKo: '재난·자연재해 경보',
    icon: '🌊',
    category: '기상·환경',
    description: '호우·태풍·지진 등 자연재해 경보와 철도 침수 위험 구간, 지진 발생 시 노선 영향을 통합 제공한다.',
    version: '1.0.0',
    tags: ['재난', '지진', 'disaster', '침수'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_disaster_alerts',
        description: '철도 운행에 영향을 주는 자연재해 특보(호우·태풍·대설·강풍)를 지역별로 조회한다. 일반 기상 예보가 아닌 재난 특보 발령 현황에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '지역/권역(선택)', examples: ['영남권'] }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            alerts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', description: '호우/태풍/대설 등' },
                  level: { type: 'string', description: '주의보/경보' },
                  region: { type: 'string' },
                  issuedAt: { type: 'string', format: 'date-time' },
                  affectedLines: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [100, 380],
          samples: [
            {
              alerts: [
                { type: '호우', level: '경보', region: '강원 영동', issuedAt: '2026-07-04T06:00:00', affectedLines: ['영동선', '태백선'] },
                { type: '강풍', level: '주의보', region: '동해안', issuedAt: '2026-07-04T05:30:00', affectedLines: ['동해선'] }
              ]
            }
          ]
        }
      },
      {
        name: 'get_flood_risk',
        description: '집중호우 시 침수·유실 위험이 높은 선로 구간(교량·저지대·터널)의 위험 등급을 조회한다. 재난 특보가 아닌 구간별 침수 리스크 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경전선', '장항선'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            riskSections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  section: { type: 'string' },
                  riskLevel: { type: 'string', description: '낮음/보통/높음/위험' },
                  waterLevelCm: { type: 'number' },
                  facility: { type: 'string' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_earthquake_impact',
        description: '지진 발생 시 진앙·규모에 따른 노선별 자동 서행·점검 대상 구간과 영향 평가를 조회한다. 재해 특보나 침수와 달리 지진 대응 정보에 특화.',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: '지진 이벤트 ID(선택)', examples: ['EQ-20260704-01'] },
            minMagnitude: { type: 'number', minimum: 0, description: '이 규모 이상만 조회', default: 3.0 }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  eventId: { type: 'string' },
                  magnitude: { type: 'number' },
                  epicenter: { type: 'string' },
                  occurredAt: { type: 'string', format: 'date-time' },
                  actionLines: { type: 'array', items: { type: 'string' } },
                  action: { type: 'string', description: '서행/정지점검 등' }
                }
              }
            }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 9. 데이터분석 (데이터分析)
  // ==========================================================================
  {
    id: 'ridership-analytics',
    name: 'Ridership Analytics',
    nameKo: '수송·승객 통계',
    icon: '📊',
    category: '데이터분석',
    description: '역·노선의 승하차 인원 통계와 기종점(OD) 통행량을 집계하고, 시간대별 피크 이용 패턴을 분석한다.',
    version: '1.0.0',
    tags: ['수송통계', 'OD', 'analytics', '승하차'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_ridership',
        description: '특정 역·노선의 기간별 승차·하차 인원 집계를 조회한다. 실시간 혼잡도가 아닌 누적 이용객 통계 분석에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '역명(선택)', examples: ['서울'] },
            line: { type: 'string', description: '노선명(선택)', examples: ['경부선'] },
            from: { type: 'string', format: 'date', description: '집계 시작일', examples: ['2026-06-01'] },
            to: { type: 'string', format: 'date', description: '집계 종료일', examples: ['2026-06-30'] }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            scope: { type: 'string' },
            boardings: { type: 'integer', description: '승차 인원' },
            alightings: { type: 'integer', description: '하차 인원' },
            avgDaily: { type: 'integer', description: '일평균' },
            peakDate: { type: 'string', format: 'date' }
          }
        },
        mock: {
          latencyMs: [150, 600],
          samples: [
            {
              scope: '서울역 2026-06',
              boardings: 2841500,
              alightings: 2793120,
              avgDaily: 94716,
              peakDate: '2026-06-27'
            }
          ]
        }
      },
      {
        name: 'get_od_matrix',
        description: '출발역-도착역 간 기종점(OD) 통행량 매트릭스를 조회한다. 단일 역 통계가 아닌 역 간 이동 흐름 분석에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부선'] },
            date: { type: 'string', format: 'date', description: '기준일' },
            topN: { type: 'integer', minimum: 1, maximum: 50, description: '상위 N개 OD쌍', default: 10 }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            pairs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  from: { type: 'string' },
                  to: { type: 'string' },
                  trips: { type: 'integer' },
                  share: { type: 'number', description: '점유율(%)' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_peak_analysis',
        description: '역·노선의 요일·시간대별 이용 집중도(피크) 패턴을 분석한다. 총량 통계나 OD가 아닌 피크타임 파악에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '역명', examples: ['강남'] },
            month: { type: 'string', description: '분석 대상 월(YYYY-MM)', examples: ['2026-06'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            peakHour: { type: 'integer' },
            peakRatio: { type: 'number', description: '피크시간 집중률(%)' },
            hourly: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  hour: { type: 'integer' },
                  volume: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    ]
  },
  {
    id: 'punctuality-analytics',
    name: 'Punctuality Analytics',
    nameKo: '정시성 분석',
    icon: '📈',
    category: '데이터분석',
    description: '열차 정시율(정시운행 비율)을 집계하고 지연 원인을 유형별로 분해하며, 노선 간 정시성 지표를 비교한다.',
    version: '1.0.0',
    tags: ['정시율', '지연분석', 'punctuality', 'KPI'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'get_punctuality',
        description: '노선·기간별 정시율(지연 5분 미만 도착 비율)과 평균 지연시간 지표를 조회한다. 실시간 지연 현황이 아닌 누적 정시성 KPI 분석에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부고속선'] },
            from: { type: 'string', format: 'date', description: '집계 시작일', examples: ['2026-06-01'] },
            to: { type: 'string', format: 'date', description: '집계 종료일', examples: ['2026-06-30'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            punctualityRate: { type: 'number', description: '정시율(%)' },
            avgDelayMin: { type: 'number' },
            totalTrains: { type: 'integer' },
            delayedTrains: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [150, 560],
          samples: [
            {
              line: '경부고속선',
              punctualityRate: 96.8,
              avgDelayMin: 1.7,
              totalTrains: 8420,
              delayedTrains: 269
            }
          ]
        }
      },
      {
        name: 'get_delay_causes',
        description: '지연 발생을 원인 유형(기상·시설·차량·혼잡·선행지연 등)별로 분해해 기여 비중을 분석한다. 단순 정시율이 아닌 지연 원인 구조 분석에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['호남선'] },
            month: { type: 'string', description: '분석 월(YYYY-MM)', examples: ['2026-06'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            causes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cause: { type: 'string' },
                  incidents: { type: 'integer' },
                  contributionPercent: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'compare_lines',
        description: '여러 노선의 정시성 지표를 나란히 비교해 순위를 매긴다. 단일 노선 분석이 아닌 노선 간 벤치마킹에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lines: { type: 'array', description: '비교할 노선 목록', items: { type: 'string' }, examples: [['경부고속선', '호남고속선']] },
            month: { type: 'string', description: '비교 월(YYYY-MM)', examples: ['2026-06'] }
          },
          required: ['lines']
        },
        outputSchema: {
          type: 'object',
          properties: {
            ranking: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rank: { type: 'integer' },
                  line: { type: 'string' },
                  punctualityRate: { type: 'number' },
                  avgDelayMin: { type: 'number' }
                }
              }
            }
          }
        }
      }
    ]
  },
  {
    id: 'demand-forecast',
    name: 'Demand Forecast',
    nameKo: '수요 예측',
    icon: '🔮',
    category: '데이터분석',
    description: '향후 열차 이용 수요와 혼잡 추세를 예측하고, 대형 행사·연휴 등 특수 이벤트가 수요에 미치는 영향을 분석한다.',
    version: '1.0.0',
    tags: ['수요예측', 'forecast', '연휴', '이벤트'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'forecast_demand',
        description: '노선·구간의 미래 날짜 열차 이용 수요(예상 승객 수·좌석 점유율)를 예측한다. 과거 통계 집계가 아닌 미래 수요 전망에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부고속선'] },
            date: { type: 'string', format: 'date', description: '예측 대상일', examples: ['2026-09-28'] }
          },
          required: ['line', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            date: { type: 'string', format: 'date' },
            expectedPassengers: { type: 'integer' },
            expectedLoadFactor: { type: 'number', description: '예상 좌석 점유율(%)' },
            recommendedExtraTrains: { type: 'integer', description: '증편 권고 수' },
            confidence: { type: 'number' }
          }
        },
        mock: {
          latencyMs: [200, 700],
          samples: [
            {
              line: '경부고속선',
              date: '2026-09-28',
              expectedPassengers: 138400,
              expectedLoadFactor: 112.5,
              recommendedExtraTrains: 14,
              confidence: 0.87
            }
          ]
        }
      },
      {
        name: 'forecast_congestion_trend',
        description: '역·노선의 향후 기간 혼잡도 추세를 예측한다. 개별 시점 예측이 아닌 다일간 혼잡 추이 전망에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '역명', examples: ['서울'] },
            days: { type: 'integer', minimum: 1, maximum: 30, description: '예측 기간(일)', default: 7 }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            trend: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', format: 'date' },
                  expectedLevel: { type: 'string' },
                  index: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'analyze_event_impact',
        description: '콘서트·스포츠·연휴 등 특정 이벤트가 인근 역 수요에 미치는 증가분을 분석·예측한다. 일반 수요 예측이 아닌 이벤트 수요 영향 산정에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            eventName: { type: 'string', description: '이벤트명', examples: ['부산 불꽃축제'] },
            station: { type: 'string', description: '인근 역', examples: ['부산'] },
            date: { type: 'string', format: 'date', description: '이벤트 날짜' }
          },
          required: ['eventName', 'station', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            eventName: { type: 'string' },
            station: { type: 'string' },
            baselinePassengers: { type: 'integer' },
            expectedSurge: { type: 'integer', description: '추가 예상 인원' },
            surgePercent: { type: 'number' },
            recommendation: { type: 'string' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 10. 요금·정산 (料金·精算)
  // ==========================================================================
  {
    id: 'fare-calculator',
    name: 'Fare Calculator',
    nameKo: '운임 계산',
    icon: '💰',
    category: '요금·정산',
    description: '여객 운임을 구간·좌석등급 기준으로 계산하고 요금표를 제공하며, 각종 할인(경로·어린이·동반)을 적용한 최종 운임을 산정한다.',
    version: '1.0.0',
    tags: ['운임', '요금표', 'fare', '할인'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'calculate_fare',
        description: '출발역-도착역·열차종별·좌석등급으로 여객 운임을 계산한다. 화물 운임 견적이 아닌 승객 승차권 요금 산정에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '승차역', examples: ['서울'] },
            to: { type: 'string', description: '하차역', examples: ['부산'] },
            trainType: { type: 'string', enum: ['KTX', 'SRT', 'ITX', '무궁화'], default: 'KTX', description: '열차 종별' },
            seatClass: { type: 'string', enum: ['일반실', '특실', '입석'], default: '일반실', description: '좌석 등급' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            distanceKm: { type: 'number' },
            baseFare: { type: 'number' },
            seatSurcharge: { type: 'number', description: '특실 할증' },
            totalFare: { type: 'number' }
          }
        },
        mock: {
          latencyMs: [90, 320],
          samples: [
            {
              from: '서울',
              to: '부산',
              distanceKm: 417.5,
              baseFare: 59800,
              seatSurcharge: 0,
              totalFare: 59800
            }
          ]
        }
      },
      {
        name: 'get_fare_table',
        description: '특정 출발역 기준 주요 도착역별 운임표를 일괄 조회한다. 단일 구간 계산이 아닌 요금표 전체 조회에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '기준 출발역', examples: ['서울'] },
            trainType: { type: 'string', enum: ['KTX', 'SRT', 'ITX', '무궁화'], default: 'KTX', description: '열차 종별' }
          },
          required: ['from']
        },
        outputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            fares: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  to: { type: 'string' },
                  generalFare: { type: 'number' },
                  firstClassFare: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'apply_discount',
        description: '기본 운임에 경로·어린이·동반석·조기예매 등 할인 규정을 적용해 최종 결제액을 산정한다. 기본 요금 계산이 아닌 할인 적용에 특화.',
        inputSchema: {
          type: 'object',
          properties: {
            baseFare: { type: 'number', description: '기본 운임(원)', examples: [59800] },
            discountType: { type: 'string', enum: ['경로', '어린이', '동반유아', '장애인', '조기예매', '단체'], description: '할인 종류' },
            passengers: { type: 'integer', minimum: 1, description: '적용 인원', default: 1 }
          },
          required: ['baseFare', 'discountType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            baseFare: { type: 'number' },
            discountRate: { type: 'number', description: '할인율(%)' },
            discountAmount: { type: 'number' },
            finalFare: { type: 'number' }
          }
        }
      }
    ]
  },
  {
    id: 'transit-settlement',
    name: 'Transit Settlement',
    nameKo: '환승 정산',
    icon: '🔄',
    category: '요금·정산',
    description: '대중교통 환승 통합요금을 정산하고 운송기관 간 수입을 배분하며, 기간별 정산 보고서를 산출한다.',
    version: '1.0.0',
    tags: ['환승정산', '수입배분', 'settlement', '통합요금'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'settle_transfer',
        description: '지하철-버스-광역철도 환승 통행의 통합요금을 이용 구간에 따라 정산해 실제 부과액과 환승할인액을 산출한다. 단일 운임 계산이 아닌 환승 통합 정산에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            legs: {
              type: 'array',
              description: '환승 구간 목록',
              items: {
                type: 'object',
                properties: {
                  mode: { type: 'string', description: '지하철/버스/광역철도' },
                  operator: { type: 'string', description: '운영기관' },
                  distanceKm: { type: 'number' }
                }
              }
            }
          },
          required: ['legs']
        },
        outputSchema: {
          type: 'object',
          properties: {
            totalFare: { type: 'number' },
            transferDiscount: { type: 'number', description: '환승할인액' },
            chargedFare: { type: 'number' },
            legFares: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  operator: { type: 'string' },
                  allocatedFare: { type: 'number' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [130, 480],
          samples: [
            {
              totalFare: 2050,
              transferDiscount: 550,
              chargedFare: 1500,
              legFares: [
                { operator: '서울교통공사', allocatedFare: 900 },
                { operator: '한국철도공사', allocatedFare: 600 }
              ]
            }
          ]
        }
      },
      {
        name: 'split_revenue',
        description: '통합요금으로 징수된 수입을 이용 실적(거리·인킬로)에 따라 운송기관별로 배분한다. 개별 통행 정산이 아닌 기관 간 수입 정산에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            period: { type: 'string', description: '정산 기간(YYYY-MM)', examples: ['2026-06'] },
            operators: { type: 'array', description: '배분 대상 기관(선택)', items: { type: 'string' } }
          },
          required: ['period']
        },
        outputSchema: {
          type: 'object',
          properties: {
            period: { type: 'string' },
            totalRevenue: { type: 'number' },
            allocations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  operator: { type: 'string' },
                  passengerKm: { type: 'number' },
                  allocatedRevenue: { type: 'number' },
                  share: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_settlement_report',
        description: '지정 기간의 환승 정산 결과를 종합한 보고서(총 통행·정산액·기관별 요약)를 생성한다. 개별 정산이 아닌 기간 리포트 산출에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            period: { type: 'string', description: '보고 기간(YYYY-MM)', examples: ['2026-06'] },
            format: { type: 'string', enum: ['요약', '상세'], default: '요약', description: '보고서 상세도' }
          },
          required: ['period']
        },
        outputSchema: {
          type: 'object',
          properties: {
            period: { type: 'string' },
            totalTransfers: { type: 'integer' },
            totalSettled: { type: 'number' },
            operatorCount: { type: 'integer' },
            generatedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },
  {
    id: 'payment-gateway',
    name: 'Payment Gateway',
    nameKo: '교통 결제',
    icon: '💳',
    category: '요금·정산',
    description: '교통카드·모바일 결제 승인을 처리하고 거래 내역을 조회하며, 일별 결제와 실제 승차 실적을 대사(reconciliation)한다.',
    version: '1.0.0',
    tags: ['결제', '교통카드', 'payment', '대사'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-04T00:00:00Z',
    tools: [
      {
        name: 'process_payment',
        description: '승차권·교통카드 결제 승인을 요청·처리하고 거래번호를 발급한다. 운임 계산이나 발권이 아닌 결제 승인(쓰기) 처리에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            amount: { type: 'number', description: '결제 금액(원)', examples: [59800] },
            method: { type: 'string', enum: ['교통카드', '신용카드', '간편결제', '모바일'], description: '결제 수단' },
            reference: { type: 'string', description: '승차권/예약 참조번호(선택)', examples: ['TK-20260705-A7F19'] }
          },
          required: ['amount', 'method']
        },
        outputSchema: {
          type: 'object',
          properties: {
            transactionId: { type: 'string' },
            amount: { type: 'number' },
            method: { type: 'string' },
            approvedAt: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [180, 650],
          samples: [
            {
              transactionId: 'TXN-20260704-9931247',
              amount: 59800,
              method: '간편결제',
              approvedAt: '2026-07-04T09:21:03',
              status: '승인'
            }
          ]
        }
      },
      {
        name: 'get_transaction',
        description: '거래번호로 결제 거래의 상세(금액·수단·상태·환불 여부)를 조회한다. 신규 결제가 아닌 기존 거래 내역 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            transactionId: { type: 'string', description: '조회할 거래번호', examples: ['TXN-20260704-9931247'] }
          },
          required: ['transactionId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            transactionId: { type: 'string' },
            amount: { type: 'number' },
            method: { type: 'string' },
            status: { type: 'string' },
            refunded: { type: 'boolean' },
            approvedAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'reconcile_payments',
        description: '지정 일자의 결제 승인 내역과 실제 승차/발권 실적을 대사해 불일치 건을 추출한다. 개별 거래 조회가 아닌 정산 대사(감사) 작업에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date', description: '대사 대상일 (YYYY-MM-DD)', examples: ['2026-07-03'] }
          },
          required: ['date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
            totalTransactions: { type: 'integer' },
            totalAmount: { type: 'number' },
            matched: { type: 'integer' },
            mismatched: { type: 'integer' },
            mismatchAmount: { type: 'number' }
          }
        }
      }
    ]
  }
];
