// ============================================================================
// MCP 신규 카탈로그 — 분야: 도시교통 (urban)
// 기존 3개(subway-navigator, bus-transit, platform-congestion)와 상호보완하는 7개 신규 서버.
// 테마: 복합환승 경로 안내 / 공유 자전거·킥보드 / 환승주차(P&R) / 택시 배차 /
//       도로·신호 정보 / 전기차 충전 / 교통약자 접근경로
// io 체이닝: 다수 도구가 공통 키 `station`(역/위치)·`from`/`to`(출발·도착)·`stationId`/`lotId`/
//            `dispatchId` 등을 공유해 여러 도구를 연쇄 호출하는 워크플로우가 성립하도록 설계.
// ============================================================================

export const MCPS_URBAN = [
  // --------------------------------------------------------------------------
  // 1. 복합환승 경로 안내
  // --------------------------------------------------------------------------
  {
    id: 'multimodal-trip-planner',
    name: 'Multimodal Trip Planner',
    nameKo: '복합환승 통합길찾기',
    icon: '🧭',
    category: '도시교통',
    description: '지하철·버스·공유 모빌리티·도보를 조합한 복합환승 경로를 설계하고, 기준별 대안 경로 비교와 환승 지점의 실시간 연계 상태를 제공한다.',
    version: '1.0.0',
    tags: ['복합환승', '길찾기', 'multimodal', '경로비교'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'plan_multimodal_trip',
        description: '출발지에서 도착지까지 지하철·버스·공유자전거·도보·택시를 조합한 통합 여정을 설계한다. 단일 교통수단 경로 탐색이 아닌 여러 수단을 엮은 전체 여정 설계에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발지', examples: ['판교'] },
            to: { type: 'string', description: '도착지', examples: ['강남역'] },
            modes: {
              type: 'array',
              items: { type: 'string', enum: ['지하철', '버스', '공유자전거', '도보', '택시'] },
              description: '이용을 허용할 교통수단 목록(선택, 생략 시 전체 허용)'
            },
            departTime: { type: 'string', format: 'time', description: '출발 희망시각(HH:MM, 선택)', examples: ['08:30'] }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            totalMin: { type: 'integer' },
            totalFare: { type: 'number' },
            transferCount: { type: 'integer' },
            legs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  mode: { type: 'string', description: '지하철/버스/공유자전거/도보/택시' },
                  name: { type: 'string', description: '노선명·서비스명' },
                  board: { type: 'string' },
                  alight: { type: 'string' },
                  durationMin: { type: 'integer' }
                }
              }
            },
            station: { type: 'string', description: '도착지 인근 지하철역(있는 경우)' },
            stationId: { type: 'string', description: '경로 중 공유자전거 이용 구간이 있으면 인근 대여소 ID(선택)' }
          }
        },
        mock: {
          latencyMs: [150, 550],
          samples: [
            {
              totalMin: 42,
              totalFare: 2300,
              transferCount: 2,
              legs: [
                { mode: '공유자전거', name: '공유자전거', board: '판교역', alight: '판교테크노밸리', durationMin: 8 },
                { mode: '지하철', name: '신분당선', board: '판교', alight: '강남', durationMin: 26 },
                { mode: '도보', name: '도보', board: '강남역 3번출구', alight: '강남역', durationMin: 3 }
              ],
              station: '강남',
              stationId: 'BK-PANGYO-01'
            }
          ]
        }
      },
      {
        name: 'compare_trip_options',
        description: '동일 출발·도착지에 대해 최소시간·최소비용·최소환승 등 기준별 경로 대안을 비교한다. 단일 경로 설계가 아닌 여러 옵션 중 선택을 돕는 데 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발지', examples: ['일산'] },
            to: { type: 'string', description: '도착지', examples: ['여의도'] },
            priority: { type: 'string', enum: ['시간', '비용', '환승수'], default: '시간', description: '비교 우선순위' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: '예: 최소시간' },
                  totalMin: { type: 'integer' },
                  totalFare: { type: 'number' },
                  transferCount: { type: 'integer' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_transfer_connection',
        description: '환승 지점에서 다음 교통수단 연계편의 대기시간과 연결 가능 여부를 조회한다. 전체 경로 설계가 아닌 특정 환승 지점의 실시간 연계 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '환승 지점(역/정류장)', examples: ['사당'] },
            fromMode: { type: 'string', enum: ['지하철', '버스'], description: '환승 전 교통수단' },
            toMode: { type: 'string', enum: ['지하철', '버스', '공유자전거'], description: '환승 후 교통수단' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            waitMin: { type: 'integer' },
            connectionAvailable: { type: 'boolean' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 2. 공유 자전거·킥보드
  // --------------------------------------------------------------------------
  {
    id: 'shared-mobility',
    name: 'Shared Mobility',
    nameKo: '공유 자전거·킥보드',
    icon: '🛴',
    category: '도시교통',
    description: '공유 자전거·전동킥보드 대여소의 실시간 재고와 요금을 조회하고, 예약 가능한 차량을 안내한다.',
    version: '1.0.0',
    tags: ['공유자전거', '킥보드', 'sharing', '퍼스널모빌리티'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'find_nearby_stations',
        description: '특정 역·위치 인근의 공유 자전거·킥보드 대여소를 검색한다. 특정 대여소의 재고 조회가 아닌 주변 대여소 탐색에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '기준 위치(역/주소)', examples: ['판교역'] },
            vehicleType: { type: 'string', enum: ['자전거', '킥보드', '전체'], default: '전체', description: '차량 종류 필터' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            stations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  stationId: { type: 'string' },
                  name: { type: 'string' },
                  distanceM: { type: 'integer' },
                  availableBikes: { type: 'integer' },
                  availableScooters: { type: 'integer' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_station_availability',
        description: '특정 대여소 ID의 실시간 자전거·킥보드 재고와 거치대 여유 수를 조회한다. 주변 탐색이 아닌 특정 대여소 상세 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string', description: '대여소 ID', examples: ['BK-PANGYO-01'] }
          },
          required: ['stationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string' },
            availableBikes: { type: 'integer' },
            availableScooters: { type: 'integer' },
            emptyDocks: { type: 'integer' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [80, 300],
          samples: [
            {
              stationId: 'BK-PANGYO-01',
              availableBikes: 6,
              availableScooters: 3,
              emptyDocks: 5,
              updatedAt: '2026-07-05T08:20:00'
            }
          ]
        }
      },
      {
        name: 'reserve_vehicle',
        description: '특정 대여소의 자전거 또는 킥보드 1대를 예약한다. 재고 조회가 아닌 실제 예약 처리에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string', description: '대여소 ID', examples: ['BK-PANGYO-01'] },
            vehicleType: { type: 'string', enum: ['자전거', '킥보드'], description: '예약할 차량 종류' },
            holdMin: { type: 'integer', default: 5, description: '예약 유지 시간(분)' }
          },
          required: ['stationId', 'vehicleType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            vehicleType: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
            unlockCode: { type: 'string' }
          }
        }
      },
      {
        name: 'estimate_ride_fare',
        description: '이용 시간 기준 공유 모빌리티 예상 요금을 계산한다. 예약이 아닌 사전 요금 견적에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            vehicleType: { type: 'string', enum: ['자전거', '킥보드'], description: '차량 종류' },
            minutes: { type: 'integer', description: '예상 이용 시간(분)', examples: [15] }
          },
          required: ['vehicleType', 'minutes']
        },
        outputSchema: {
          type: 'object',
          properties: {
            vehicleType: { type: 'string' },
            minutes: { type: 'integer' },
            fare: { type: 'number' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 3. 환승주차(P&R)
  // --------------------------------------------------------------------------
  {
    id: 'park-and-ride',
    name: 'Park and Ride',
    nameKo: '환승주차장(P&R)',
    icon: '🅿️',
    category: '도시교통',
    description: '지하철·버스 환승 연계 주차장의 실시간 잔여면수와 요금을 조회하고, 주차 공간을 사전 예약한다.',
    version: '1.0.0',
    tags: ['환승주차', 'P&R', 'parking', '주차장'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'find_lots_near_station',
        description: '특정 지하철역·버스 환승거점 인근의 환승주차장을 검색한다. 특정 주차장의 상세 조회가 아닌 역 주변 주차장 탐색에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '기준 역/환승거점', examples: ['수서'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            lots: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lotId: { type: 'string' },
                  name: { type: 'string' },
                  distanceM: { type: 'integer' },
                  totalSpots: { type: 'integer' },
                  feePerHour: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_lot_availability',
        description: '특정 환승주차장의 실시간 잔여 주차면수를 조회한다. 주차장 탐색이 아닌 특정 주차장의 현재 여유 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lotId: { type: 'string', description: '주차장 ID', examples: ['PR-SUSEO-01'] }
          },
          required: ['lotId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            lotId: { type: 'string' },
            availableSpots: { type: 'integer' },
            totalSpots: { type: 'integer' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [80, 280],
          samples: [
            {
              lotId: 'PR-SUSEO-01',
              availableSpots: 42,
              totalSpots: 300,
              updatedAt: '2026-07-05T07:50:00'
            }
          ]
        }
      },
      {
        name: 'reserve_spot',
        description: '환승주차장의 주차 공간을 사전 예약한다. 잔여면수 조회가 아닌 실제 예약 확정에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lotId: { type: 'string', description: '주차장 ID', examples: ['PR-SUSEO-01'] },
            date: { type: 'string', format: 'date', description: '이용일(YYYY-MM-DD)', examples: ['2026-07-06'] },
            arriveTime: { type: 'string', format: 'time', description: '입차 예정 시각(HH:MM)', examples: ['07:30'] }
          },
          required: ['lotId', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            lotId: { type: 'string' },
            spotNo: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 4. 택시 배차
  // --------------------------------------------------------------------------
  {
    id: 'taxi-dispatch',
    name: 'Taxi Dispatch',
    nameKo: '택시 배차',
    icon: '🚕',
    category: '도시교통',
    description: '출발지·도착지 기준 예상 택시 요금을 계산하고, 실시간 배차 요청과 배차 상태 추적을 제공한다.',
    version: '1.0.0',
    tags: ['택시', '배차', 'taxi', 'dispatch'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'estimate_fare',
        description: '출발지·도착지 기준 예상 택시 요금과 소요시간을 계산한다. 실제 배차 요청이 아닌 사전 요금 견적에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발지', examples: ['홍대입구역'] },
            to: { type: 'string', description: '도착지', examples: ['김포공항'] },
            carType: { type: 'string', enum: ['일반', '모범', '대형'], default: '일반', description: '차량 등급' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            estFare: { type: 'number' },
            estMin: { type: 'integer' }
          }
        }
      },
      {
        name: 'request_dispatch',
        description: '지정한 출발지로 택시 배차를 요청한다. 요금 견적이 아닌 실제 호출 처리에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발지', examples: ['홍대입구역'] },
            to: { type: 'string', description: '도착지', examples: ['김포공항'] },
            carType: { type: 'string', enum: ['일반', '모범', '대형'], default: '일반', description: '차량 등급' },
            passengers: { type: 'integer', default: 1, description: '탑승 인원' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            dispatchId: { type: 'string' },
            driverName: { type: 'string' },
            carNo: { type: 'string' },
            etaMin: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [150, 500],
          samples: [
            {
              dispatchId: 'TX-20260705-0142',
              driverName: '김O수',
              carNo: '12가 3456',
              etaMin: 4
            }
          ]
        }
      },
      {
        name: 'get_dispatch_status',
        description: '이미 요청한 배차 건의 현재 상태(배차중/배차완료/탑승중/완료)를 조회한다. 신규 요청이 아닌 기존 배차 건 추적에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            dispatchId: { type: 'string', description: '배차 요청 ID', examples: ['TX-20260705-0142'] }
          },
          required: ['dispatchId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            dispatchId: { type: 'string' },
            status: { type: 'string', description: '배차중/배차완료/탑승중/완료' },
            currentLocation: { type: 'string' },
            etaMin: { type: 'integer' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 5. 도로·신호 정보
  // --------------------------------------------------------------------------
  {
    id: 'road-traffic-signal',
    name: 'Road Traffic & Signal Info',
    nameKo: '도로·신호 정보',
    icon: '🚦',
    category: '도시교통',
    description: '주요 도로의 실시간 정체 구간과 평균 통행속도, 교차로 신호 잔여시간과 돌발 상황 정보를 제공한다.',
    version: '1.0.0',
    tags: ['도로교통', '신호', 'traffic', '정체'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_road_congestion',
        description: '특정 도로 구간의 실시간 정체 수준과 평균 통행속도를 조회한다. 교차로 신호가 아닌 도로 구간 전체 흐름 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            roadName: { type: 'string', description: '도로명', examples: ['강남대로'] },
            section: { type: 'string', description: '구간(선택)', examples: ['신논현~강남역'] }
          },
          required: ['roadName']
        },
        outputSchema: {
          type: 'object',
          properties: {
            roadName: { type: 'string' },
            section: { type: 'string' },
            congestionLevel: { type: 'string', description: '원활/서행/정체/정체심함' },
            avgSpeedKmh: { type: 'number' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [80, 280],
          samples: [
            {
              roadName: '강남대로',
              section: '신논현~강남역',
              congestionLevel: '정체',
              avgSpeedKmh: 14.2,
              updatedAt: '2026-07-05T18:10:00'
            }
          ]
        }
      },
      {
        name: 'get_signal_status',
        description: '특정 교차로 신호등의 현재 신호(적색/황색/녹색)와 잔여시간을 조회한다. 도로 전체 흐름이 아닌 개별 교차로 신호 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            intersection: { type: 'string', description: '교차로 이름', examples: ['강남역사거리'] }
          },
          required: ['intersection']
        },
        outputSchema: {
          type: 'object',
          properties: {
            intersection: { type: 'string' },
            currentSignal: { type: 'string', description: '적색/황색/녹색' },
            remainingSec: { type: 'integer' },
            cycleSec: { type: 'integer' }
          }
        }
      },
      {
        name: 'get_incident_alerts',
        description: '특정 도로 구간의 사고·공사·통제 등 돌발 상황 정보를 조회한다. 정체수준 조회가 아닌 원인이 되는 돌발상황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            roadName: { type: 'string', description: '도로명', examples: ['올림픽대로'] }
          },
          required: ['roadName']
        },
        outputSchema: {
          type: 'object',
          properties: {
            roadName: { type: 'string' },
            incidents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', description: '사고/공사/통제' },
                  location: { type: 'string' },
                  startedAt: { type: 'string', format: 'date-time' },
                  expectedClearMin: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 6. 전기차 충전
  // --------------------------------------------------------------------------
  {
    id: 'ev-charging-network',
    name: 'EV Charging Network',
    nameKo: '전기차 충전소 안내',
    icon: '🔌',
    category: '도시교통',
    description: '전기차 충전소의 위치·커넥터 타입별 실시간 사용 가능 여부를 조회하고, 충전기 예약과 예상 완충 시간을 안내한다.',
    version: '1.0.0',
    tags: ['전기차', '충전소', 'EV', 'charging'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'find_charging_stations',
        description: '특정 역·위치 인근의 전기차 충전소를 검색한다. 특정 충전소의 상세 조회가 아닌 주변 충전소 탐색에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '기준 위치(역/주소)', examples: ['판교역'] },
            connectorType: { type: 'string', enum: ['완속', '급속', '전체'], default: '전체', description: '커넥터 타입 필터' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            stations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  stationId: { type: 'string' },
                  name: { type: 'string' },
                  distanceM: { type: 'integer' },
                  availableChargers: { type: 'integer' },
                  connectorType: { type: 'string' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_charger_status',
        description: '특정 충전소의 실시간 충전기별 사용 가능 여부를 조회한다. 주변 탐색이 아닌 특정 충전소 상세 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string', description: '충전소 ID', examples: ['EV-PANGYO-03'] }
          },
          required: ['stationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string' },
            chargers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  chargerId: { type: 'string' },
                  connectorType: { type: 'string' },
                  status: { type: 'string', description: '사용가능/충전중/고장' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [80, 300],
          samples: [
            {
              stationId: 'EV-PANGYO-03',
              chargers: [
                { chargerId: 'C1', connectorType: '급속', status: '사용가능' },
                { chargerId: 'C2', connectorType: '완속', status: '충전중' }
              ]
            }
          ]
        }
      },
      {
        name: 'reserve_charger',
        description: '특정 충전소의 충전기 1대를 예약한다. 상태 조회가 아닌 실제 예약 처리에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string', description: '충전소 ID', examples: ['EV-PANGYO-03'] },
            chargerId: { type: 'string', description: '충전기 ID', examples: ['C1'] },
            startTime: { type: 'string', format: 'time', description: '충전 시작 희망 시각(HH:MM)', examples: ['09:00'] }
          },
          required: ['stationId', 'chargerId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            stationId: { type: 'string' },
            chargerId: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'estimate_charging_time',
        description: '배터리 잔량과 커넥터 타입 기준 예상 완충 소요시간을 계산한다. 예약이 아닌 사전 충전시간 견적에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            connectorType: { type: 'string', enum: ['완속', '급속'], description: '커넥터 타입' },
            currentBatteryPercent: { type: 'number', description: '현재 배터리 잔량(%)', examples: [30] },
            targetBatteryPercent: { type: 'number', default: 80, description: '목표 배터리 잔량(%)' }
          },
          required: ['connectorType', 'currentBatteryPercent']
        },
        outputSchema: {
          type: 'object',
          properties: {
            connectorType: { type: 'string' },
            estimatedMin: { type: 'integer' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 7. 교통약자 접근경로
  // --------------------------------------------------------------------------
  {
    id: 'accessible-route-guide',
    name: 'Accessible Route Guide',
    nameKo: '교통약자 접근경로 안내',
    icon: '♿',
    category: '도시교통',
    description: '휠체어·유모차·시각장애인 등 교통약자를 위한 무장애 경로를 탐색하고, 역사 내 엘리베이터·경사로 상태와 이동 지원 인력을 제공한다.',
    version: '1.0.0',
    tags: ['교통약자', '접근성', 'accessibility', '무장애경로'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'find_accessible_route',
        description: '출발지에서 도착지까지 휠체어·유모차 등이 이용 가능한 무장애 경로(엘리베이터·경사로 우선)를 탐색한다. 일반 경로 탐색이 아닌 접근성 제약을 반영한 경로 설계에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발지', examples: ['서울역'] },
            to: { type: 'string', description: '도착지', examples: ['시청역'] },
            needType: { type: 'string', enum: ['휠체어', '유모차', '시각장애인', '전체'], default: '전체', description: '이동 제약 유형' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            totalMin: { type: 'integer' },
            transfers: { type: 'integer' },
            legs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  mode: { type: 'string' },
                  board: { type: 'string' },
                  alight: { type: 'string' },
                  elevatorRequired: { type: 'boolean' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [120, 450],
          samples: [
            {
              totalMin: 22,
              transfers: 1,
              legs: [
                { mode: '지하철', board: '서울역', alight: '시청역', elevatorRequired: true }
              ]
            }
          ]
        }
      },
      {
        name: 'get_elevator_status',
        description: '특정 역의 엘리베이터·에스컬레이터·경사로 운행 상태(정상/점검중/고장)를 조회한다. 경로 탐색이 아닌 특정 역 편의시설 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '지하철역', examples: ['시청역'] }
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
                  facilityType: { type: 'string', description: '엘리베이터/에스컬레이터/경사로' },
                  location: { type: 'string' },
                  status: { type: 'string', description: '정상/점검중/고장' }
                }
              }
            }
          }
        }
      },
      {
        name: 'request_mobility_assist',
        description: '역사 내 이동 지원 인력(휠체어 리프트, 동행 안내)을 사전 요청한다. 상태 조회가 아닌 실제 지원 인력 배정 요청에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '지하철역', examples: ['서울역'] },
            arriveTime: { type: 'string', format: 'time', description: '역 도착 예정 시각(HH:MM)', examples: ['14:00'] },
            assistType: { type: 'string', enum: ['휠체어동행', '시각장애인동행', '유모차동행'], description: '지원 유형' }
          },
          required: ['station', 'arriveTime', 'assistType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            station: { type: 'string' },
            assignedStaff: { type: 'string' },
            meetPoint: { type: 'string' }
          }
        }
      }
    ]
  }
];
