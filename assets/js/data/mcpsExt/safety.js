// ============================================================================
// mcpsExt/safety.js — 안전·관제(安全·管制) 분야 신규 MCP 서버 7종
// 기존 3종(signal-control, track-safety-monitor, emergency-dispatch)과
// 상호보완: 건널목 감시, 선로 침입 감지, ATP/ATC 방호 상태, CCTV 관제,
// 과속 단속, 대피 유도, 위험물 감시.
// SPEC 계약서 §1 McpServer/Tool 데이터 모델 준수. 순수 ES module.
//
// [서버 인덱스]
//  - level-crossing-monitor     : 건널목 차단기·경보·이벤트 감시
//  - perimeter-intrusion-detector: 선로 경계 침입 감지·경보 발령
//  - atp-atc-monitor             : 열차자동방호(ATP/ATC) 상태·목표속도 감시
//  - safety-cctv-control         : 역사·선로 CCTV 상태·이벤트 클립·실시간 스트림
//  - overspeed-enforcement       : 구간별 과속 판정·위반 이력·통보
//  - evacuation-guidance         : 비상 대피 방송·유도등 발령·진행 현황
//  - hazmat-watch                : 위험물 화차 명세·센서 감시·사고 신고
//
// io 체이닝 설계:
//  - detect_intrusion.events[].eventId, get_crossing_events.events[].eventId
//    → trigger_zone_alarm.eventId / get_event_clip.eventId (침입·건널목 이벤트의 영상 증거 확보)
//  - get_camera_status.cameras[].cameraId → request_live_stream.cameraId
//  - get_onboard_target_speed.maxAllowedKmh → check_overspeed.limitKmh (동일 개념의 제한속도)
//  - check_overspeed.{trainNo,section,excessKmh} → notify_violation.{trainNo,section,excessKmh}
//  - report_incident(emergency-dispatch).incidentId → trigger_evacuation.incidentId (사고 연계 대피 발령)
//  - trigger_evacuation.evacuationId → get_evacuation_status/end_evacuation.evacuationId
//  - get_hazmat_manifest.wagons[].wagonNo → monitor_hazmat_sensor.wagonNo → report_hazmat_incident.wagonNo
// ============================================================================

