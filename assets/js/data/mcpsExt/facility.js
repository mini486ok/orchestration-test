// ============================================================================
// mcpsExt/facility.js — 시설·유지보수 분야 신규 MCP 서버 7종
// SPEC(계약서 v2 §1) 준수. 기존 3종(track-maintenance, facility-asset-manager,
// catenary-power-monitor)과 id 충돌 없이 상호보완하도록 설계.
//
// [신규 서버 인덱스]
//  1. rolling-stock-maintenance     : 차량(전동차·기관차) 정비
//  2. station-equipment-monitor     : 역사 설비(엘리베이터·에스컬레이터·공조·조명) 통합 관리
//  3. structure-inspection          : 터널·교량 정밀점검
//  4. track-geometry-monitor        : 궤도 틀림·레일 마모 정량 측정
//  5. work-order-manager            : 작업지시(work order) 관리
//  6. spare-parts-inventory         : 예비부품 재고 관리
//  7. predictive-maintenance-sensor : 예지보전 센서 모니터링
//
// io 체이닝 설계 요지:
//  - assetId: predictive-maintenance-sensor의 출력 ↔ 기존 facility-asset-manager,
//    신규 work-order-manager의 입력과 동일 키로 연결.
//  - workOrderId: work-order-manager 출력 ↔ spare-parts-inventory 입력으로 연결.
//  - line/section: track-geometry-monitor ↔ 기존 track-maintenance와 동일 키 공유.
// ============================================================================

