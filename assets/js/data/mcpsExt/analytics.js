// ============================================================================
// mcpsExt/analytics.js — 데이터분석 분야 신규 MCP 서버 7종
// SPEC(contract-v2.md §1) 규격 준수. 순수 ES module.
// 기존 3개(ridership-analytics, punctuality-analytics, demand-forecast)와
// 상호보완적으로 구성: 수익 분석, OD 행렬(네트워크 전체), 혼잡 예측(열차·역 단위),
// 에너지 소비 분석, KPI 대시보드 데이터, 이상탐지, 승객 흐름 시뮬레이션.
//
// [서버 인덱스]
//  1. revenue-analytics           : 수익 분석
//  2. od-matrix-analyzer          : OD(기종점) 행렬 분석(네트워크 전체)
//  3. crowding-prediction         : 혼잡 예측(열차 칸별·역별)
//  4. energy-consumption-analytics: 에너지 소비 분석
//  5. kpi-dashboard-hub           : KPI 대시보드 데이터
//  6. anomaly-detection-engine    : 이상탐지
//  7. passenger-flow-simulator    : 승객 흐름 시뮬레이션
//
// io 체이닝 설계:
//  - od-matrix-analyzer.build_full_od_matrix 의 출력 odPairs[]
//    (originStationId/destStationId/tripCount) →
//    passenger-flow-simulator.simulate_network_load 의 입력 odPairs 로 그대로 연결.
//  - kpi-dashboard-hub.get_metric_timeseries 의 출력 metricId/series →
//    anomaly-detection-engine.detect_series_anomalies 의 입력 metricId/series 로 연결.
//  - revenue-analytics.rank_top_revenue_routes 의 출력 items[].lineId →
//    revenue-analytics.compute_route_profitability 의 입력 lineId 로 연결.
//  - anomaly-detection-engine.get_active_alerts 의 출력 alerts[].alertId →
//    anomaly-detection-engine.acknowledge_alert 의 입력 alertId 로 연결.
//  - lineId(revenue-analytics/energy-consumption-analytics/od-matrix-analyzer/
//    passenger-flow-simulator)와 trainNo(crowding-prediction, 기존 kr-train-schedule
//    등 운행정보 분야 도구의 출력과 동일 키)를 분야 전반에서 공통 키로 사용.
// ============================================================================

