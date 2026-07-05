// ============================================================================
// 물류·화물 (物流·貨物) — 신규 확장 MCP 서버 7개
// 기존 3개(freight-tracking, cargo-booking, rail-yard-manager)와 상호보완.
// ============================================================================

export const MCPS_FREIGHT = [
  {
    id: 'container-fleet-manager',
    name: 'Container Fleet Manager',
    nameKo: '컨테이너 자산 관리',
    icon: '🗄️',
    category: '물류·화물',
    description: '컨테이너 자산의 위치·상태·가용 재고를 관리하고 예약·재배치(공컨테이너 회송)를 지원한다.',
    version: '1.0.0',
    tags: ['컨테이너', '자산관리', 'container', '재고'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'search_available_containers',
        description: '지역·규격 기준 가용 컨테이너 재고를 검색한다. 운송 추적이 아닌 사용 가능한 컨테이너 자산 조회에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: '컨테이너 보관 위치(야드/터미널)', examples: ['의왕ICD'] },
            sizeType: { type: 'string', enum: ['20ft', '40ft', '40ft HC', '45ft'], description: '컨테이너 규격' },
            containerType: { type: 'string', enum: ['일반', '냉장', '탱크', '오픈탑'], description: '컨테이너 유형' }
          },
          required: ['location']
        },
        outputSchema: {
          type: 'object',
          properties: {
            containers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  containerId: { type: 'string' },
                  sizeType: { type: 'string' },
                  containerType: { type: 'string' },
                  location: { type: 'string' },
                  status: { type: 'string' }
                }
              }
            },
            count: { type: 'integer', description: '검색된 컨테이너 수' }
          }
        },
        mock: {
          latencyMs: [130, 480],
          samples: [
            {
              containers: [
                { containerId: 'CTR-40HC-8821', sizeType: '40ft HC', containerType: '일반', location: '의왕ICD', status: '가용' },
                { containerId: 'CTR-20GP-4410', sizeType: '20ft', containerType: '일반', location: '의왕ICD', status: '가용' }
              ],
              count: 2
            }
          ]
        }
      },
      {
        name: 'reserve_container',
        description: '검색된 특정 컨테이너를 화주용으로 임시 확보(예약)한다. 검색과 달리 실제 배정 확보(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: '컨테이너 번호', examples: ['CTR-40HC-8821'] },
            shipper: { type: 'string', description: '화주명', examples: ['한국물류(주)'] },
            holdHours: { type: 'number', minimum: 1, default: 24, description: '확보 유지 시간(시간)' }
          },
          required: ['containerId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            reservationId: { type: 'string' },
            containerId: { type: 'string' },
            status: { type: 'string' },
            holdUntil: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'get_container_condition',
        description: '컨테이너의 최근 점검 이력과 손상 여부를 조회한다. 재고 검색과 달리 개별 컨테이너의 상태 등급 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: '컨테이너 번호', examples: ['CTR-40HC-8821'] }
          },
          required: ['containerId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string' },
            conditionGrade: { type: 'string', description: 'A(양호)/B(경미손상)/C(수리필요)' },
            lastInspectedAt: { type: 'string', format: 'date-time' },
            damageNotes: { type: 'string' }
          }
        }
      },
      {
        name: 'reposition_empty_container',
        description: '재고 불균형 해소를 위해 공(空)컨테이너를 다른 위치로 재배치 이동시킨다. 예약과 달리 빈 컨테이너 회송 작업 등록에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: '컨테이너 번호', examples: ['CTR-20GP-4410'] },
            fromLocation: { type: 'string', description: '출발 위치', examples: ['의왕ICD'] },
            toLocation: { type: 'string', description: '도착 위치', examples: ['부산신항'] }
          },
          required: ['containerId', 'toLocation']
        },
        outputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            containerId: { type: 'string' },
            status: { type: 'string' },
            eta: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  {
    id: 'freight-car-allocator',
    name: 'Freight Car Allocator',
    nameKo: '화차 배정 관리',
    icon: '🚃',
    category: '물류·화물',
    description: '화물 종류와 물량에 맞는 화차(貨車)를 배정하고 배정 현황을 조회·해제한다. 조차장 내 선로 배정(rail-yard-manager)과 달리 운송 건별 화차 확보를 담당.',
    version: '1.0.0',
    tags: ['화차', '배정', 'wagon', '편성'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'request_car_allocation',
        description: '화물 종류·수량·구간에 맞는 화차를 배정 요청한다. 야드 선로 배정이 아닌 운송용 화차 확보(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            cargoType: { type: 'string', enum: ['컨테이너', '시멘트', '유류', '광석', '자갈', '일반', '위험물'], description: '화물 종류' },
            quantity: { type: 'integer', minimum: 1, description: '필요 화차 수', examples: [10] },
            from: { type: 'string', description: '발송 조차장/역', examples: ['오봉'] },
            to: { type: 'string', description: '도착 조차장/역', examples: ['부산신항'] },
            wagonType: { type: 'string', description: '요구 화차 형식(위험물 등 규정상 필요 시)', examples: ['탱크화차'] },
            lockId: { type: 'string', description: '사전 확정된 운임 잠금 ID(선택)', examples: ['RL-20260705-0042'] }
          },
          required: ['cargoType', 'quantity', 'from', 'to']
        },
        outputSchema: {
          type: 'object',
          properties: {
            allocationId: { type: 'string' },
            wagonType: { type: 'string' },
            assignedCars: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  carId: { type: 'string' },
                  wagonType: { type: 'string' }
                }
              }
            },
            trainNo: { type: 'string' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [160, 520],
          samples: [
            {
              allocationId: 'ALC-20260705-0077',
              wagonType: '컨테이너화차',
              assignedCars: [
                { carId: 'KR-90231', wagonType: '컨테이너화차' },
                { carId: 'KR-90244', wagonType: '컨테이너화차' }
              ],
              trainNo: 'F-3012',
              status: '배정완료'
            }
          ]
        }
      },
      {
        name: 'get_allocation_status',
        description: '화차 배정 건의 현재 상태와 배정된 화차 목록을 조회한다. 신규 배정 요청이 아닌 기존 배정 건 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            allocationId: { type: 'string', description: '배정 ID', examples: ['ALC-20260705-0077'] }
          },
          required: ['allocationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            allocationId: { type: 'string' },
            status: { type: 'string' },
            assignedCars: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  carId: { type: 'string' },
                  wagonType: { type: 'string' }
                }
              }
            },
            trainNo: { type: 'string' }
          }
        }
      },
      {
        name: 'release_car_allocation',
        description: '배정된 화차를 취소·반납 처리한다. 조회와 달리 배정 해제(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            allocationId: { type: 'string', description: '배정 ID', examples: ['ALC-20260705-0077'] },
            reason: { type: 'string', description: '해제 사유', examples: ['화주 취소'] }
          },
          required: ['allocationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            allocationId: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  {
    id: 'dangerous-goods-compliance',
    name: 'Dangerous Goods Compliance',
    nameKo: '위험물 운송 규정 관리',
    icon: '☣️',
    category: '물류·화물',
    description: '위험물의 UN번호·등급을 분류하고 철도 운송 적합성을 검사하며 운송 승인서(허가)를 발급한다.',
    version: '1.0.0',
    tags: ['위험물', '안전', 'hazmat', '규정'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'classify_dangerous_goods',
        description: '화물명·특성으로 UN번호와 위험물 등급을 분류한다. 운송 승인이 아닌 최초 위험물 식별·분류에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            cargoName: { type: 'string', description: '화물명', examples: ['황산'] },
            description: { type: 'string', description: '화물 특성 부가 설명', examples: ['부식성 액체'] }
          },
          required: ['cargoName']
        },
        outputSchema: {
          type: 'object',
          properties: {
            unNumber: { type: 'string' },
            hazardClass: { type: 'string', description: 'UN 위험물 등급(예: 8=부식성물질)' },
            packingGroup: { type: 'string', description: 'I/II/III' },
            properShippingName: { type: 'string' }
          }
        }
      },
      {
        name: 'check_transport_eligibility',
        description: 'UN번호 기준 철도 운송 가능 여부와 제한사항, 요구 화차 형식을 확인한다. 분류와 달리 실제 운송 가능성 검증에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            unNumber: { type: 'string', description: 'UN 위험물 번호', examples: ['UN1830'] },
            wagonType: { type: 'string', description: '희망 화차 형식(선택)', examples: ['탱크화차'] }
          },
          required: ['unNumber']
        },
        outputSchema: {
          type: 'object',
          properties: {
            unNumber: { type: 'string' },
            eligible: { type: 'boolean' },
            restrictions: { type: 'array', items: { type: 'string' } },
            wagonType: { type: 'string', description: '규정상 요구되는 화차 형식' }
          }
        }
      },
      {
        name: 'issue_transport_permit',
        description: 'UN번호와 화주·수량 정보로 위험물 운송 승인서를 발급한다. 조회성 검증과 달리 실제 승인 문서 발급(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            unNumber: { type: 'string', description: 'UN 위험물 번호', examples: ['UN1830'] },
            shipper: { type: 'string', description: '화주명', examples: ['한국물류(주)'] },
            quantityKg: { type: 'number', minimum: 0, description: '운송 수량(kg)', examples: [22000] }
          },
          required: ['unNumber', 'shipper', 'quantityKg']
        },
        outputSchema: {
          type: 'object',
          properties: {
            permitId: { type: 'string' },
            unNumber: { type: 'string' },
            status: { type: 'string' },
            validUntil: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [200, 600],
          samples: [
            {
              permitId: 'DGP-20260705-0013',
              unNumber: 'UN1830',
              status: '승인',
              validUntil: '2026-08-05T00:00:00'
            }
          ]
        }
      }
    ]
  },

  {
    id: 'freight-rate-engine',
    name: 'Freight Rate Engine',
    nameKo: '운임 견적 비교 엔진',
    icon: '💹',
    category: '물류·화물',
    description: '복수 운송사의 화물 운임을 비교 견적하고 계약 단가를 조회하며 견적 운임을 확정 잠금한다. 단건 화물 예약 견적(cargo-booking)과 달리 운임 비교·계약 단가 관리에 특화.',
    version: '1.0.0',
    tags: ['운임', '견적', 'tariff', '계약운임'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'compare_carrier_rates',
        description: '구간·화물종류·중량 기준 복수 운송사의 운임을 비교 견적한다. 단일 견적이 아닌 운송사 간 비교에 사용.',
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
            offers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  carrier: { type: 'string' },
                  rateId: { type: 'string' },
                  totalFare: { type: 'number' },
                  transitDays: { type: 'integer' }
                }
              }
            }
          }
        },
        mock: {
          latencyMs: [180, 560],
          samples: [
            {
              offers: [
                { carrier: '코레일로지스', rateId: 'RT-20260705-0011', totalFare: 438000, transitDays: 1 },
                { carrier: '한국복합물류', rateId: 'RT-20260705-0012', totalFare: 452000, transitDays: 1 }
              ]
            }
          ]
        }
      },
      {
        name: 'get_contract_tariff',
        description: '거래처의 계약 단가(장기계약 요율)를 조회한다. 실시간 비교 견적과 달리 사전 협의된 고정 단가 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: '거래처 ID', examples: ['CUST-5521'] },
            cargoType: { type: 'string', enum: ['컨테이너', '시멘트', '유류', '광석', '자갈', '일반'], description: '화물 종류' }
          },
          required: ['customerId', 'cargoType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            tariffId: { type: 'string' },
            ratePerTon: { type: 'number' },
            minCharge: { type: 'number' },
            validUntil: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'lock_rate',
        description: '비교 견적된 특정 운임을 화주 명의로 확정 잠금해 가격 변동을 방지한다. 비교 조회와 달리 운임 확정(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            rateId: { type: 'string', description: '견적 운임 ID', examples: ['RT-20260705-0011'] },
            shipper: { type: 'string', description: '화주명', examples: ['한국물류(주)'] }
          },
          required: ['rateId', 'shipper']
        },
        outputSchema: {
          type: 'object',
          properties: {
            lockId: { type: 'string' },
            rateId: { type: 'string' },
            totalFare: { type: 'number' },
            expiresAt: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  {
    id: 'intermodal-transfer-hub',
    name: 'Intermodal Transfer Hub',
    nameKo: '복합운송 환적 관리',
    icon: '🔀',
    category: '물류·화물',
    description: '철도·해상·도로 간 복합운송(intermodal) 환적 작업을 계획하고 환적 진행 상태를 추적·갱신한다.',
    version: '1.0.0',
    tags: ['복합운송', '환적', 'intermodal', 'transload'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'schedule_transload',
        description: '컨테이너의 운송수단 간(철도↔해상↔도로) 환적 작업을 터미널에 예약 계획한다. 상태 조회가 아닌 환적 일정 등록(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: '컨테이너 번호', examples: ['CTR-40HC-8821'] },
            fromMode: { type: 'string', enum: ['철도', '해상', '도로'], description: '환적 전 운송수단' },
            toMode: { type: 'string', enum: ['철도', '해상', '도로'], description: '환적 후 운송수단' },
            terminal: { type: 'string', description: '환적 터미널', examples: ['부산신항'] }
          },
          required: ['containerId', 'fromMode', 'toMode', 'terminal']
        },
        outputSchema: {
          type: 'object',
          properties: {
            transferId: { type: 'string' },
            containerId: { type: 'string' },
            terminal: { type: 'string' },
            scheduledAt: { type: 'string', format: 'date-time' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [150, 500],
          samples: [
            {
              transferId: 'ITM-20260705-0091',
              containerId: 'CTR-40HC-8821',
              terminal: '부산신항',
              scheduledAt: '2026-07-06T09:00:00',
              status: '예정'
            }
          ]
        }
      },
      {
        name: 'get_transfer_status',
        description: '환적 작업의 현재 진행 상태를 조회한다. 신규 계획이 아닌 기존 환적 건 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            transferId: { type: 'string', description: '환적 작업 ID', examples: ['ITM-20260705-0091'] }
          },
          required: ['transferId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            transferId: { type: 'string' },
            status: { type: 'string' },
            terminal: { type: 'string' },
            completedAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'update_transfer_status',
        description: '환적 작업의 진행 상태를 갱신한다(대기/진행중/완료/지연). 조회와 달리 상태 변경(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            transferId: { type: 'string', description: '환적 작업 ID', examples: ['ITM-20260705-0091'] },
            status: { type: 'string', enum: ['대기', '진행중', '완료', '지연'], description: '변경할 상태' }
          },
          required: ['transferId', 'status']
        },
        outputSchema: {
          type: 'object',
          properties: {
            transferId: { type: 'string' },
            status: { type: 'string' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  {
    id: 'terminal-slot-scheduler',
    name: 'Terminal Slot Scheduler',
    nameKo: '터미널 슬롯 예약 관리',
    icon: '🗓️',
    category: '물류·화물',
    description: '화물터미널의 하역·상차 작업 슬롯 가용시간을 조회하고 슬롯을 예약·변경한다.',
    version: '1.0.0',
    tags: ['터미널', '슬롯예약', 'scheduling', '하역'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_slot_availability',
        description: '터미널의 날짜별 하역·상차 작업 슬롯 가용 현황을 조회한다. 예약이 아닌 가용시간 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            terminal: { type: 'string', description: '터미널명', examples: ['부산신항'] },
            date: { type: 'string', format: 'date', description: '조회일(YYYY-MM-DD)' }
          },
          required: ['terminal', 'date']
        },
        outputSchema: {
          type: 'object',
          properties: {
            terminal: { type: 'string' },
            date: { type: 'string' },
            slots: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slotId: { type: 'string' },
                  startTime: { type: 'string' },
                  endTime: { type: 'string' },
                  available: { type: 'boolean' }
                }
              }
            }
          }
        }
      },
      {
        name: 'book_terminal_slot',
        description: '가용 슬롯을 지정해 터미널 작업 슬롯을 예약한다. 가용 조회와 달리 실제 예약 확정(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            terminal: { type: 'string', description: '터미널명', examples: ['부산신항'] },
            slotId: { type: 'string', description: '슬롯 ID', examples: ['SLT-0906-A'] },
            transferId: { type: 'string', description: '연계된 환적 작업 ID(선택)', examples: ['ITM-20260705-0091'] },
            purpose: { type: 'string', enum: ['하역', '상차'], default: '하역', description: '작업 목적' }
          },
          required: ['terminal', 'slotId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            bookingId: { type: 'string' },
            terminal: { type: 'string' },
            slotId: { type: 'string' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [140, 460],
          samples: [
            {
              bookingId: 'TSB-20260705-0044',
              terminal: '부산신항',
              slotId: 'SLT-0906-A',
              status: '예약완료'
            }
          ]
        }
      },
      {
        name: 'reschedule_slot',
        description: '이미 확정된 예약을 다른 슬롯으로 변경한다. 신규 예약과 달리 기존 예약 건의 일정 변경에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            bookingId: { type: 'string', description: '예약 ID', examples: ['TSB-20260705-0044'] },
            newSlotId: { type: 'string', description: '변경할 슬롯 ID', examples: ['SLT-1030-B'] }
          },
          required: ['bookingId', 'newSlotId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            bookingId: { type: 'string' },
            slotId: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  {
    id: 'customs-clearance-doc',
    name: 'Customs Clearance & Documentation',
    nameKo: '통관·운송서류 관리',
    icon: '🛃',
    category: '물류·화물',
    description: '화물의 통관 신고서를 제출하고 진행 상태를 조회하며, 송장·적하목록 등 운송 서류를 발급한다.',
    version: '1.0.0',
    tags: ['통관', '서류', 'customs', '수출입'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'submit_customs_declaration',
        description: '화물의 HS코드·신고가액 등으로 통관 신고서를 제출한다. 서류 발급과 달리 세관 신고 접수(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trackingNo: { type: 'string', description: '운송장/컨테이너 번호', examples: ['CN-KR-778102'] },
            hsCode: { type: 'string', description: 'HS 품목분류코드', examples: ['8471.30'] },
            cargoType: { type: 'string', description: '화물 종류', examples: ['전자부품'] },
            declaredValue: { type: 'number', minimum: 0, description: '신고 가액(원)', examples: [52000000] },
            permitId: { type: 'string', description: '위험물 운송 승인서 ID(해당 시)', examples: ['DGP-20260705-0013'] }
          },
          required: ['trackingNo', 'hsCode', 'cargoType', 'declaredValue']
        },
        outputSchema: {
          type: 'object',
          properties: {
            declarationId: { type: 'string' },
            trackingNo: { type: 'string' },
            status: { type: 'string' },
            submittedAt: { type: 'string', format: 'date-time' }
          }
        },
        mock: {
          latencyMs: [200, 620],
          samples: [
            {
              declarationId: 'CUS-20260705-0027',
              trackingNo: 'CN-KR-778102',
              status: '심사중',
              submittedAt: '2026-07-05T10:20:00'
            }
          ]
        }
      },
      {
        name: 'get_clearance_status',
        description: '제출된 통관 신고 건의 심사 진행 상태를 조회한다. 신규 제출이 아닌 기존 신고 건 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            declarationId: { type: 'string', description: '통관 신고 ID', examples: ['CUS-20260705-0027'] }
          },
          required: ['declarationId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            declarationId: { type: 'string' },
            status: { type: 'string', description: '심사중/보류/승인/반려' },
            customsOffice: { type: 'string' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'generate_shipping_documents',
        description: '운송에 필요한 송장·적하목록·원산지증명 등 서류를 생성 발급한다. 통관 신고와 달리 물류 서류 산출물 발급에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            trackingNo: { type: 'string', description: '운송장/컨테이너 번호', examples: ['CN-KR-778102'] },
            docType: { type: 'string', enum: ['송장', '적하목록', '원산지증명'], description: '발급할 서류 종류' }
          },
          required: ['trackingNo', 'docType']
        },
        outputSchema: {
          type: 'object',
          properties: {
            documentId: { type: 'string' },
            trackingNo: { type: 'string' },
            docType: { type: 'string' },
            issuedAt: { type: 'string', format: 'date-time' },
            downloadUrl: { type: 'string' }
          }
        }
      }
    ]
  }
];
