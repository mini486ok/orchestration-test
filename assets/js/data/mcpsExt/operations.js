// ============================================================================
// mcpsExt/operations.js — 운행정보 분야 신규 샘플 MCP 서버 7종
// SPEC §1(계약서) 규격 준수. 순수 ES module. 기존 3개 서버(kr-train-schedule,
// train-position-tracker, train-delay-monitor)와 id 충돌 없음, 상호보완적으로 설계.
//
// [신규 서버 인덱스]
//  1. station-arrival-board   : 역 실시간 도착·출발 전광판
//  2. train-consist-info      : 열차 편성·차량 정보
//  3. rail-route-info         : 노선·구간 정보
//  4. transfer-route-planner  : 환승·연계 경로 안내
//  5. express-local-compare   : 급행·완행 비교
//  6. timetable-change-notice : 시각표 변경·공사계획 공지
//  7. section-speed-monitor   : 구간별 실시간 속도·소요시간
//
// io 체이닝: from/to, station, line, trainNo 키를 기존 3개 서버 및 신규 서버
// 상호간에 공유하여 검색→상세→추적 등 다단계 워크플로우가 성립하도록 설계.
// ============================================================================

export const MCPS_OPERATIONS = [
  // ==========================================================================
  // 1. 역 실시간 도착·출발 전광판
  // ==========================================================================
  {
    id: 'station-arrival-board',
    name: 'Station Arrival & Departure Board',
    nameKo: '역 실시간 도착·출발 전광판',
    icon: '🚉',
    category: '운행정보',
    description: '특정 역의 실시간 도착·출발 전광판 표시 내용(지연 반영)과 승강장 배정을 조회한다. 고정 시간표 원본이 아닌 지금 이 순간의 전광판 정보에 사용.',
    version: '1.0.0',
    tags: ['전광판', '실시간', '승강장', 'arrival-board'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_arrival_board',
        description: '역의 실시간 도착 전광판 목록을 조회한다. 지연이 반영된 예상 도착시각·승강장·상태(정시/지연/도착)를 포함. "지금 이 역에 들어오는 열차" 확인에 사용, 시간표 검색이 아님.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회할 역 이름', examples: ['서울', '동대구'] },
            direction: { type: 'string', enum: ['상행', '하행', '전체'], default: '전체', description: '운행 방향' },
            count: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: '조회할 최대 건수' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            arrivals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  trainNo: { type: 'string', description: '열차번호' },
                  type: { type: 'string', description: '열차 종별' },
                  from: { type: 'string', description: '출발역' },
                  scheduledTime: { type: 'string', description: '정시 도착 예정시각' },
                  estimatedTime: { type: 'string', description: '지연 반영 예상 도착시각' },
                  delayMin: { type: 'integer', description: '지연(분)' },
                  platform: { type: 'string', description: '승강장' },
                  status: { type: 'string', enum: ['정시', '지연', '도착', '출발완료'], description: '전광판 상태' }
                }
              }
            },
            count: { type: 'integer', description: '조회된 건수' }
          }
        },
        mock: {
          latencyMs: [100, 400],
          samples: [
            {
              station: '서울',
              arrivals: [
                { trainNo: 'KTX 101', type: 'KTX', from: '부산', scheduledTime: '10:40', estimatedTime: '10:40', delayMin: 0, platform: '3', status: '정시' },
                { trainNo: 'ITX-새마을 1004', type: 'ITX', from: '대전', scheduledTime: '10:52', estimatedTime: '11:04', delayMin: 12, platform: '7', status: '지연' }
              ],
              count: 2
            }
          ]
        }
      },
      {
        name: 'get_departure_board',
        description: '역의 실시간 출발 전광판 목록을 조회한다. 목적지·출발 예정시각·승강장·상태를 포함. "이 역에서 나가는 열차" 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회할 역 이름', examples: ['수서'] },
            direction: { type: 'string', enum: ['상행', '하행', '전체'], default: '전체', description: '운행 방향' },
            count: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: '조회할 최대 건수' }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            departures: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  trainNo: { type: 'string' },
                  type: { type: 'string' },
                  destination: { type: 'string' },
                  scheduledTime: { type: 'string' },
                  platform: { type: 'string' },
                  status: { type: 'string', enum: ['정시', '지연', '출발대기', '출발완료'] }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_platform_assignment',
        description: '특정 열차의 특정 역 승강장 배정 정보를 조회하고 최근 변경 여부를 알려준다. "몇 번 승강장이야, 바뀐 건 아니지?" 같은 질의에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '역 이름', examples: ['서울'] },
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] }
          },
          required: ['station', 'trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            trainNo: { type: 'string' },
            platform: { type: 'string' },
            changed: { type: 'boolean', description: '최근 승강장 변경 여부' },
            previousPlatform: { type: 'string', description: '변경 전 승강장(변경된 경우)' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 2. 열차 편성·차량 정보
  // ==========================================================================
  {
    id: 'train-consist-info',
    name: 'Train Consist & Rolling Stock Info',
    nameKo: '열차 편성·차량 정보',
    icon: '🚋',
    category: '운행정보',
    description: '열차의 편성(호차 수·호차별 등급·설비)과 차종(모델·최고속도)을 조회하고, 호차별 좌석 배치를 확인한다. 예매·발권이 아닌 편성 구조 자체의 조회에 사용.',
    version: '1.0.0',
    tags: ['편성', '차량', '좌석배치', 'consist'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_consist',
        description: '열차번호로 전체 편성 정보(호차 수, 호차별 등급·좌석수·설비)를 조회한다. "이 열차 몇 량 편성이야, 특실 있어?" 같은 질의에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '조회할 열차번호', examples: ['KTX 101'] },
            date: { type: 'string', format: 'date', description: '운행 날짜 (YYYY-MM-DD)' }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            carCount: { type: 'integer', description: '총 호차 수' },
            cars: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  carNo: { type: 'integer', description: '호차 번호' },
                  class: { type: 'string', enum: ['일반실', '특실', '입석'], description: '등급' },
                  seatCapacity: { type: 'integer', description: '좌석 수' },
                  facilities: { type: 'array', items: { type: 'string' }, description: '설비 목록(예: 콘센트, 카페칸)' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [150, 500],
          samples: [
            {
              trainNo: 'KTX 101',
              carCount: 10,
              cars: [
                { carNo: 1, class: '특실', seatCapacity: 42, facilities: ['콘센트', '독서등'] },
                { carNo: 4, class: '일반실', seatCapacity: 78, facilities: ['콘센트'] },
                { carNo: 6, class: '일반실', seatCapacity: 78, facilities: ['카페칸 인접'] }
              ]
            }
          ]
        }
      },
      {
        name: 'get_seat_map',
        description: '열차의 특정 호차에 대한 좌석 배치도와 잔여석 목록을 조회한다. 편성 정보(get_consist)로 호차를 확인한 뒤 상세 좌석을 볼 때 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] },
            carNo: { type: 'integer', description: '호차 번호', examples: [4] }
          },
          required: ['trainNo', 'carNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            carNo: { type: 'integer' },
            totalSeats: { type: 'integer' },
            availableSeats: { type: 'array', items: { type: 'string' }, description: '잔여석 좌석번호 목록' },
            seatLayout: { type: 'string', description: '좌석 배열 형태(예: 2-2)' }
          }
        }
      },
      {
        name: 'get_rolling_stock_type',
        description: '열차번호로 실제 투입된 차량 모델(예: KTX-산천, KTX-이음)과 제작연도·최고속도를 조회한다. 편성 구조가 아닌 차종 자체 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            modelName: { type: 'string', description: '차량 모델명' },
            manufactureYear: { type: 'integer' },
            maxSpeedKmh: { type: 'integer', description: '설계 최고속도(km/h)' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 3. 노선·구간 정보
  // ==========================================================================
  {
    id: 'rail-route-info',
    name: 'Rail Line & Section Info',
    nameKo: '노선·구간 정보',
    icon: '🛤️',
    category: '운행정보',
    description: '노선별 정차역 순서·누적거리와 두 역 사이의 영업거리를 조회한다. 실시간 운행 상황이 아닌 고정된 노선 구조·거리 정보에 사용.',
    version: '1.0.0',
    tags: ['노선도', '구간거리', 'route'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_route_stations',
        description: '노선명으로 해당 노선의 전체 정차역을 순서대로, 기점 기준 누적거리와 함께 조회한다. "경부선에 어떤 역들이 있어?" 같은 질의에 사용.',
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
            stations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  station: { type: 'string' },
                  order: { type: 'integer', description: '기점부터의 순서' },
                  cumulativeDistanceKm: { type: 'number', description: '기점부터 누적거리(km)' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [120, 420],
          samples: [
            {
              line: '경부선',
              stations: [
                { station: '서울', order: 1, cumulativeDistanceKm: 0 },
                { station: '천안아산', order: 2, cumulativeDistanceKm: 88.7 },
                { station: '대전', order: 3, cumulativeDistanceKm: 159.8 },
                { station: '동대구', order: 4, cumulativeDistanceKm: 288.4 },
                { station: '부산', order: 5, cumulativeDistanceKm: 441.7 }
              ]
            }
          ]
        }
      },
      {
        name: 'get_section_distance',
        description: '출발역·도착역 사이의 영업거리와 경유 구간 수를 조회한다. 운임 산정이나 소요시간 추정의 기초 데이터로 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발역', examples: ['서울'] },
            to: { type: 'string', description: '도착역', examples: ['부산'] }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            distanceKm: { type: 'number' },
            sectionCount: { type: 'integer', description: '경유 구간 수' },
            line: { type: 'string', description: '해당하는 대표 노선명' }
          }
        }
      },
      {
        name: 'get_line_map',
        description: '지역(선택) 기준으로 해당 지역을 지나는 노선 목록과 각 노선의 역 수·총연장을 조회한다. 특정 노선이 아닌 지역 전체 노선망 개관에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '지역명(선택)', examples: ['영남권'] }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            lines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  line: { type: 'string' },
                  stationCount: { type: 'integer' },
                  totalDistanceKm: { type: 'number' }
                }
              }
            }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 4. 환승·연계 경로 안내
  // ==========================================================================
  {
    id: 'transfer-route-planner',
    name: 'Transfer & Connection Route Planner',
    nameKo: '환승·연계 경로 안내',
    icon: '🔀',
    category: '운행정보',
    description: '직행 열차가 없는 구간에 대해 환승이 포함된 경로를 탐색하고, 역의 환승 가능 노선과 환승 시간 여유를 계산한다. 단일 직행 시간표 검색이 아닌 환승 경로 설계에 사용.',
    version: '1.0.0',
    tags: ['환승', '연계', '경로', 'transfer'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'find_transfer_route',
        description: '출발역에서 도착역까지 직행이 없거나 환승이 더 빠른 경우의 환승 경로를 탐색한다. 각 구간의 열차번호와 환승역을 포함. "환승해서 가는 방법 알려줘"에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발역', examples: ['강릉'] },
            to: { type: 'string', description: '도착역', examples: ['목포'] },
            date: { type: 'string', format: 'date', description: '출발 희망일 (YYYY-MM-DD)' },
            maxTransfers: { type: 'integer', minimum: 0, maximum: 3, default: 2, description: '허용할 최대 환승 횟수' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            routes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  legs: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        trainNo: { type: 'string' },
                        from: { type: 'string' },
                        to: { type: 'string' },
                        departure: { type: 'string' },
                        arrival: { type: 'string' }
                      }
                    }
                  },
                  transferStation: { type: 'string', description: '주 환승역(단일 환승 기준)' },
                  totalDurationMin: { type: 'integer' },
                  transferCount: { type: 'integer' }
                }
              }
            },
            count: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [200, 600],
          samples: [
            {
              routes: [
                {
                  legs: [
                    { trainNo: 'KTX 811', from: '강릉', to: '서울', departure: '07:05', arrival: '08:59' },
                    { trainNo: 'SRT 305', from: '수서', to: '목포', departure: '09:40', arrival: '12:22' }
                  ],
                  transferStation: '서울',
                  totalDurationMin: 317,
                  transferCount: 1
                }
              ],
              count: 1
            }
          ]
        }
      },
      {
        name: 'get_transfer_info',
        description: '특정 역에서 환승 가능한 노선 목록과 환승에 필요한 도보 이동시간, 동일 승강장 환승 여부를 조회한다. "이 역에서 다른 노선으로 갈아탈 수 있어?"에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '환승역 이름', examples: ['서울'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            transferLines: { type: 'array', items: { type: 'string' }, description: '환승 가능 노선/계통 목록' },
            walkTimeMin: { type: 'integer', description: '평균 환승 도보시간(분)' },
            sameStationTransfer: { type: 'boolean', description: '동일 승강장(무이동) 환승 가능 여부' }
          }
        }
      },
      {
        name: 'check_connection_feasible',
        description: '먼저 도착하는 열차와 다음에 출발하는 열차 사이의 환승이 시간상 가능한지 판정한다. 환승 대기시간과 위험도를 반환. 경로 탐색 이후 실제 환승 가능성 재확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            arrivalTrainNo: { type: 'string', description: '먼저 도착하는 열차번호', examples: ['KTX 811'] },
            transferStation: { type: 'string', description: '환승역', examples: ['서울'] },
            departureTrainNo: { type: 'string', description: '이어서 탈 열차번호', examples: ['SRT 305'] },
            bufferMin: { type: 'integer', minimum: 0, default: 5, description: '안전 여유시간(분)' }
          },
          required: ['arrivalTrainNo', 'transferStation', 'departureTrainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            feasible: { type: 'boolean' },
            waitMin: { type: 'integer', description: '실제 환승 대기시간(분)' },
            riskLevel: { type: 'string', enum: ['낮음', '보통', '높음'], description: '지연 등으로 인한 환승 실패 위험도' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 5. 급행·완행 비교
  // ==========================================================================
  {
    id: 'express-local-compare',
    name: 'Express vs Local Train Comparator',
    nameKo: '급행·완행 비교',
    icon: '⚡',
    category: '운행정보',
    description: '동일 구간에서 급행(KTX·SRT·ITX 등)과 완행(무궁화 등) 열차의 소요시간·운임·정차역 수를 비교하고, 개별 열차의 정차 패턴을 상세 조회한다. 단순 시간표 검색이 아닌 열차 종별 선택 의사결정에 사용.',
    version: '1.0.0',
    tags: ['급행', '완행', '비교', 'express'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'compare_train_types',
        description: '출발역·도착역 구간에서 이용 가능한 열차 종별들을 소요시간·운임·정차역 수 기준으로 비교하고 추천 의견을 제공한다. "빠른 게 나아 싼 게 나아?" 같은 비교 질의에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발역', examples: ['서울'] },
            to: { type: 'string', description: '도착역', examples: ['대전'] },
            date: { type: 'string', format: 'date', description: '조회 날짜 (YYYY-MM-DD)' }
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
                  trainType: { type: 'string' },
                  trainNo: { type: 'string' },
                  duration: { type: 'string' },
                  fare: { type: 'number' },
                  stopCount: { type: 'integer', description: '경유 정차역 수' }
                }
              }
            },
            recommendation: { type: 'string', description: '상황별 추천 요약' }
          }
        },
        mock: {
          latencyMs: [150, 500],
          samples: [
            {
              options: [
                { trainType: 'KTX', trainNo: 'KTX 105', duration: '49분', fare: 23700, stopCount: 0 },
                { trainType: 'ITX-새마을', trainNo: 'ITX-새마을 1007', duration: '1시간38분', fare: 17300, stopCount: 4 },
                { trainType: '무궁화', trainNo: '무궁화 1209', duration: '2시간12분', fare: 10700, stopCount: 9 }
              ],
              recommendation: '시간이 급하면 KTX, 비용 절감이 우선이면 무궁화를 권장'
            }
          ]
        }
      },
      {
        name: 'get_stop_pattern',
        description: '열차번호로 해당 열차의 정차역 목록과 통과(무정차)역 목록을 조회한다. 급행이 어디를 서고 어디를 건너뛰는지 확인할 때 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['ITX-새마을 1007'] }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            trainType: { type: 'string' },
            totalStops: { type: 'integer' },
            stops: { type: 'array', items: { type: 'string' }, description: '정차역 목록' },
            skippedStations: { type: 'array', items: { type: 'string' }, description: '통과(무정차)역 목록' }
          }
        }
      },
      {
        name: 'estimate_time_saved',
        description: '동일 구간에서 두 열차 종별 사이의 시간 절감량과 운임 차액을 계산한다. compare_train_types로 후보를 고른 뒤 두 옵션을 직접 비교할 때 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발역', examples: ['서울'] },
            to: { type: 'string', description: '도착역', examples: ['대전'] },
            trainTypeA: { type: 'string', description: '비교 기준 열차종별 A', examples: ['KTX'] },
            trainTypeB: { type: 'string', description: '비교 기준 열차종별 B', examples: ['무궁화'] }
          },
          required: ['from', 'to', 'trainTypeA', 'trainTypeB']
        },
        outputSchema: {
          type: 'object',
          properties: {
            timeSavedMin: { type: 'integer', description: 'A가 B보다 절감하는 시간(분, 음수면 A가 더 느림)' },
            fareDiff: { type: 'number', description: 'A와 B의 운임 차액(원, A-B)' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 6. 시각표 변경·공사계획 공지
  // ==========================================================================
  {
    id: 'timetable-change-notice',
    name: 'Timetable Change & Construction Notice',
    nameKo: '시각표 변경·공사계획 공지',
    icon: '🛠️',
    category: '운행정보',
    description: '정기 시각표 개정, 선로 공사로 인한 운행계획 변경, 계절별 임시열차 편성 등 사전 공지된 계획 변경사항을 조회한다. 실시간 돌발 지연이 아닌 예정된 계획 변경 확인에 사용.',
    version: '1.0.0',
    tags: ['시각표개정', '공사', '임시열차', 'notice'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_schedule_changes',
        description: '노선·기간별로 예정되었거나 시행된 시각표 변경 공지를 조회한다. 변경 사유와 영향을 받는 열차 목록을 포함. "다음 달에 시간표 바뀌는 거 있어?"에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명(선택)', examples: ['경부선'] },
            dateFrom: { type: 'string', format: 'date', description: '조회 시작일' },
            dateTo: { type: 'string', format: 'date', description: '조회 종료일' }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  line: { type: 'string' },
                  effectiveDate: { type: 'string', format: 'date' },
                  description: { type: 'string' },
                  affectedTrains: { type: 'array', items: { type: 'string' }, description: '영향을 받는 열차번호 목록' }
                }
              }
            },
            count: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [130, 480],
          samples: [
            {
              changes: [
                {
                  line: '경부선',
                  effectiveDate: '2026-08-01',
                  description: '하계 성수기 KTX 임시열차 6회 증편 운행',
                  affectedTrains: ['KTX 8101', 'KTX 8103']
                }
              ],
              count: 1
            }
          ]
        }
      },
      {
        name: 'get_construction_plan',
        description: '지역·상태(예정/진행중/완료)별 선로·시설 공사계획과 그로 인한 운행 영향을 조회한다. 시각표 개정 원인이 되는 공사 일정 자체를 확인할 때 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '지역/노선(선택)', examples: ['호남선'] },
            status: { type: 'string', enum: ['예정', '진행중', '완료', '전체'], default: '전체', description: '공사 진행 상태' }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            projects: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  section: { type: 'string' },
                  startDate: { type: 'string', format: 'date' },
                  endDate: { type: 'string', format: 'date' },
                  impact: { type: 'string', description: '운행에 미치는 영향 요약' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_seasonal_timetable',
        description: '계절/명절 등 특정 기간에 적용되는 임시 시각표 버전과 변경 내역을 조회한다. 연중 상시 시각표가 아닌 한시적 편성 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            season: { type: 'string', enum: ['봄', '여름', '가을', '겨울', '명절'], description: '적용 시즌' },
            line: { type: 'string', description: '노선명(선택)', examples: ['경부선'] }
          },
          required: ['season']
        },
        outputSchema: {
          type: 'object',
          properties: {
            season: { type: 'string' },
            line: { type: 'string' },
            timetableVersion: { type: 'string', description: '적용 시각표 버전명' },
            changes: { type: 'array', items: { type: 'string' }, description: '주요 변경 내역 요약 목록' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 7. 구간별 실시간 속도·소요시간
  // ==========================================================================
  {
    id: 'section-speed-monitor',
    name: 'Section Speed & Travel Time Monitor',
    nameKo: '구간별 실시간 속도·소요시간',
    icon: '📶',
    category: '운행정보',
    description: '구간별 실측 평균 소요시간 통계, 특정 열차의 실시간 주행 속도, 노선 구간별 평균 속도·혼잡도를 제공한다. 정적 시간표가 아닌 실측·실시간 속도/소요시간 데이터에 사용.',
    version: '1.0.0',
    tags: ['속도', '소요시간', '구간', 'speed'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_section_travel_time',
        description: '출발역·도착역 구간의 실측 기반 평균/최소/최대 소요시간을 조회한다. 시간표상 소요시간이 아닌 실제 운행 통계치가 필요할 때 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '출발역', examples: ['서울'] },
            to: { type: 'string', description: '도착역', examples: ['부산'] },
            trainType: { type: 'string', enum: ['KTX', 'SRT', 'ITX', '무궁화', '전체'], default: '전체', description: '열차 종별 필터' }
          },
          required: ['from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            avgTravelTimeMin: { type: 'number' },
            minTravelTimeMin: { type: 'number' },
            maxTravelTimeMin: { type: 'number' },
            sampleCount: { type: 'integer', description: '통계에 사용된 운행 표본 수' }
          }
        }
      },
      {
        name: 'get_current_speed',
        description: '특정 열차번호의 현재 실시간 주행 속도와 설계 최고속도, 현재 구간을 조회한다. 위치 추적이 아닌 속도 수치 자체 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            currentSpeedKmh: { type: 'number' },
            maxSpeedKmh: { type: 'number' },
            section: { type: 'string', description: '현재 주행 중인 구간' }
          }
        },
        mock: {
          latencyMs: [80, 320],
          samples: [
            { trainNo: 'KTX 101', currentSpeedKmh: 296.4, maxSpeedKmh: 305, section: '천안아산~오송' }
          ]
        }
      },
      {
        name: 'compare_section_speed',
        description: '노선 전체 구간별 평균 속도와 혼잡도 수준을 비교 조회한다. 개별 열차가 아닌 노선 단위 구간별 소통 상황 파악에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부선'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  section: { type: 'string' },
                  avgSpeedKmh: { type: 'number' },
                  congestionLevel: { type: 'string', enum: ['원활', '보통', '혼잡'] }
                }
              }
            }
          }
        }
      }
    ]
  }
];