export const MCPS_SAFETY = [
  // --------------------------------------------------------------------------
  // 1. 건널목 감시
  // --------------------------------------------------------------------------
  {
    id: 'level-crossing-monitor',
    name: 'Level Crossing Monitor',
    nameKo: '건널목 감시',
    icon: '🚧',
    category: '안전·관제',
    description: '철도 건널목 차단기·경보기의 작동 상태를 실시간 감시하고, 무단진입·잔류 등 이벤트 이력을 조회하며 장애를 신고한다.',
    version: '1.0.0',
    tags: ['건널목', '차단기', 'crossing', '경보'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_crossing_status',
        description: '지정 건널목의 차단기 개폐 상태·경보 작동 여부·통과 감지 유무를 조회한다. 이벤트 이력이나 장애신고가 아닌 현재 작동 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            crossingId: { type: 'string', description: '건널목 ID', examples: ['CR-105'] }
          },
          required: ['crossingId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            crossingId: { type: 'string' },
            barrierState: { type: 'string', description: '차단기 상태(상승/하강중/하강완료)' },
            alarmActive: { type: 'boolean', description: '경보기 작동 여부' },
            obstruction: { type: 'boolean', description: '차단구역 내 사람/차량 잔류 감지 여부' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [80, 300],
          samples: [
            { crossingId: 'CR-105', barrierState: '하강완료', alarmActive: true, obstruction: false, updatedAt: '2026-07-05T09:02:10' }
          ]
        }
      },
      {
        name: 'get_crossing_events',
        description: '건널목의 무단진입·차단기 미작동·보행자 잔류 등 최근 이벤트 이력을 조회한다. 실시간 상태가 아닌 과거 사건 이력 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            crossingId: { type: 'string', description: '건널목 ID', examples: ['CR-105'] },
            sinceMin: { type: 'integer', minimum: 1, description: '최근 N분 이내 이벤트', default: 60 }
          },
          required: ['crossingId']
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
                  crossingId: { type: 'string' },
                  type: { type: 'string', description: '무단진입/미작동/보행자잔류/기타' },
                  severity: { type: 'string' },
                  occurredAt: { type: 'string', format: 'date-time' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      },
      {
        name: 'report_crossing_fault',
        description: '건널목 차단기·경보기 고장을 관제실에 신고하고 접수번호를 발급한다. 상태 조회가 아닌 장애 신고(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            crossingId: { type: 'string', description: '장애 건널목 ID', examples: ['CR-105'] },
            faultType: { type: 'string', enum: ['차단기고장', '경보기고장', '센서오류', '기타'], description: '장애 유형' },
            note: { type: 'string', description: '상세 설명(선택)' }
          },
          required: ['crossingId', 'faultType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reportId: { type: 'string' },
            crossingId: { type: 'string' },
            priority: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 2. 선로 침입 감지
  // --------------------------------------------------------------------------
  {
    id: 'perimeter-intrusion-detector',
    name: 'Perimeter Intrusion Detector',
    nameKo: '선로 침입 감지',
    icon: '🚷',
    category: '안전·관제',
    description: '선로 경계 펜스·광섬유 센서를 기반으로 구역별 무단 침입을 감지해 위험도를 평가하고, 센서 장비 상태 점검과 구역 경보 발령을 담당한다.',
    version: '1.0.0',
    tags: ['침입감지', '펜스센서', 'intrusion', '경계보안'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'detect_intrusion',
        description: '지정 구역(zone)의 펜스진동·광섬유·적외선 센서에서 감지된 무단 침입 이벤트를 조회한다. 지장물 탐지(낙석 등, track-safety-monitor)와 달리 사람의 경계 침입에 특화된 감지에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            zoneId: { type: 'string', description: '감시 구역 ID', examples: ['ZN-경부-014'] },
            sinceMin: { type: 'integer', minimum: 1, description: '최근 N분 이내 이벤트', default: 30 }
          },
          required: ['zoneId']
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
                  zoneId: { type: 'string' },
                  sensorType: { type: 'string', description: '펜스진동/광섬유/적외선' },
                  riskLevel: { type: 'string', enum: ['낮음', '보통', '높음'] },
                  detectedAt: { type: 'string', format: 'date-time' }
                }
              }
            },
            count: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [90, 350],
          samples: [
            {
              events: [
                { eventId: 'INT-20260705-011', zoneId: 'ZN-경부-014', sensorType: '펜스진동', riskLevel: '높음', detectedAt: '2026-07-05T09:04:22' }
              ],
              count: 1
            }
          ]
        }
      },
      {
        name: 'get_zone_sensor_health',
        description: '특정 구역 침입감지 센서 장비의 통신 연결 여부와 배터리 잔량을 점검한다. 침입 이벤트 조회가 아닌 센서 자체 헬스체크에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            zoneId: { type: 'string', description: '점검할 구역 ID', examples: ['ZN-경부-014'] }
          },
          required: ['zoneId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            zoneId: { type: 'string' },
            sensors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sensorId: { type: 'string' },
                  online: { type: 'boolean' },
                  batteryPercent: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'trigger_zone_alarm',
        description: '감지된 침입 이벤트에 대해 구역 경보(사이렌/경광등)를 원격 발령한다. 감지·점검이 아닌 실제 경보 발령(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: '경보 발령 대상 이벤트 ID', examples: ['INT-20260705-011'] },
            alarmType: { type: 'string', enum: ['사이렌', '경광등', '양쪽'], default: '양쪽', description: '발령할 경보 수단' }
          },
          required: ['eventId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            alarmId: { type: 'string' },
            eventId: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 3. 열차자동방호(ATP/ATC) 상태
  // --------------------------------------------------------------------------
  {
    id: 'atp-atc-monitor',
    name: 'ATP/ATC Monitor',
    nameKo: '열차자동방호 상태 감시',
    icon: '🔐',
    category: '안전·관제',
    description: '열차자동방호장치(ATP)·자동열차제어(ATC)의 작동 모드와 차상신호 수신 상태·목표속도를 감시하고 방호 장애를 보고한다.',
    version: '1.0.0',
    tags: ['ATP', 'ATC', '열차방호', 'protection'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_atp_status',
        description: '특정 열차의 ATP/ATC 작동 모드(자동방호/수동방호/차단 등)와 활성화 여부를 조회한다. 지상 신호기 현시(signal-control)와 달리 차상 방호장치 자체 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '조회할 열차번호', examples: ['KTX 101'] }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            atpMode: { type: 'string', description: '자동방호/수동방호/차단/시험' },
            active: { type: 'boolean' },
            lastBeaconAt: { type: 'string', format: 'date-time', description: '최근 지상자 수신 시각' }
          }
        },
        mock: {
          latencyMs: [80, 320],
          samples: [
            { trainNo: 'KTX 101', atpMode: '자동방호', active: true, lastBeaconAt: '2026-07-05T09:10:05' }
          ]
        }
      },
      {
        name: 'get_onboard_target_speed',
        description: '차상신호가 산출한 목표속도와 허용 최고속도를 조회한다. 지상 서행구간 조회(track-safety-monitor의 get_speed_restriction)와 달리 열차가 실제 수신한 차상 지시속도 확인에 사용.',
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
            section: { type: 'string', description: '현재 구간' },
            targetSpeedKmh: { type: 'number', description: '차상신호 목표속도(km/h)' },
            maxAllowedKmh: { type: 'number', description: '허용 최고속도(km/h)' }
          }
        }
      },
      {
        name: 'report_atp_fault',
        description: 'ATP/ATC 장치의 통신두절·오작동 등 방호 장애를 관제실에 보고한다. 상태 조회가 아닌 장애 신고(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '장애 발생 열차번호', examples: ['KTX 101'] },
            faultType: { type: 'string', enum: ['통신두절', '오작동', '차단해제불가', '기타'], description: '장애 유형' }
          },
          required: ['trainNo', 'faultType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reportId: { type: 'string' },
            trainNo: { type: 'string' },
            priority: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 4. CCTV 관제
  // --------------------------------------------------------------------------
  {
    id: 'safety-cctv-control',
    name: 'Safety CCTV Control',
    nameKo: '안전 CCTV 관제',
    icon: '📹',
    category: '안전·관제',
    description: '역사·선로 주변 CCTV의 가동 상태를 조회하고, 침입·건널목 등 안전 이벤트와 연동된 녹화 클립을 검색하며 실시간 스트림을 발급한다.',
    version: '1.0.0',
    tags: ['CCTV', '영상관제', '녹화', 'surveillance'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_camera_status',
        description: '지정 역/구간 CCTV 카메라의 온라인 여부·화질·팬틸트줌 지원 여부를 조회한다. 영상 내용 조회가 아닌 장비 가동 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회할 역/구간', examples: ['동대구'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            cameras: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cameraId: { type: 'string' },
                  station: { type: 'string' },
                  online: { type: 'boolean' },
                  resolution: { type: 'string' },
                  ptzEnabled: { type: 'boolean', description: '팬틸트줌 지원 여부' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [70, 280],
          samples: [
            {
              cameras: [
                { cameraId: 'CAM-DDG-03', station: '동대구', online: true, resolution: '1080p', ptzEnabled: true }
              ]
            }
          ]
        }
      },
      {
        name: 'get_event_clip',
        description: '침입감지·건널목 이벤트 등 안전 이벤트ID와 연동된 CCTV 녹화 클립 정보를 조회한다. 실시간 상태 조회가 아닌 특정 사건의 영상 증거 확보에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            eventId: { type: 'string', description: '조회할 안전 이벤트 ID', examples: ['INT-20260705-011'] }
          },
          required: ['eventId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            eventId: { type: 'string' },
            cameraId: { type: 'string' },
            clipUrl: { type: 'string', description: '녹화 클립 접근 URL' },
            durationSec: { type: 'number' },
            recordedAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'request_live_stream',
        description: '특정 카메라의 실시간 스트리밍 URL 발급을 요청한다. 상태 조회가 아닌 스트림 세션 생성(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            cameraId: { type: 'string', description: '스트림 요청 대상 카메라 ID', examples: ['CAM-DDG-03'] }
          },
          required: ['cameraId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            streamId: { type: 'string' },
            cameraId: { type: 'string' },
            streamUrl: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 5. 과속 단속
  // --------------------------------------------------------------------------
  {
    id: 'overspeed-enforcement',
    name: 'Overspeed Enforcement',
    nameKo: '과속 단속',
    icon: '📸',
    category: '안전·관제',
    description: '구간별 열차 실측 속도를 제한속도와 대조해 과속 여부를 판정하고, 위반 이력을 기록하며 확정된 위반을 관제실에 통보한다.',
    version: '1.0.0',
    tags: ['과속단속', '속도위반', 'overspeed', 'enforcement'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'check_overspeed',
        description: '특정 열차의 현재 구간 실측 속도를 제한속도와 비교해 과속 여부를 판정한다. 서행구간 조회(track-safety-monitor의 get_speed_restriction)와 달리 실제 위반 여부 판정에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '판정 대상 열차번호', examples: ['KTX 101'] },
            section: { type: 'string', description: '조회 구간(선택)', examples: ['천안아산~오송'] },
            limitKmh: { type: 'number', description: '비교할 제한속도(km/h, 생략 시 해당 구간 지정속도 자동 적용)', examples: [300] }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            section: { type: 'string' },
            actualSpeedKmh: { type: 'number' },
            limitKmh: { type: 'number' },
            violation: { type: 'boolean' },
            excessKmh: { type: 'number', description: '제한속도 초과분(km/h)' }
          }
        },
        mock: {
          latencyMs: [90, 340],
          samples: [
            { trainNo: 'KTX 101', section: '천안아산~오송', actualSpeedKmh: 312, limitKmh: 300, violation: true, excessKmh: 12 }
          ]
        }
      },
      {
        name: 'get_violation_history',
        description: '구간 또는 열차 기준 과속 위반 이력을 조회한다. 실시간 판정이 아닌 누적 위반 통계 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명(선택)', examples: ['경부선'] },
            trainNo: { type: 'string', description: '열차번호(선택)', examples: ['KTX 101'] },
            months: { type: 'integer', minimum: 1, maximum: 24, description: '최근 N개월 이력', default: 3 }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            violations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  violationId: { type: 'string' },
                  trainNo: { type: 'string' },
                  section: { type: 'string' },
                  excessKmh: { type: 'number' },
                  occurredAt: { type: 'string', format: 'date-time' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      },
      {
        name: 'notify_violation',
        description: '확정된 과속 위반을 관제실·운전지령에 통보하고 후속 조치를 요청한다. 판정·이력 조회가 아닌 통보(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '위반 열차번호', examples: ['KTX 101'] },
            section: { type: 'string', description: '위반 구간', examples: ['천안아산~오송'] },
            excessKmh: { type: 'number', description: '제한속도 초과분(km/h)', examples: [12] }
          },
          required: ['trainNo', 'section', 'excessKmh']
        },
        outputSchema: {
          type: 'object',
          properties: {
            notificationId: { type: 'string' },
            trainNo: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 6. 대피 유도
  // --------------------------------------------------------------------------
  {
    id: 'evacuation-guidance',
    name: 'Evacuation Guidance',
    nameKo: '대피 유도',
    icon: '🏃',
    category: '안전·관제',
    description: '역사·열차 내 비상상황 발생 시 대피 방송·유도등을 발령하고, 대피 진행 현황을 추적하며 상황 종료를 처리한다.',
    version: '1.0.0',
    tags: ['대피유도', '비상방송', 'evacuation', '유도등'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'trigger_evacuation',
        description: '지정 위치에 대피 경보(비상방송+유도등)를 발령한다. emergency-dispatch의 사고 접수(incidentId)와 연계 가능하며, 상태 조회가 아닌 대피 발령(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '대피 발령 위치', examples: ['동대구역 3번 승강장'] },
            reason: { type: 'string', enum: ['화재', '침수', '유해가스', '기타'], description: '대피 사유' },
            incidentId: { type: 'string', description: '연계된 사고번호(emergency-dispatch report_incident 결과, 선택)', examples: ['INC-20260704-0007'] }
          },
          required: ['location', 'reason']
        },
        outputSchema: {
          type: 'object',
          properties: {
            evacuationId: { type: 'string' },
            location: { type: 'string' },
            status: { type: 'string' },
            startedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [100, 380],
          samples: [
            { evacuationId: 'EVQ-20260705-004', location: '동대구역 3번 승강장', status: '발령중', startedAt: '2026-07-05T09:15:30' }
          ]
        }
      },
      {
        name: 'get_evacuation_status',
        description: '진행 중인 대피의 유도 완료 인원·개방 출구 수·잔류 인원 추정치를 조회한다. 신규 발령이 아닌 진행 상황 추적에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            evacuationId: { type: 'string', description: '조회할 대피 ID', examples: ['EVQ-20260705-004'] }
          },
          required: ['evacuationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            evacuationId: { type: 'string' },
            phase: { type: 'string', description: '발령/유도중/완료' },
            exitsOpen: { type: 'integer' },
            evacueesGuided: { type: 'integer' },
            estimatedRemaining: { type: 'integer', description: '잔류 추정 인원' }
          }
        }
      },
      {
        name: 'end_evacuation',
        description: '대피 상황 종료를 선언하고 정상 운영으로 전환한다. 상태 조회가 아닌 종료 처리(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            evacuationId: { type: 'string', description: '종료할 대피 ID', examples: ['EVQ-20260705-004'] }
          },
          required: ['evacuationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            evacuationId: { type: 'string' },
            status: { type: 'string' },
            endedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 7. 위험물 감시
  // --------------------------------------------------------------------------
  {
    id: 'hazmat-watch',
    name: 'Hazmat Watch',
    nameKo: '위험물 감시',
    icon: '☣️',
    category: '안전·관제',
    description: '위험물 적재 화차의 종류·수량 명세를 조회하고 누출·온도·압력 센서 이상을 감시하며, 위험물 사고를 신고한다.',
    version: '1.0.0',
    tags: ['위험물', '화물안전', 'hazmat', '누출감지'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_hazmat_manifest',
        description: '특정 화물열차에 적재된 위험물 화차의 유엔번호·위험등급·수량을 조회한다. 일반 화물 추적(freight-tracking)과 달리 위험물 적재 명세 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string', description: '화물열차 번호', examples: ['F-3012'] }
          },
          required: ['trainNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            trainNo: { type: 'string' },
            wagons: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  wagonNo: { type: 'string' },
                  unNumber: { type: 'string', description: '유엔 위험물 번호' },
                  hazmatClass: { type: 'string', description: '위험물 등급' },
                  quantityTon: { type: 'number' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [110, 400],
          samples: [
            {
              trainNo: 'F-3012',
              wagons: [
                { wagonNo: 'WG-77201', unNumber: 'UN1203', hazmatClass: '인화성액체(3급)', quantityTon: 42 }
              ]
            }
          ]
        }
      },
      {
        name: 'monitor_hazmat_sensor',
        description: '위험물 화차의 누출·온도·압력 센서값을 감시해 이상 여부를 판정한다. 적재 명세 조회가 아닌 실시간 센서 이상 감지에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            wagonNo: { type: 'string', description: '감시할 화차 번호', examples: ['WG-77201'] }
          },
          required: ['wagonNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            wagonNo: { type: 'string' },
            leakDetected: { type: 'boolean' },
            temperatureC: { type: 'number' },
            pressureKpa: { type: 'number' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'report_hazmat_incident',
        description: '위험물 누출·화재·파손 등 사고를 관제실에 신고하고 접수번호를 발급한다. 센서 감시가 아닌 사고 신고(쓰기)에 사용. emergency-dispatch의 비상 지령과 연계 가능.',
        inputSchema: {
          type: 'object',
          properties: {
            wagonNo: { type: 'string', description: '사고 화차 번호', examples: ['WG-77201'] },
            incidentType: { type: 'string', enum: ['누출', '화재', '파손', '기타'], description: '사고 유형' },
            location: { type: 'string', description: '사고 위치(선택)', examples: ['오봉역 조차장'] }
          },
          required: ['wagonNo', 'incidentType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reportId: { type: 'string' },
            wagonNo: { type: 'string' },
            severity: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  }
];