export const MCPS_ANALYTICS = [
  // ==========================================================================
  // 1. 수익 분석
  // ==========================================================================
  {
    id: 'revenue-analytics',
    name: 'Revenue Analytics',
    nameKo: '수익 분석',
    icon: '💹',
    category: '데이터분석',
    description: '노선·역별 운임 수익을 집계하고 노선 간 수익 순위와 수익성(이익률) 지표를 산출한다.',
    version: '1.0.0',
    tags: ['수익분석', 'revenue', '수익성', 'KPI'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_revenue_summary',
        description: '특정 노선의 기간별 운임 수익과 이용객 수를 집계한다. 순위 비교가 아닌 단일 노선의 누적 매출 현황 파악에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string', description: '노선 ID', examples: ['KTX-경부선'] },
            startDate: { type: 'string', format: 'date', description: '집계 시작일', examples: ['2026-07-01'] },
            endDate: { type: 'string', format: 'date', description: '집계 종료일', examples: ['2026-07-31'] },
            granularity: { type: 'string', enum: ['일별', '주별', '월별'], default: '일별', description: '집계 단위' }
          },
          required: ['lineId', 'startDate', 'endDate']
        },
        outputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string' },
            records: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', format: 'date' },
                  revenue: { type: 'number', description: '해당일 수익(원)' },
                  ridership: { type: 'integer', description: '해당일 이용객 수' }
                }
              }
            },
            totalRevenue: { type: 'number', description: '기간 합계 수익(원)' },
            currency: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [200, 600],
          samples: [
            {
              lineId: 'KTX-경부선',
              records: [
                { date: '2026-07-01', revenue: 1234000000, ridership: 52000 },
                { date: '2026-07-02', revenue: 1198500000, ridership: 50840 }
              ],
              totalRevenue: 2432500000,
              currency: 'KRW'
            }
          ]
        }
      },
      {
        name: 'rank_top_revenue_routes',
        description: '전체 노선 중 수익 상위 N개를 순위별로 조회한다. 단일 노선 상세가 아닌 노선 간 수익 비교·랭킹에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['이번달', '지난달', '올해'], default: '이번달', description: '집계 기간' },
            topN: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: '상위 몇 개 노선을 반환할지' }
          },
          required: ['period']
        },
        outputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lineId: { type: 'string' },
                  lineName: { type: 'string' },
                  revenue: { type: 'number' },
                  profitMargin: { type: 'number', description: '이익률(%)' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      },
      {
        name: 'compute_route_profitability',
        description: '노선 ID와 운영비를 입력받아 수익성(이익률)을 계산한다. rank_top_revenue_routes로 찾은 노선의 상세 수익성 진단에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string', description: '노선 ID', examples: ['KTX-경부선'] },
            operatingCost: { type: 'number', description: '해당 기간 운영비(원)', examples: [900000000] }
          },
          required: ['lineId', 'operatingCost']
        },
        outputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string' },
            revenue: { type: 'number' },
            operatingCost: { type: 'number' },
            profitMargin: { type: 'number', description: '이익률(%)' },
            profitable: { type: 'boolean' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 2. OD(기종점) 행렬 분석
  // ==========================================================================
  {
    id: 'od-matrix-analyzer',
    name: 'OD Matrix Analyzer',
    nameKo: 'OD 기종점 행렬 분석',
    icon: '🗺️',
    category: '데이터분석',
    description: '역-역 간 기종점(OD) 통행량을 네트워크 전체 단위로 행렬화하고, 증감 추이와 방향별 불균형을 분석한다.',
    version: '1.0.0',
    tags: ['OD행렬', '기종점', 'network', 'analytics'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'build_full_od_matrix',
        description: '기준일의 전체 역 간 기종점(OD) 통행량 행렬을 생성한다. 단일 노선이 아닌 네트워크 전체의 역-역 이동량 파악에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date', description: '기준일', examples: ['2026-07-05'] },
            timeBand: { type: 'string', enum: ['오전첨두', '오후첨두', '비첨두', '전체'], default: '전체', description: '집계 시간대' }
          },
          required: ['date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            odPairs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  originStationId: { type: 'string', description: '출발역 ID' },
                  destStationId: { type: 'string', description: '도착역 ID' },
                  tripCount: { type: 'integer', description: '통행량(건)' }
                }
              }
            },
            stationCount: { type: 'integer', description: '행렬에 포함된 역 수' },
            totalTrips: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [250, 700],
          samples: [
            {
              odPairs: [
                { originStationId: 'SEL', destStationId: 'BSN', tripCount: 8200 },
                { originStationId: 'SEL', destStationId: 'DJN', tripCount: 4100 },
                { originStationId: 'DJN', destStationId: 'BSN', tripCount: 2650 }
              ],
              stationCount: 120,
              totalTrips: 812000
            }
          ]
        }
      },
      {
        name: 'compute_od_growth_rate',
        description: '특정 OD쌍(출발역-도착역)의 두 기간 간 통행량 증감률을 계산한다. 단일 시점 행렬이 아닌 추세 변화 분석에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            originStationId: { type: 'string', description: '출발역 ID', examples: ['SEL'] },
            destStationId: { type: 'string', description: '도착역 ID', examples: ['BSN'] },
            baselineDate: { type: 'string', format: 'date', description: '기준(과거) 날짜' },
            compareDate: { type: 'string', format: 'date', description: '비교(최근) 날짜' }
          },
          required: ['originStationId', 'destStationId', 'baselineDate', 'compareDate']
        },
        outputSchema: {
          type: 'object',
          properties: {
            originStationId: { type: 'string' },
            destStationId: { type: 'string' },
            baselineTrips: { type: 'integer' },
            compareTrips: { type: 'integer' },
            growthRate: { type: 'number', description: '증감률(%)' }
          }
        }
      },
      {
        name: 'estimate_directional_imbalance',
        description: '특정 노선의 방향별(상행/하행) OD 통행량 불균형을 추정한다. 왕복 수요가 한쪽으로 쏠리는 구간을 식별할 때 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string', description: '노선 ID', examples: ['KTX-경부선'] },
            date: { type: 'string', format: 'date', description: '기준일' }
          },
          required: ['lineId', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  originStationId: { type: 'string' },
                  destStationId: { type: 'string' },
                  imbalanceRatio: { type: 'number', description: '방향 간 불균형 비율(1.0=균형)' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 3. 혼잡 예측
  // ==========================================================================
  {
    id: 'crowding-prediction',
    name: 'Crowding Prediction',
    nameKo: '혼잡 예측',
    icon: '👥',
    category: '데이터분석',
    description: '열차 칸별·역별 혼잡도를 단기적으로 예측하고 임계치 초과 혼잡 경보 대상을 식별한다.',
    version: '1.0.0',
    tags: ['혼잡예측', 'crowding', '실시간', 'KPI'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'predict_train_crowding',
        description: '특정 열차번호의 칸(차량)별 혼잡도를 예측한다. 노선 전체의 다일간 추이가 아닌 개별 열차 탑승 전 혼잡도 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] },
            date: { type: 'string', format: 'date', description: '운행 날짜', examples: ['2026-07-05'] }
          },
          required: ['trainNo', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            date: { type: 'string', format: 'date' },
            carCrowding: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  carNo: { type: 'integer', description: '차량(칸) 번호' },
                  congestionRate: { type: 'number', description: '혼잡도(0~1)' }
                }
              }
            },
            overallLevel: { type: 'string', enum: ['여유', '보통', '혼잡', '매우혼잡'], description: '열차 전체 종합 혼잡 등급' }
          }
        },
        mock: {
          latencyMs: [150, 500],
          samples: [
            {
              trainNo: 'KTX 101',
              date: '2026-07-05',
              carCrowding: [
                { carNo: 1, congestionRate: 0.42 },
                { carNo: 2, congestionRate: 0.81 },
                { carNo: 3, congestionRate: 0.63 }
              ],
              overallLevel: '혼잡'
            }
          ]
        }
      },
      {
        name: 'predict_station_crowding',
        description: '특정 역의 시간대별 혼잡도를 예측한다. 열차 단위가 아닌 역 전체 게이트·승강장 혼잡 파악에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string', description: '역 ID', examples: ['SEL'] },
            timeBand: { type: 'string', enum: ['오전첨두', '오후첨두', '비첨두', '전체'], default: '전체', description: '조회 시간대' }
          },
          required: ['stationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timeBand: { type: 'string' },
                  congestionRate: { type: 'number' }
                }
              }
            },
            peakTimeBand: { type: 'string' }
          }
        }
      },
      {
        name: 'get_crowding_alerts',
        description: '설정한 임계치를 초과하는 혼잡 경보 목록을 조회한다. 예측 수치 산출이 아닌 즉각 대응이 필요한 경보 목록 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string', description: '노선 ID', examples: ['KTX-경부선'] },
            threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.8, description: '경보 발령 혼잡도 임계치' }
          },
          required: ['lineId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            alerts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  stationId: { type: 'string' },
                  trainNo: { type: 'string' },
                  congestionRate: { type: 'number' },
                  level: { type: 'string' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 4. 에너지 소비 분석
  // ==========================================================================
  {
    id: 'energy-consumption-analytics',
    name: 'Energy Consumption Analytics',
    nameKo: '에너지 소비 분석',
    icon: '⚡',
    category: '데이터분석',
    description: '열차·노선별 전력 에너지 소비량을 집계하고 구간별 에너지 절감 기회를 분석한다.',
    version: '1.0.0',
    tags: ['에너지', 'energy', '전력', '탄소저감'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_energy_usage',
        description: '특정 노선의 기간별 전력 에너지 소비량을 집계한다. 개별 열차 효율이 아닌 노선 전체 누적 소비량 파악에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string', description: '노선 ID', examples: ['KTX-경부선'] },
            startDate: { type: 'string', format: 'date', description: '집계 시작일' },
            endDate: { type: 'string', format: 'date', description: '집계 종료일' }
          },
          required: ['lineId', 'startDate', 'endDate']
        },
        outputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string' },
            records: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', format: 'date' },
                  energyKwh: { type: 'number', description: '해당일 소비 전력량(kWh)' }
                }
              }
            },
            totalEnergyKwh: { type: 'number' }
          }
        },
        mock: {
          latencyMs: [200, 600],
          samples: [
            {
              lineId: 'KTX-경부선',
              records: [
                { date: '2026-07-01', energyKwh: 184200 },
                { date: '2026-07-02', energyKwh: 179850 }
              ],
              totalEnergyKwh: 364050
            }
          ]
        }
      },
      {
        name: 'compute_energy_efficiency',
        description: '특정 열차의 주행거리 대비 에너지 소비 효율을 계산한다. 노선 총량 집계가 아닌 열차 단위 효율 진단에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '열차번호', examples: ['KTX 101'] },
            distanceKm: { type: 'number', description: '주행 거리(km)', examples: [418] }
          },
          required: ['trainNo', 'distanceKm']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            energyKwh: { type: 'number' },
            distanceKm: { type: 'number' },
            efficiencyKwhPerKm: { type: 'number', description: 'km당 소비 전력량(kWh/km)' }
          }
        }
      },
      {
        name: 'rank_energy_saving_opportunities',
        description: '노선 내 구간별 에너지 절감 잠재량을 순위화한다. 현재 소비량 집계가 아닌 개선 우선순위 도출에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string', description: '노선 ID', examples: ['KTX-경부선'] },
            topN: { type: 'integer', minimum: 1, maximum: 20, default: 5, description: '상위 몇 개 구간을 반환할지' }
          },
          required: ['lineId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sectionId: { type: 'string' },
                  potentialSavingKwh: { type: 'number' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 5. KPI 대시보드 데이터
  // ==========================================================================
  {
    id: 'kpi-dashboard-hub',
    name: 'KPI Dashboard Hub',
    nameKo: 'KPI 대시보드 데이터',
    icon: '🎛️',
    category: '데이터분석',
    description: '여러 운영 지표를 통합 조회하고 시계열·목표 대비 달성률을 제공하는 KPI 대시보드 데이터 허브.',
    version: '1.0.0',
    tags: ['KPI', '대시보드', 'dashboard', 'metrics'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_kpi_summary',
        description: '여러 지표 ID의 최신 값과 추세를 한번에 요약 조회한다. 단일 지표의 상세 시계열이 아닌 대시보드용 스냅샷 요약에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            metricIds: {
              type: 'array',
              items: { type: 'string' },
              description: '조회할 지표 ID 목록',
              examples: [['정시율', '평균혼잡도']]
            },
            period: { type: 'string', enum: ['일간', '주간', '월간'], default: '일간', description: '집계 주기' }
          },
          required: ['metricIds']
        },
        outputSchema: {
          type: 'object',
          properties: {
            kpis: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  metricId: { type: 'string' },
                  value: { type: 'number' },
                  unit: { type: 'string' },
                  trend: { type: 'string', enum: ['상승', '하락', '유지'] }
                }
              }
            },
            generatedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [150, 500],
          samples: [
            {
              kpis: [
                { metricId: '정시율', value: 96.8, unit: '%', trend: '유지' },
                { metricId: '평균혼잡도', value: 0.62, unit: '비율', trend: '상승' }
              ],
              generatedAt: '2026-07-05T09:00:00Z'
            }
          ]
        }
      },
      {
        name: 'get_metric_timeseries',
        description: '단일 지표 ID의 기간별 원시 시계열 값을 조회한다. 요약 스냅샷이 아닌 이상탐지·추세분석용 시계열 제공에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            metricId: { type: 'string', description: '지표 ID', examples: ['평균혼잡도'] },
            startDate: { type: 'string', format: 'date', description: '조회 시작일' },
            endDate: { type: 'string', format: 'date', description: '조회 종료일' }
          },
          required: ['metricId', 'startDate', 'endDate']
        },
        outputSchema: {
          type: 'object',
          properties: {
            metricId: { type: 'string' },
            series: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'string', format: 'date-time' },
                  value: { type: 'number' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      },
      {
        name: 'compare_kpi_targets',
        description: '지표 ID의 실제값과 목표값을 비교해 달성률을 계산한다. 추세 조회가 아닌 목표 대비 성과 평가에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            metricId: { type: 'string', description: '지표 ID', examples: ['정시율'] },
            targetValue: { type: 'number', description: '목표값', examples: [97] }
          },
          required: ['metricId', 'targetValue']
        },
        outputSchema: {
          type: 'object',
          properties: {
            metricId: { type: 'string' },
            actualValue: { type: 'number' },
            targetValue: { type: 'number' },
            achievedRate: { type: 'number', description: '목표 달성률(%)' },
            achieved: { type: 'boolean' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 6. 이상탐지
  // ==========================================================================
  {
    id: 'anomaly-detection-engine',
    name: 'Anomaly Detection Engine',
    nameKo: '이상탐지',
    icon: '🚨',
    category: '데이터분석',
    description: '운영 지표 시계열에서 통계적 이상치를 탐지해 경보를 생성하고 경보 상태를 관리한다.',
    version: '1.0.0',
    tags: ['이상탐지', 'anomaly', '경보', 'alert'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'detect_series_anomalies',
        description: '주어진 지표 시계열에서 통계적 이상치를 탐지한다. 정상 추세 파악이 아닌 특이치·이상 구간 식별에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            metricId: { type: 'string', description: '지표 ID', examples: ['평균혼잡도'] },
            series: {
              type: 'array',
              description: '분석 대상 시계열 데이터',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'string', format: 'date-time' },
                  value: { type: 'number' }
                }
              }
            },
            sensitivity: { type: 'number', minimum: 0, maximum: 1, default: 0.5, description: '탐지 민감도(높을수록 더 많이 탐지)' }
          },
          required: ['metricId', 'series']
        },
        outputSchema: {
          type: 'object',
          properties: {
            metricId: { type: 'string' },
            anomalies: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'string', format: 'date-time' },
                  value: { type: 'number' },
                  score: { type: 'number', description: '이상치 점수(0~1)' }
                }
              }
            },
            count: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [200, 650],
          samples: [
            {
              metricId: '평균혼잡도',
              anomalies: [
                { timestamp: '2026-07-03T18:00:00Z', value: 0.97, score: 0.91 }
              ],
              count: 1
            }
          ]
        }
      },
      {
        name: 'get_active_alerts',
        description: '현재 활성화된 이상 경보 목록을 심각도별로 조회한다. 탐지 실행이 아닌 이미 생성된 경보 확인·트리아지에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['낮음', '보통', '높음', '긴급'], default: '보통', description: '조회할 최소 심각도' }
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
                  alertId: { type: 'string' },
                  metricId: { type: 'string' },
                  severity: { type: 'string' },
                  detectedAt: { type: 'string', format: 'date-time' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      },
      {
        name: 'acknowledge_alert',
        description: '특정 경보를 확인 처리한다. 조회가 아닌 경보 상태 변경(확인/처리 완료)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            alertId: { type: 'string', description: '경보 ID', examples: ['ALRT-2026-0705-001'] }
          },
          required: ['alertId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            alertId: { type: 'string' },
            status: { type: 'string', enum: ['확인됨', '처리중', '해제됨'] },
            acknowledgedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 7. 승객 흐름 시뮬레이션
  // ==========================================================================
  {
    id: 'passenger-flow-simulator',
    name: 'Passenger Flow Simulator',
    nameKo: '승객 흐름 시뮬레이션',
    icon: '🚶',
    category: '데이터분석',
    description: 'OD 수요 데이터를 바탕으로 역·구간별 승객 흐름을 시뮬레이션하고 병목 구간을 예측한다.',
    version: '1.0.0',
    tags: ['시뮬레이션', 'simulation', '승객흐름', '병목'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'simulate_route_flow',
        description: '특정 출발역-도착역 간 승객 흐름과 예상 소요시간을 시뮬레이션한다. 네트워크 전체가 아닌 단일 OD쌍의 상세 흐름 분석에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            originStationId: { type: 'string', description: '출발역 ID', examples: ['SEL'] },
            destStationId: { type: 'string', description: '도착역 ID', examples: ['BSN'] },
            tripCount: { type: 'integer', description: '시뮬레이션할 승객 수', examples: [500] },
            timeBand: { type: 'string', enum: ['오전첨두', '오후첨두', '비첨두', '전체'], default: '전체', description: '시뮬레이션 시간대' }
          },
          required: ['originStationId', 'destStationId', 'tripCount']
        },
        outputSchema: {
          type: 'object',
          properties: {
            originStationId: { type: 'string' },
            destStationId: { type: 'string' },
            path: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  stationId: { type: 'string' },
                  arrivalOffsetMin: { type: 'number', description: '출발 대비 도착 경과시간(분)' }
                }
              }
            },
            estimatedTravelTimeMin: { type: 'number' }
          }
        },
        mock: {
          latencyMs: [250, 700],
          samples: [
            {
              originStationId: 'SEL',
              destStationId: 'BSN',
              path: [
                { stationId: 'SEL', arrivalOffsetMin: 0 },
                { stationId: 'DJN', arrivalOffsetMin: 52 },
                { stationId: 'BSN', arrivalOffsetMin: 159 }
              ],
              estimatedTravelTimeMin: 159
            }
          ]
        }
      },
      {
        name: 'simulate_network_load',
        description: '전체 OD 행렬을 입력받아 네트워크 단위 부하와 병목역을 시뮬레이션한다. 단일 OD쌍이 아닌 네트워크 전체 흐름 부하 분석에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            odPairs: {
              type: 'array',
              description: 'OD 행렬 데이터(역-역 통행량 목록)',
              items: {
                type: 'object',
                properties: {
                  originStationId: { type: 'string' },
                  destStationId: { type: 'string' },
                  tripCount: { type: 'integer' }
                }
              }
            },
            date: { type: 'string', format: 'date', description: '시뮬레이션 기준일' }
          },
          required: ['odPairs', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
            bottlenecks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  stationId: { type: 'string' },
                  loadFactor: { type: 'number', description: '부하율(1.0=정원 도달)' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      },
      {
        name: 'estimate_bottleneck_stations',
        description: '특정 노선에서 부하율이 임계치를 초과하는 병목역을 추정한다. 전체 시뮬레이션 실행이 아닌 임계치 기반 빠른 진단에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string', description: '노선 ID', examples: ['KTX-경부선'] },
            thresholdLoadFactor: { type: 'number', minimum: 0, maximum: 2, default: 0.85, description: '병목 판정 부하율 임계치' }
          },
          required: ['lineId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            lineId: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  stationId: { type: 'string' },
                  loadFactor: { type: 'number' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      }
    ]
  }
];