export const MCPS_FACILITY = [
  // --------------------------------------------------------------------------
  // 1. 차량 정비
  // --------------------------------------------------------------------------
  {
    id: 'rolling-stock-maintenance',
    name: 'Rolling Stock Maintenance',
    nameKo: '차량 정비 관리',
    icon: '🚋',
    category: '시설·유지보수',
    description: '전동차·기관차 등 철도차량의 검수 주기와 대차·제동장치·팬터그래프 등 핵심 부품의 마모 상태를 관리하고, 차량 정비 작업 이력을 기록한다.',
    version: '1.0.0',
    tags: ['차량정비', '검수', '대차', 'rolling-stock'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_vehicle_health',
        description: '차량번호로 대차·제동장치·모터·팬터그래프 등 핵심 부품별 건전도를 조회한다. 선로·시설물이 아닌 차량 자체의 정비 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            vehicleNo: { type: 'string', description: '차량번호', examples: ['EMU-341-08'] },
            component: { type: 'string', enum: ['대차', '제동장치', '모터', '팬터그래프', '전체'], default: '전체', description: '조회할 부품' }
          },
          required: ['vehicleNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            vehicleNo: { type: 'string' },
            components: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  component: { type: 'string' },
                  healthGrade: { type: 'string', description: 'A~E 건전도' },
                  note: { type: 'string' }
                }
              }
            },
            overallStatus: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [130, 480],
          samples: [
            {
              vehicleNo: 'EMU-341-08',
              components: [
                { component: '대차', healthGrade: 'B', note: '정상 범위' },
                { component: '제동장치', healthGrade: 'C', note: '패드 마모 진행 중' },
                { component: '팬터그래프', healthGrade: 'A', note: '이상 없음' }
              ],
              overallStatus: '주의'
            }
          ]
        }
      },
      {
        name: 'schedule_vehicle_inspection',
        description: '차량의 정기검수(경검수/중검수/전삭/대수선)를 차량기지 정비 일정에 예약 등록한다. 상태 조회가 아닌 신규 검수 일정 생성에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            vehicleNo: { type: 'string', description: '차량번호', examples: ['EMU-341-08'] },
            inspectionType: { type: 'string', enum: ['경검수', '중검수', '전삭', '대수선'], description: '검수 종류' },
            date: { type: 'string', format: 'date', description: '검수 예정일 (YYYY-MM-DD)', examples: ['2026-07-10'] }
          },
          required: ['vehicleNo', 'inspectionType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            inspectionId: { type: 'string' },
            depot: { type: 'string', description: '정비 차량기지' },
            windowStart: { type: 'string', format: 'date-time' },
            windowEnd: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'get_wheel_wear',
        description: '차륜(바퀴) 답면 마모량과 잔여 두께를 조회해 재삭정·교체 필요 여부를 판단한다. 차량 전반 건전도가 아닌 차륜 마모 세부 수치 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            vehicleNo: { type: 'string', description: '차량번호', examples: ['EMU-341-08'] },
            axleNo: { type: 'string', description: '축 번호(선택)', examples: ['3축'] }
          },
          required: ['vehicleNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            vehicleNo: { type: 'string' },
            wheels: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  axleNo: { type: 'string' },
                  treadWearMm: { type: 'number', description: '답면 마모량(mm)' },
                  remainingMm: { type: 'number', description: '잔여 두께(mm)' },
                  replaceNeeded: { type: 'boolean' }
                }
              }
            }
          }
        }
      },
      {
        name: 'log_repair',
        description: '차량에 수행한 수리·부품교체 작업 내역을 기록한다. 조회가 아닌 정비 이력 등록(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            vehicleNo: { type: 'string', description: '정비한 차량번호', examples: ['EMU-341-08'] },
            workType: { type: 'string', enum: ['부품교체', '수리', '전삭', '대수선'], description: '작업 종류' },
            partReplaced: { type: 'string', description: '교체 부품명(선택)', examples: ['제동패드'] },
            performedAt: { type: 'string', format: 'date', description: '작업 수행일' }
          },
          required: ['vehicleNo', 'workType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            repairId: { type: 'string' },
            vehicleNo: { type: 'string' },
            nextDueDate: { type: 'string', format: 'date' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 2. 역사 설비(엘리베이터·에스컬레이터·공조·조명) 통합 관리
  // --------------------------------------------------------------------------
  {
    id: 'station-equipment-monitor',
    name: 'Station Equipment Monitor',
    nameKo: '역사 설비 통합 관리',
    icon: '🛗',
    category: '시설·유지보수',
    description: '역사 내 엘리베이터·에스컬레이터의 가동 상태와 공조·조명 설비를 통합 감시하고, 설비 고장을 신고하며 공조 운전 스케줄을 설정한다.',
    version: '1.0.0',
    tags: ['역사설비', '엘리베이터', '공조', '조명'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_equipment_status',
        description: '역사 내 엘리베이터·에스컬레이터·공조·조명 설비의 현재 가동 상태와 고장 코드를 조회한다. 시설 자산의 내용연수·건전도 등급이 아닌 실시간 가동 여부 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '조회할 역', examples: ['수원'] },
            equipmentType: { type: 'string', enum: ['엘리베이터', '에스컬레이터', '공조', '조명', '전체'], default: '전체', description: '설비 종류' },
            equipmentId: { type: 'string', description: '특정 설비 ID(선택)', examples: ['EQ-SW-EL02'] }
          },
          required: ['station']
        },
        outputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string' },
            equipment: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  equipmentId: { type: 'string' },
                  equipmentType: { type: 'string' },
                  location: { type: 'string' },
                  operating: { type: 'boolean' },
                  faultCode: { type: 'string' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [100, 400],
          samples: [
            {
              station: '수원',
              equipment: [
                { equipmentId: 'EQ-SW-EL02', equipmentType: '엘리베이터', location: '1번 출구', operating: true, faultCode: '' },
                { equipmentId: 'EQ-SW-ES05', equipmentType: '에스컬레이터', location: '지하 1층 환승통로', operating: false, faultCode: 'ERR-STOP-03' }
              ]
            }
          ]
        }
      },
      {
        name: 'get_operation_log',
        description: '특정 설비의 최근 가동시간·정지 횟수·마지막 점검일을 조회한다. 실시간 상태가 아닌 운영 이력 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            equipmentId: { type: 'string', description: '조회할 설비 ID', examples: ['EQ-SW-ES05'] },
            days: { type: 'integer', minimum: 1, maximum: 365, description: '최근 N일 이력', default: 30 }
          },
          required: ['equipmentId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            equipmentId: { type: 'string' },
            operatingHours: { type: 'number' },
            stopCount: { type: 'integer' },
            lastInspection: { type: 'string', format: 'date' }
          }
        }
      },
      {
        name: 'report_equipment_fault',
        description: '엘리베이터·에스컬레이터·공조·조명 설비의 고장을 신고하고 접수번호를 발급한다. 상태 조회가 아닌 고장 신고(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            equipmentId: { type: 'string', description: '고장 설비 ID', examples: ['EQ-SW-ES05'] },
            faultType: { type: 'string', enum: ['정지', '이상소음', '센서오류', '누전', '기타'], description: '고장 유형' },
            note: { type: 'string', description: '상세 설명(선택)' }
          },
          required: ['equipmentId', 'faultType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reportId: { type: 'string' },
            equipmentId: { type: 'string' },
            priority: { type: 'string' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'set_hvac_schedule',
        description: '역사 구역별 공조(냉방/난방/환기) 운전 모드와 목표 온도를 설정한다. 고장 신고가 아닌 공조 운전 스케줄 설정(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            station: { type: 'string', description: '대상 역', examples: ['수원'] },
            zone: { type: 'string', description: '공조 구역', examples: ['대합실'] },
            mode: { type: 'string', enum: ['냉방', '난방', '환기', '정지'], description: '운전 모드' },
            targetTemp: { type: 'number', description: '목표 온도(°C, 선택)', examples: [24] }
          },
          required: ['station', 'zone', 'mode']
        },
        outputSchema: {
          type: 'object',
          properties: {
            scheduleId: { type: 'string' },
            station: { type: 'string' },
            zone: { type: 'string' },
            mode: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 3. 터널·교량 정밀점검
  // --------------------------------------------------------------------------
  {
    id: 'structure-inspection',
    name: 'Structure Inspection',
    nameKo: '터널·교량 정밀점검',
    icon: '🌉',
    category: '시설·유지보수',
    description: '터널·교량 구조물의 균열·누수·침하 등 정밀 안전점검 데이터를 관리하고, 점검 일정을 등록하며 발견된 구조적 결함을 보고한다.',
    version: '1.0.0',
    tags: ['터널', '교량', '구조점검', 'structure'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_structure_condition',
        description: '터널·교량 구조물의 균열 개수·최대 균열폭·변위량·배수 상태 등 정밀점검 수치를 조회한다. 자산 건전도 등급 요약이 아닌 구조 세부 계측값 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            structureType: { type: 'string', enum: ['터널', '교량'], description: '구조물 종류' },
            structureId: { type: 'string', description: '구조물 ID', examples: ['STR-BR-0421'] }
          },
          required: ['structureType', 'structureId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            structureId: { type: 'string' },
            structureType: { type: 'string' },
            crackCount: { type: 'integer', description: '균열 개수' },
            maxCrackWidthMm: { type: 'number', description: '최대 균열폭(mm)' },
            displacementMm: { type: 'number', description: '변위량(mm)' },
            drainageStatus: { type: 'string' },
            grade: { type: 'string', description: 'A~E 안전등급' }
          }
        },
        mock: {
          latencyMs: [140, 520],
          samples: [
            {
              structureId: 'STR-BR-0421',
              structureType: '교량',
              crackCount: 2,
              maxCrackWidthMm: 0.3,
              displacementMm: 1.1,
              drainageStatus: '양호',
              grade: 'B'
            }
          ]
        }
      },
      {
        name: 'schedule_structure_inspection',
        description: '터널·교량의 정밀점검(육안·드론·센서계측)을 일정에 예약 등록한다. 상태 조회가 아닌 신규 점검 일정 생성에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            structureType: { type: 'string', enum: ['터널', '교량'], description: '구조물 종류' },
            structureId: { type: 'string', description: '구조물 ID', examples: ['STR-BR-0421'] },
            method: { type: 'string', enum: ['육안', '드론', '센서계측'], description: '점검 방법' },
            date: { type: 'string', format: 'date', description: '점검 예정일 (YYYY-MM-DD)', examples: ['2026-07-12'] }
          },
          required: ['structureType', 'structureId', 'method']
        },
        outputSchema: {
          type: 'object',
          properties: {
            inspectionId: { type: 'string' },
            structureId: { type: 'string' },
            windowStart: { type: 'string', format: 'date-time' },
            windowEnd: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'report_structure_finding',
        description: '점검 중 발견한 균열·누수·침하·박리 등 구조적 결함을 보고하고 보수 우선순위를 산정한다. 조회가 아닌 결함 등록(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            structureId: { type: 'string', description: '결함 발견 구조물 ID', examples: ['STR-BR-0421'] },
            findingType: { type: 'string', enum: ['균열', '누수', '침하', '박리', '기타'], description: '결함 유형' },
            severity: { type: 'string', enum: ['경미', '주의', '긴급'], default: '주의', description: '심각도' }
          },
          required: ['structureId', 'findingType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            findingId: { type: 'string' },
            structureId: { type: 'string' },
            priority: { type: 'string' },
            recommendedAction: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 4. 궤도 틀림·레일 마모 정량 측정
  // --------------------------------------------------------------------------
  {
    id: 'track-geometry-monitor',
    name: 'Track Geometry Monitor',
    nameKo: '궤도 틀림·레일 마모 측정',
    icon: '📏',
    category: '시설·유지보수',
    description: '궤도검측차·센서 계측 데이터를 기반으로 궤간·수평·고저·줄틀림 등 궤도 틀림 지표와 레일 마모량을 정량 관리하고 허용치 초과 구간을 경보한다.',
    version: '1.0.0',
    tags: ['궤도틀림', '레일마모', 'geometry', '검측'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'measure_track_geometry',
        description: '지정 구간의 궤간·수평(캔트)·고저틀림·줄틀림 계측값을 조회한다. 점검 일정·이력이 아닌 정량 계측 데이터 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부선'] },
            section: { type: 'string', description: '구간(선택)', examples: ['천안~조치원'] },
            date: { type: 'string', format: 'date', description: '검측일(선택)' }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            section: { type: 'string' },
            points: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  km: { type: 'string', description: 'km정' },
                  gaugeMm: { type: 'number', description: '궤간(mm)' },
                  crossLevelMm: { type: 'number', description: '수평틀림(mm)' },
                  longitudinalLevelMm: { type: 'number', description: '고저틀림(mm)' },
                  alignmentMm: { type: 'number', description: '줄틀림(mm)' },
                  exceeds: { type: 'boolean', description: '허용치 초과 여부' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [150, 550],
          samples: [
            {
              line: '경부선',
              section: '천안~조치원',
              points: [
                { km: 'K98.2', gaugeMm: 1435.4, crossLevelMm: 2.1, longitudinalLevelMm: 3.0, alignmentMm: 1.8, exceeds: false },
                { km: 'K101.7', gaugeMm: 1437.9, crossLevelMm: 6.4, longitudinalLevelMm: 5.2, alignmentMm: 4.9, exceeds: true }
              ]
            }
          ]
        }
      },
      {
        name: 'get_rail_wear',
        description: '레일 두부의 수직·측면 마모량과 잔여 수명을 조회한다. 궤도 틀림(선형 오차)이 아닌 레일 단면 마모 자체 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부선'] },
            section: { type: 'string', description: '구간(선택)', examples: ['천안~조치원'] }
          },
          required: ['line']
        },
        outputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string' },
            section: { type: 'string' },
            segments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  km: { type: 'string' },
                  verticalWearMm: { type: 'number', description: '수직 마모량(mm)' },
                  sideWearMm: { type: 'number', description: '측면 마모량(mm)' },
                  remainingLifeYears: { type: 'number', description: '잔여 수명(년)' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_geometry_alert',
        description: '궤도 틀림·레일 마모가 허용 기준을 초과한 지점의 경보 목록을 조회한다. 개별 계측이 아닌 기준 초과 구간 스크리닝에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '노선명', examples: ['경부선'] },
            minSeverity: { type: 'string', enum: ['주의', '경계', '위험'], default: '주의', description: '최소 경보 등급' }
          },
          required: ['line']
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
                  line: { type: 'string' },
                  km: { type: 'string' },
                  alertType: { type: 'string', description: '궤간/수평/고저/줄틀림/마모' },
                  severity: { type: 'string' },
                  detectedAt: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 5. 작업지시(work order) 관리
  // --------------------------------------------------------------------------
  {
    id: 'work-order-manager',
    name: 'Work Order Manager',
    nameKo: '작업지시 관리',
    icon: '📋',
    category: '시설·유지보수',
    description: '선로결함·설비고장·구조점검 소견·예지보전 경보 등 각종 유지보수 소스로부터 작업지시서를 생성·배정하고 진행 상태를 추적한다.',
    version: '1.0.0',
    tags: ['작업지시', 'work-order', '정비관리', 'CMMS'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'create_work_order',
        description: '선로결함·시설자산·설비고장·구조점검 소견·예지보전 경보 등에서 발생한 정비 필요 사항으로 작업지시서를 신규 생성한다. 목록 조회가 아닌 작업지시 생성(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceType: { type: 'string', enum: ['선로결함', '자산정비', '설비고장', '구조점검', '예지보전'], description: '작업지시 발생 원인 분류' },
            sourceId: { type: 'string', description: '원인이 된 결함/보고/경보 ID', examples: ['ANM-20260705-0004'] },
            assetId: { type: 'string', description: '대상 자산/설비 ID(선택)', examples: ['AST-BR-0421'] },
            description: { type: 'string', description: '작업 내용 설명', examples: ['교량 균열 확대 보수 필요'] },
            priority: { type: 'string', enum: ['낮음', '보통', '긴급'], default: '보통', description: '우선순위' },
            station: { type: 'string', description: '관련 역(선택)', examples: ['수원'] }
          },
          required: ['sourceType', 'sourceId', 'description']
        },
        outputSchema: {
          type: 'object',
          properties: {
            workOrderId: { type: 'string' },
            status: { type: 'string' },
            assignedTeam: { type: 'string' },
            dueDate: { type: 'string', format: 'date' }
          }
        },
        mock: {
          latencyMs: [120, 460],
          samples: [
            {
              workOrderId: 'WO-20260705-0088',
              status: '배정',
              assignedTeam: '시설정비2팀',
              dueDate: '2026-07-09'
            }
          ]
        }
      },
      {
        name: 'get_work_order',
        description: '작업지시번호로 배정 팀·기한·필요 자재 등 작업지시 상세를 조회한다. 신규 생성이 아닌 기존 지시서 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            workOrderId: { type: 'string', description: '조회할 작업지시번호', examples: ['WO-20260705-0088'] }
          },
          required: ['workOrderId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            workOrderId: { type: 'string' },
            status: { type: 'string' },
            assignedTeam: { type: 'string' },
            dueDate: { type: 'string', format: 'date' },
            requiredParts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  partNo: { type: 'string' },
                  quantity: { type: 'integer' }
                }
              }
            }
          }
        }
      },
      {
        name: 'update_work_order_status',
        description: '작업지시의 진행 상태(배정/진행중/완료/보류)를 갱신한다. 조회가 아닌 상태 변경(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            workOrderId: { type: 'string', description: '대상 작업지시번호', examples: ['WO-20260705-0088'] },
            status: { type: 'string', enum: ['배정', '진행중', '완료', '보류'], description: '변경할 상태' },
            note: { type: 'string', description: '변경 사유(선택)' }
          },
          required: ['workOrderId', 'status']
        },
        outputSchema: {
          type: 'object',
          properties: {
            workOrderId: { type: 'string' },
            status: { type: 'string' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'list_work_orders',
        description: '상태·담당팀·역 기준으로 작업지시서 목록을 조회한다. 개별 지시서 상세가 아닌 전체 현황 파악에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['배정', '진행중', '완료', '보류'], description: '상태 필터(선택)' },
            team: { type: 'string', description: '담당팀 필터(선택)', examples: ['시설정비2팀'] },
            station: { type: 'string', description: '역 필터(선택)', examples: ['수원'] }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            workOrders: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  workOrderId: { type: 'string' },
                  sourceType: { type: 'string' },
                  priority: { type: 'string' },
                  status: { type: 'string' }
                }
              }
            },
            count: { type: 'integer' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 6. 예비부품 재고 관리
  // --------------------------------------------------------------------------
  {
    id: 'spare-parts-inventory',
    name: 'Spare Parts Inventory',
    nameKo: '예비부품 재고 관리',
    icon: '🔩',
    category: '시설·유지보수',
    description: '정비에 필요한 예비부품의 창고별 재고를 조회·예약하고, 부족 시 발주를 요청하며 부품 소모 이력을 관리한다.',
    version: '1.0.0',
    tags: ['예비부품', '재고', 'inventory', '발주'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'check_part_stock',
        description: '부품번호 또는 부품명으로 창고별 재고 수량과 보관 위치를 조회한다. 발주나 예약이 아닌 현재 재고 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            partNo: { type: 'string', description: '부품번호(선택)', examples: ['PT-BRK-2201'] },
            partName: { type: 'string', description: '부품명(선택)', examples: ['제동패드'] },
            depot: { type: 'string', description: '창고/자재센터(선택)', examples: ['대전자재창고'] }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            parts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  partNo: { type: 'string' },
                  partName: { type: 'string' },
                  depot: { type: 'string' },
                  quantity: { type: 'integer' },
                  unit: { type: 'string' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [90, 350],
          samples: [
            {
              parts: [
                { partNo: 'PT-BRK-2201', partName: '제동패드', depot: '대전자재창고', quantity: 48, unit: '개' },
                { partNo: 'PT-WHL-0087', partName: '차륜 세트', depot: '대전자재창고', quantity: 6, unit: '조' }
              ]
            }
          ]
        }
      },
      {
        name: 'reserve_parts',
        description: '작업지시에 필요한 부품을 재고에서 예약(배정)한다. 재고 조회가 아닌 실제 예약(쓰기) 처리에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            workOrderId: { type: 'string', description: '연결된 작업지시번호', examples: ['WO-20260705-0088'] },
            partNo: { type: 'string', description: '예약할 부품번호', examples: ['PT-BRK-2201'] },
            quantity: { type: 'integer', minimum: 1, description: '예약 수량', default: 1 }
          },
          required: ['workOrderId', 'partNo', 'quantity']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            partNo: { type: 'string' },
            remainingStock: { type: 'integer' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'request_part_order',
        description: '재고 부족 부품의 신규 발주를 요청한다. 예약이 아닌 외부 발주 요청(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            partNo: { type: 'string', description: '발주할 부품번호', examples: ['PT-WHL-0087'] },
            quantity: { type: 'integer', minimum: 1, description: '발주 수량' },
            reason: { type: 'string', description: '발주 사유(선택)', examples: ['안전재고 미달'] }
          },
          required: ['partNo', 'quantity']
        },
        outputSchema: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            partNo: { type: 'string' },
            expectedArrival: { type: 'string', format: 'date' },
            status: { type: 'string' }
          }
        }
      },
      {
        name: 'get_part_usage_history',
        description: '부품의 최근 소모 이력(월별 사용량 추이)을 조회한다. 재고 확인이 아닌 소모 패턴 분석용 이력 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            partNo: { type: 'string', description: '조회할 부품번호', examples: ['PT-BRK-2201'] },
            months: { type: 'integer', minimum: 1, maximum: 36, description: '최근 N개월 이력', default: 6 }
          },
          required: ['partNo']
        },
        outputSchema: {
          type: 'object',
          properties: {
            partNo: { type: 'string' },
            records: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  month: { type: 'string' },
                  usedQuantity: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 7. 예지보전 센서 모니터링
  // --------------------------------------------------------------------------
  {
    id: 'predictive-maintenance-sensor',
    name: 'Predictive Maintenance Sensor',
    nameKo: '예지보전 센서 모니터링',
    icon: '📡',
    category: '시설·유지보수',
    description: '설비·구조물·차량에 부착된 진동·온도·전류·음향 센서 데이터를 실시간 수집해 이상 징후를 탐지하고, 부품의 잔존수명을 예측한다.',
    version: '1.0.0',
    tags: ['예지보전', 'IoT', '이상탐지', 'sensor'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_sensor_reading',
        description: '자산(설비/차량/구조물)에 부착된 센서의 현재 계측값(진동/온도/전류/음향)을 조회한다. 이상탐지 결과가 아닌 원시 센서값 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: '조회할 자산 ID', examples: ['AST-BR-0421'] },
            sensorType: { type: 'string', enum: ['진동', '온도', '전류', '음향'], description: '센서 종류' }
          },
          required: ['assetId', 'sensorType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string' },
            sensorType: { type: 'string' },
            value: { type: 'number' },
            unit: { type: 'string' },
            threshold: { type: 'number', description: '경보 임계값' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [80, 320],
          samples: [
            {
              assetId: 'AST-BR-0421',
              sensorType: '진동',
              value: 4.2,
              unit: 'mm/s',
              threshold: 6.0,
              status: '정상'
            }
          ]
        }
      },
      {
        name: 'detect_anomaly',
        description: '센서 데이터 기반으로 최근 발생한 이상 징후(임계치 초과·패턴 이상)를 탐지해 목록으로 반환한다. 정상 계측값 조회가 아닌 이상 이벤트 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: '특정 자산으로 범위 한정(선택)', examples: ['AST-BR-0421'] },
            sinceMin: { type: 'integer', minimum: 1, description: '최근 N분 이내 이벤트', default: 60 }
          },
          required: []
        },
        outputSchema: {
          type: 'object',
          properties: {
            anomalies: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  anomalyId: { type: 'string' },
                  assetId: { type: 'string' },
                  component: { type: 'string' },
                  severity: { type: 'string' },
                  detectedAt: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        }
      },
      {
        name: 'get_remaining_useful_life',
        description: '센서 데이터 추세를 바탕으로 부품의 잔존수명(RUL)을 예측한다. 현재 상태 조회가 아닌 미래 고장 시점 예측에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: '자산 ID', examples: ['AST-BR-0421'] },
            component: { type: 'string', description: '부품/구성요소명', examples: ['교량 받침'] }
          },
          required: ['assetId', 'component']
        },
        outputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string' },
            component: { type: 'string' },
            remainingDays: { type: 'integer' },
            confidence: { type: 'number', description: '예측 신뢰도(%)' }
          }
        }
      },
      {
        name: 'subscribe_sensor_alert',
        description: '특정 자산의 센서 이상 발생 시 알림을 받도록 구독을 등록한다. 조회가 아닌 알림 구독 등록(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: '알림 대상 자산 ID', examples: ['AST-BR-0421'] },
            channel: { type: 'string', enum: ['SMS', '앱푸시', '이메일'], default: '앱푸시', description: '알림 채널' },
            thresholdLevel: { type: 'string', enum: ['주의', '경계', '위험'], default: '주의', description: '알림 발생 최소 등급' }
          },
          required: ['assetId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'string' },
            assetId: { type: 'string' },
            channel: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  }
];
