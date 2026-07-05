// ============================================================================
// MCP 카탈로그 확장 — 기상·환경 (weather) 분야 신규 7개 서버
// 기존 3개(rail-weather, air-quality-monitor, disaster-alert)와 상호보완:
//   - rail-weather      : 구간 현재기상/예보 + 운행영향 일반 평가
//   - air-quality-monitor: 지하역사·터널 실내 공기질
//   - disaster-alert    : 지역 단위 재난특보 + 노선별 침수위험등급/지진영향평가
// 신규 7개는 "센서 실측 → 판정/조치" 흐름의 세부 운영 도메인에 특화:
//   강풍/태풍 운행규제, 하천·배수 실황, 강설/결빙 제설조치, 지진감지센서망,
//   레일온도/장출(좌굴) 위험, 시정/안개 신호시인성, 폭염/자외선 승강장 대응.
// 서버당 도구 3개(2~4 규격 충족), 서버별 대표 도구 1개 mock 포함.
// ============================================================================

export const MCPS_WEATHER = [
  // ==========================================================================
  // 1. 강풍·태풍 운행규제
  // ==========================================================================
  {
    id: 'wind-typhoon-guard',
    name: 'Wind & Typhoon Guard',
    nameKo: '강풍·태풍 운행규제',
    icon: '🌪️',
    category: '기상·환경',
    description: '노선 구간별 실측 풍속·순간최대풍속을 감시하고, 기준치 초과 시 서행·운행중지 규제 단계와 태풍 경로 예보를 제공한다.',
    version: '1.0.0',
    tags: ['강풍', '태풍', '운행규제', 'windMs'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_wind_speed',
        description: '노선 구간의 실시간 풍속과 순간최대풍속(돌풍)을 조회한다. 규제 단계 판단이 아닌 실측값 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string', description: '노선 구간명', examples: ['영동선 도경리-옥계'] }
          },
          required: ['section']
        },
        outputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string' },
            sectionId: { type: 'string', description: '구간 식별자' },
            windMs: { type: 'number', description: '평균 풍속(m/s)' },
            gustMs: { type: 'number', description: '순간최대풍속(m/s)' },
            measuredAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [90, 320],
          samples: [
            { section: '영동선 도경리-옥계', sectionId: 'WD-021', windMs: 18.2, gustMs: 26.5, measuredAt: '2026-07-05T05:40:00' }
          ]
        }
      },
      {
        name: 'get_speed_restriction',
        description: '풍속 실측 구간ID를 기준으로 현재 적용 중인 운행 규제 단계(서행/운행중지)와 제한속도를 조회한다. 실측 풍속이 아닌 규제 적용 결과 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'string', description: '구간 식별자', examples: ['WD-021'] }
          },
          required: ['sectionId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'string' },
            restrictionLevel: { type: 'string', enum: ['정상', '서행', '운행중지'], description: '현재 규제 단계' },
            maxSpeedKmh: { type: 'number', description: '제한속도(km/h)' },
            effectiveFrom: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'get_typhoon_forecast',
        description: '한반도 접근 태풍의 예상 경로·상륙 시점과 영향권 노선을 조회한다. 현재 풍속 실측이 아닌 태풍 예보 정보에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '지역/권역', examples: ['남부권', '수도권'] }
          },
          required: ['region']
        },
        outputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            typhoonName: { type: 'string', description: '태풍 이름' },
            intensity: { type: 'string', description: '중형/대형 등 강도 등급' },
            expectedLandfall: { type: 'string', format: 'date-time' },
            affectedLines: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 2. 선로 배수·하천 수위 감시
  // ==========================================================================
  {
    id: 'flood-drainage-monitor',
    name: 'Flood Drainage Monitor',
    nameKo: '선로 배수·하천 수위 감시',
    icon: '💧',
    category: '기상·환경',
    description: '철도 인접 하천 수위와 배수펌프장 가동 현황, 지하차도·저지대의 실시간 침수 실황을 감시해 배수 대응 필요 여부를 판단한다.',
    version: '1.0.0',
    tags: ['하천수위', '배수펌프', '침수실황', 'drainage'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_river_level',
        description: '철도 교량·저지대 인접 하천의 실시간 수위와 상승률을 조회한다. 예측 위험등급이 아닌 실측 수위 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            river: { type: 'string', description: '하천명', examples: ['남한강', '섬진강'] }
          },
          required: ['river']
        },
        outputSchema: {
          type: 'object',
          properties: {
            river: { type: 'string' },
            stationId: { type: 'string', description: '연계 배수펌프장 식별자' },
            waterLevelM: { type: 'number', description: '현재 수위(m)' },
            riseRateMh: { type: 'number', description: '시간당 상승률(m/h)' },
            warningStage: { type: 'string', enum: ['정상', '관심', '주의', '경계', '심각'] }
          }
        },
        mock: {
          latencyMs: [100, 360],
          samples: [
            { river: '남한강', stationId: 'PS-07', waterLevelM: 4.8, riseRateMh: 0.3, warningStage: '주의' }
          ]
        }
      },
      {
        name: 'get_drainage_pump_status',
        description: '배수펌프장 식별자를 기준으로 가동 대수와 처리 용량 대비 가동률을 조회한다. 하천 수위가 아닌 배수 설비 가동 현황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string', description: '배수펌프장 식별자', examples: ['PS-07'] }
          },
          required: ['stationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string' },
            pumpsTotal: { type: 'integer', description: '설치 펌프 총 대수' },
            pumpsRunning: { type: 'integer', description: '가동 중인 펌프 대수' },
            capacityUsedPct: { type: 'number', description: '처리 용량 대비 가동률(%)' }
          }
        }
      },
      {
        name: 'get_underpass_flood_status',
        description: '지하차도·저지대 구간의 실시간 침수 깊이와 통제 여부를 조회한다. 하천 수위나 위험등급 예측이 아닌 현재 침수 실황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '지하차도/저지대 명칭', examples: ['오송 지하차도'] }
          },
          required: ['location']
        },
        outputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            currentDepthCm: { type: 'number', description: '현재 침수 깊이(cm)' },
            status: { type: 'string', enum: ['정상', '주의', '통제'] },
            closedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 3. 강설·결빙 관제
  // ==========================================================================
  {
    id: 'snow-ice-control',
    name: 'Snow & Ice Control',
    nameKo: '강설·결빙 관제',
    icon: '❄️',
    category: '기상·환경',
    description: '노선 구간의 적설량과 레일 결빙 상태를 감시하고, 결빙 위험 판정 시 제설·해빙 작업을 지시한다.',
    version: '1.0.0',
    tags: ['적설', '결빙', '제설', 'deicing'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_snow_depth',
        description: '노선 구간의 현재 적설량과 시간당 강설률을 조회한다. 결빙 위험 판정이 아닌 적설 실측값 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string', description: '노선 구간명', examples: ['경강선 강릉기점 인근'] }
          },
          required: ['section']
        },
        outputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string' },
            sectionId: { type: 'string', description: '구간 식별자' },
            snowDepthCm: { type: 'number', description: '현재 적설량(cm)' },
            snowfallRateCmh: { type: 'number', description: '시간당 강설률(cm/h)' }
          }
        },
        mock: {
          latencyMs: [90, 330],
          samples: [
            { section: '경강선 강릉기점 인근', sectionId: 'SN-014', snowDepthCm: 12.5, snowfallRateCmh: 2.1 }
          ]
        }
      },
      {
        name: 'get_rail_icing_status',
        description: '적설 구간ID를 기준으로 레일 표면온도와 결빙 위험도를 조회한다. 적설량이 아닌 결빙 여부 판정에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'string', description: '구간 식별자', examples: ['SN-014'] }
          },
          required: ['sectionId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'string' },
            railSurfaceTempC: { type: 'number', description: '레일 표면온도(℃)' },
            icingRisk: { type: 'string', enum: ['낮음', '보통', '높음'] }
          }
        }
      },
      {
        name: 'request_deicing',
        description: '결빙 위험 구간에 제설·해빙 작업(열선가동/제설제살포/장비출동)을 요청하고 처리 상태를 반환한다. 위험도 조회가 아닌 조치 실행에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'string', description: '구간 식별자', examples: ['SN-014'] },
            method: { type: 'string', enum: ['열선가동', '제설제살포', '장비출동'], default: '열선가동', description: '해빙 조치 방식' }
          },
          required: ['sectionId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'string' },
            dispatched: { type: 'boolean', description: '조치 실행 여부' },
            method: { type: 'string' },
            eta: { type: 'string', format: 'time', description: '완료 예상 시각' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 4. 철도 지진감지센서망
  // ==========================================================================
  {
    id: 'rail-seismic-sensor',
    name: 'Rail Seismic Sensor Network',
    nameKo: '철도 지진감지센서망',
    icon: '📳',
    category: '기상·환경',
    description: '노선에 설치된 지진감지센서의 실시간 진동·규모를 측정하고, 임계치 초과 시 해당 센서 인근 구간에 자동 경보와 서행 지시를 발령한다.',
    version: '1.0.0',
    tags: ['지진감지', '센서', '조기경보', 'seismic'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_seismic_reading',
        description: '특정 지진감지센서의 실시간 계측값(규모·최대지반가속도)을 조회한다. 지역 전체 지진 영향평가가 아닌 개별 센서 실측 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '센서 설치 위치', examples: ['동해선 42호 교량'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            sensorId: { type: 'string', description: '센서 식별자' },
            magnitude: { type: 'number', description: '측정 규모' },
            pga: { type: 'number', description: '최대지반가속도(gal)' },
            detectedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [80, 300],
          samples: [
            { station: '동해선 42호 교량', sensorId: 'EQ-S42', magnitude: 3.4, pga: 12.8, detectedAt: '2026-07-05T02:11:00' }
          ]
        }
      },
      {
        name: 'issue_seismic_alert',
        description: '센서ID를 기준으로 경보 단계와 인근 노선의 서행 지시(제한속도)를 발령한다. 실측값 조회가 아닌 경보·조치 발령에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            sensorId: { type: 'string', description: '센서 식별자', examples: ['EQ-S42'] },
            magnitude: { type: 'number', description: '측정 규모(선택, 미지정 시 최신값 사용)' }
          },
          required: ['sensorId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            sensorId: { type: 'string' },
            alertLevel: { type: 'string', enum: ['관심', '주의', '경계', '심각'] },
            affectedLines: { type: 'array', items: { type: 'string' } },
            speedLimitKmh: { type: 'number', description: '제한속도(km/h)' }
          }
        }
      },
      {
        name: 'get_sensor_network_status',
        description: '노선별 지진감지센서 네트워크의 정상 가동 대수와 점검이 필요한 센서를 조회한다. 실시간 계측값이 아닌 센서망 자체의 상태 점검에 사용.',
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
            sensorsTotal: { type: 'integer', description: '설치 센서 총 개수' },
            sensorsOnline: { type: 'integer', description: '정상 가동 센서 수' },
            maintenanceNeeded: { type: 'array', items: { type: 'string' }, description: '점검 필요 센서 ID 목록' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 5. 레일 온도·장출(좌굴) 위험
  // ==========================================================================
  {
    id: 'rail-buckling-risk',
    name: 'Rail Thermal Buckling Risk',
    nameKo: '레일 온도·장출(좌굴) 위험',
    icon: '🌡️',
    category: '기상·환경',
    description: '혹서기 레일 표면온도를 측정하고 장출(레일 좌굴) 위험도를 평가해 구간별 서행 규제를 안내한다.',
    version: '1.0.0',
    tags: ['레일온도', '장출', '좌굴', '폭염'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_rail_temperature',
        description: '노선 구간의 레일 표면온도와 기온을 조회한다. 장출 위험 판정이 아닌 온도 실측값 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string', description: '노선 구간명', examples: ['경부선 대전조차장 인근'] }
          },
          required: ['section']
        },
        outputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string' },
            sectionId: { type: 'string', description: '구간 식별자' },
            railTempC: { type: 'number', description: '레일 표면온도(℃)' },
            ambientTempC: { type: 'number', description: '기온(℃)' },
            measuredAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [90, 310],
          samples: [
            { section: '경부선 대전조차장 인근', sectionId: 'RT-033', railTempC: 58.4, ambientTempC: 35.2, measuredAt: '2026-07-05T14:00:00' }
          ]
        }
      },
      {
        name: 'get_buckling_risk',
        description: '구간ID의 레일온도를 기준으로 장출(좌굴) 위험 등급과 권장 서행속도를 조회한다. 온도 실측값이 아닌 위험 평가 결과 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'string', description: '구간 식별자', examples: ['RT-033'] }
          },
          required: ['sectionId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            sectionId: { type: 'string' },
            riskGrade: { type: 'string', enum: ['낮음', '보통', '높음', '매우높음'] },
            recommendedSpeedKmh: { type: 'number', description: '권장 서행속도(km/h)' }
          }
        }
      },
      {
        name: 'get_heat_speed_restriction',
        description: '혹서기 레일온도 상승으로 노선 전체에 적용 중인 서행 구간 목록과 사유를 조회한다. 단일 구간이 아닌 노선 전체 규제 현황 확인에 사용.',
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
            restrictions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  section: { type: 'string' },
                  maxSpeedKmh: { type: 'number' },
                  reason: { type: 'string' }
                }
              }
            },
            count: { type: 'integer', description: '규제 구간 수' }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 6. 시정·안개 감시
  // ==========================================================================
  {
    id: 'fog-visibility-monitor',
    name: 'Fog & Visibility Monitor',
    nameKo: '시정·안개 감시',
    icon: '🌁',
    category: '기상·환경',
    description: '노선·역 구간의 시정거리와 안개 농도를 측정하고, 신호 시인성 저하 시 서행·주의운전 권고를 제공한다.',
    version: '1.0.0',
    tags: ['시정', '안개', '시인성', 'visibility'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_visibility',
        description: '특정 지점의 실시간 시정거리와 안개 농도를 조회한다. 신호 시인성 영향 평가가 아닌 시정 실측값 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '지점명', examples: ['서해선 안개잦은 구간'] }
          },
          required: ['location']
        },
        outputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            locationId: { type: 'string', description: '지점 식별자' },
            visibilityM: { type: 'integer', description: '시정거리(m)' },
            fogDensity: { type: 'string', enum: ['없음', '옅음', '짙음', '매우짙음'] },
            measuredAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [90, 320],
          samples: [
            { location: '서해선 안개잦은 구간', locationId: 'VZ-009', visibilityM: 320, fogDensity: '짙음', measuredAt: '2026-07-05T06:20:00' }
          ]
        }
      },
      {
        name: 'get_signal_visibility_impact',
        description: '지점ID를 기준으로 신호기 시인 가능 거리와 서행·주의운전 권고를 조회한다. 시정 실측값이 아닌 신호 시인성에 대한 영향 평가에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            locationId: { type: 'string', description: '지점 식별자', examples: ['VZ-009'] }
          },
          required: ['locationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            locationId: { type: 'string' },
            signalVisibleRangeM: { type: 'integer', description: '신호기 시인 가능 거리(m)' },
            recommendedAction: { type: 'string', enum: ['정상운행', '주의운전', '서행'] }
          }
        }
      },
      {
        name: 'get_fog_forecast',
        description: '구간의 향후 시간대별 안개 발생 확률과 예상 시정거리를 조회한다. 현재 실황이 아닌 안개 예보 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '지역/구간', examples: ['서해안권'] },
            hours: { type: 'integer', minimum: 1, maximum: 24, default: 6, description: '예보 시간 범위(시간)' }
          },
          required: ['region']
        },
        outputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            forecast: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  hour: { type: 'integer' },
                  visibilityM: { type: 'integer' },
                  fogProbabilityPct: { type: 'number' }
                }
              }
            }
          }
        }
      }
    ]
  },

  // ==========================================================================
  // 7. 폭염·자외선 지수
  // ==========================================================================
  {
    id: 'heatwave-uv-monitor',
    name: 'Heatwave & UV Monitor',
    nameKo: '폭염·자외선 지수',
    icon: '🥵',
    category: '기상·환경',
    description: '역사·승강장의 체감온도와 자외선 지수를 측정하고, 폭염특보 단계에 따른 승강장 온열 대응 조치를 제공한다.',
    version: '1.0.0',
    tags: ['폭염', '자외선', '체감온도', 'heatindex'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_heat_index',
        description: '역/승강장의 기온·체감온도(열지수)와 자외선 지수를 조회한다. 대응 조치가 아닌 실측 지수 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '역/승강장', examples: ['부산역 야외승강장'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            stationId: { type: 'string', description: '역 식별자' },
            tempC: { type: 'number', description: '기온(℃)' },
            heatIndex: { type: 'number', description: '체감온도(열지수, ℃)' },
            uvIndex: { type: 'number', description: '자외선 지수' },
            measuredAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [90, 320],
          samples: [
            { station: '부산역 야외승강장', stationId: 'HW-15', tempC: 34.8, heatIndex: 39.5, uvIndex: 8.6, measuredAt: '2026-07-05T13:30:00' }
          ]
        }
      },
      {
        name: 'get_platform_heat_alert',
        description: '역ID를 기준으로 폭염 경보 단계와 현재 시행 중인 온열 대응 조치(그늘막/쿨링포그 등)를 조회한다. 실측 지수가 아닌 경보·조치 현황 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string', description: '역 식별자', examples: ['HW-15'] }
          },
          required: ['stationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            stationId: { type: 'string' },
            alertLevel: { type: 'string', enum: ['정상', '주의', '경고', '위험'] },
            coolingMeasures: { type: 'array', items: { type: 'string' }, description: '시행 중인 온열 대응 조치 목록' }
          }
        }
      },
      {
        name: 'get_uv_forecast',
        description: '지역의 향후 시간대별 자외선 지수 예보를 조회한다. 현재 실측값이 아닌 자외선 예보 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '지역명', examples: ['부산권'] }
          },
          required: ['region']
        },
        outputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            forecast: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  hour: { type: 'integer' },
                  uvIndex: { type: 'number' }
                }
              }
            }
          }
        }
      }
    ]
  }
];
