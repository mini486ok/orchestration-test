// ==============================================================================
// 요금·정산 분야 신규 MCP 서버 7개
// 기존 3개(fare-calculator, transit-settlement, payment-gateway)와 상호보완.
// 금지 규칙 준수: Date.now()/Math.random() 미사용, createdAt은 리터럴 문자열.
// ==============================================================================

export const MCPS_FARE = [
  // --------------------------------------------------------------------------
  // 1. 요금 정책 관리
  // --------------------------------------------------------------------------
  {
    id: 'fare-policy-manager',
    name: 'Fare Policy Manager',
    nameKo: '요금 정책 관리',
    icon: '🏷️',
    category: '요금·정산',
    description: '지역·노선별 요금 정책(기본운임·거리비례율)을 조회·등록하고 정책 개정이 요금에 미치는 영향을 시뮬레이션한다.',
    version: '1.0.0',
    tags: ['요금정책', '정책개정', 'policy', '시뮬레이션'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_fare_policy',
        description: '지역·노선에 적용 중인 요금 정책(기본운임·거리비례율·개정번호)을 조회한다. 개별 승차권 요금 계산이 아닌 정책 원칙 조회에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '적용 지역/노선', examples: ['수도권'] },
            effectiveDate: { type: 'string', format: 'date', description: '기준일(YYYY-MM-DD)', examples: ['2026-07-05'] }
          },
          required: ['region']
        },
        outputSchema: {
          type: 'object',
          properties: {
            policyId: { type: 'string' },
            region: { type: 'string' },
            baseFareKrw: { type: 'number', description: '기본 운임(원)' },
            perKmRate: { type: 'number', description: 'km당 추가 요율(원)' },
            effectiveFrom: { type: 'string', format: 'date' },
            revisionNo: { type: 'integer' }
          }
        },
        mock: {
          latencyMs: [110, 380],
          samples: [
            {
              policyId: 'POL-SUDOKWON-07',
              region: '수도권',
              baseFareKrw: 1400,
              perKmRate: 100,
              effectiveFrom: '2026-06-01',
              revisionNo: 7
            }
          ]
        }
      },
      {
        name: 'register_fare_policy',
        description: '신규 요금 정책 개정안을 등록해 시행일부터 적용되도록 한다. 조회가 아닌 정책 신설·개정(쓰기) 작업에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '적용 지역/노선', examples: ['수도권'] },
            baseFareKrw: { type: 'number', description: '신규 기본 운임(원)', examples: [1500] },
            perKmRate: { type: 'number', description: 'km당 추가 요율(원)' },
            effectiveFrom: { type: 'string', format: 'date', description: '시행일(YYYY-MM-DD)' }
          },
          required: ['region', 'baseFareKrw', 'effectiveFrom']
        },
        outputSchema: {
          type: 'object',
          properties: {
            policyId: { type: 'string' },
            status: { type: 'string' },
            effectiveFrom: { type: 'string', format: 'date' }
          }
        }
      },
      {
        name: 'simulate_policy_impact',
        description: '특정 정책을 기준으로 구간 거리에 따른 현재 요금 대비 변경 요금과 증감액을 시뮬레이션한다. 정책 등록이 아닌 영향 분석에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            policyId: { type: 'string', description: '시뮬레이션 대상 정책 ID', examples: ['POL-SUDOKWON-07'] },
            distanceKm: { type: 'number', minimum: 0, description: '이용 거리(km)', examples: [15] }
          },
          required: ['policyId', 'distanceKm']
        },
        outputSchema: {
          type: 'object',
          properties: {
            policyId: { type: 'string' },
            currentFare: { type: 'number' },
            projectedFare: { type: 'number' },
            deltaKrw: { type: 'number' },
            deltaRate: { type: 'number', description: '변동률(%)' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 2. 할인·보조금 계산
  // --------------------------------------------------------------------------
  {
    id: 'discount-subsidy-calculator',
    name: 'Discount & Subsidy Calculator',
    nameKo: '할인·보조금 계산',
    icon: '🎟️',
    category: '요금·정산',
    description: '이용자 속성 기반 할인 대상 여부와 지자체·국가 보조금을 산정하고, 여러 할인·보조금이 중복될 때 최종 감면액을 계산한다.',
    version: '1.0.0',
    tags: ['할인', '보조금', 'subsidy', '중복할인'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'calculate_discount_eligibility',
        description: '연령·자격 구분에 따라 할인 대상 여부와 할인율·할인코드를 판정한다. 실제 감면액 계산이 아닌 대상자 자격 판정에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            age: { type: 'integer', minimum: 0, description: '이용자 나이', examples: [67] },
            category: { type: 'string', enum: ['일반', '청소년', '어린이', '경로', '장애인', '국가유공자'], description: '이용자 구분' },
            specialStatus: { type: 'string', description: '추가 자격(선택, 예: 중증장애)' }
          },
          required: ['category']
        },
        outputSchema: {
          type: 'object',
          properties: {
            eligible: { type: 'boolean' },
            discountRate: { type: 'number', description: '할인율(%)' },
            discountCode: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [90, 260],
          samples: [
            { eligible: true, discountRate: 100, discountCode: 'DC-SENIOR-FREE' }
          ]
        }
      },
      {
        name: 'calculate_subsidy',
        description: '지자체·국가 대중교통 보조금(청소년 요금지원, 어르신 무임 등)을 이용자 구분과 지역 기준으로 산정한다. 요금 할인이 아닌 재정 보조금 산출에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            region: { type: 'string', description: '지원 지자체/지역', examples: ['서울특별시'] },
            category: { type: 'string', enum: ['일반', '청소년', '어린이', '경로', '장애인', '국가유공자'], description: '이용자 구분' },
            monthlyRides: { type: 'integer', minimum: 0, description: '월 이용 횟수(선택)', examples: [40] }
          },
          required: ['region', 'category']
        },
        outputSchema: {
          type: 'object',
          properties: {
            subsidyAmount: { type: 'number' },
            subsidyRate: { type: 'number', description: '보조 비율(%)' },
            budgetCode: { type: 'string', description: '예산 배정 코드' }
          }
        }
      },
      {
        name: 'apply_combined_discount',
        description: '할인코드와 보조금을 동시에 적용해 중복 할인 규칙에 따른 최종 감면액과 결제 요금을 산출한다. 단일 할인 적용(fare-calculator.apply_discount)이 아닌 다중 감면 중복계산에 특화.',
        inputSchema: {
          type: 'object',
          properties: {
            baseFare: { type: 'number', description: '기본 운임(원)', examples: [1400] },
            discountCode: { type: 'string', description: '적용할 할인 코드', examples: ['DC-SENIOR-FREE'] },
            subsidyAmount: { type: 'number', description: '적용할 보조금액(선택)', examples: [500] }
          },
          required: ['baseFare', 'discountCode']
        },
        outputSchema: {
          type: 'object',
          properties: {
            baseFare: { type: 'number' },
            totalReduction: { type: 'number' },
            finalFare: { type: 'number' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 3. 기관간 정산(clearing)
  // --------------------------------------------------------------------------
  {
    id: 'interagency-clearing',
    name: 'Interagency Clearing House',
    nameKo: '기관간 정산',
    icon: '🏦',
    category: '요금·정산',
    description: '복수 운송기관 간 정산 배치를 생성·확정하는 클리어링 하우스 기능을 제공하며, 이의제기 접수도 처리한다. 환승 수입배분(transit-settlement)과 달리 배치 단위 상호정산·이체 확정에 특화.',
    version: '1.0.0',
    tags: ['클리어링', '기관정산', 'clearing', '이체'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'create_clearing_batch',
        description: '지정일 기준 참여 기관들의 정산 배치를 생성한다. 배치 조회·확정이 아닌 신규 배치 생성(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            settlementDate: { type: 'string', format: 'date', description: '정산 대상일(YYYY-MM-DD)', examples: ['2026-07-04'] },
            operators: { type: 'array', description: '정산 참여 기관(선택, 미지정 시 전체)', items: { type: 'string' } }
          },
          required: ['settlementDate']
        },
        outputSchema: {
          type: 'object',
          properties: {
            batchId: { type: 'string' },
            settlementDate: { type: 'string', format: 'date' },
            operatorCount: { type: 'integer' },
            status: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [140, 420],
          samples: [
            { batchId: 'CLR-20260704-001', settlementDate: '2026-07-04', operatorCount: 4, status: '생성됨' }
          ]
        }
      },
      {
        name: 'get_clearing_balance',
        description: '정산 배치 내 기관별 순정산액(수취/지급 방향 포함)을 조회한다. 배치 생성이 아닌 기존 배치의 잔액 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            batchId: { type: 'string', description: '조회할 정산 배치 ID', examples: ['CLR-20260704-001'] }
          },
          required: ['batchId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            batchId: { type: 'string' },
            balances: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  operator: { type: 'string' },
                  netAmount: { type: 'number' },
                  direction: { type: 'string', enum: ['수취', '지급'] }
                }
              }
            }
          }
        }
      },
      {
        name: 'confirm_clearing',
        description: '정산 배치를 확정하고 기관별 최종 이체 지시를 발행한다. 잔액 조회가 아닌 배치 확정·이체 실행에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            batchId: { type: 'string', description: '확정할 정산 배치 ID', examples: ['CLR-20260704-001'] },
            approver: { type: 'string', description: '승인자', examples: ['정산팀장'] }
          },
          required: ['batchId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            batchId: { type: 'string' },
            status: { type: 'string' },
            confirmedAt: { type: 'string', format: 'date-time' },
            transferInstructions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  operator: { type: 'string' },
                  amount: { type: 'number' }
                }
              }
            }
          }
        }
      },
      {
        name: 'flag_dispute',
        description: '정산 배치 내 특정 기관 금액에 이의를 제기해 정산 보류 항목으로 등록한다. 확정 처리가 아닌 이의제기 접수(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            batchId: { type: 'string', description: '이의제기 대상 정산 배치 ID', examples: ['CLR-20260704-001'] },
            operator: { type: 'string', description: '이의제기 대상 기관', examples: ['서울교통공사'] },
            reason: { type: 'string', description: '이의제기 사유', examples: ['배분 거리 산정 오류'] }
          },
          required: ['batchId', 'operator', 'reason']
        },
        outputSchema: {
          type: 'object',
          properties: {
            disputeId: { type: 'string' },
            batchId: { type: 'string' },
            operator: { type: 'string' },
            status: { type: 'string' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 4. 환불 정산
  // --------------------------------------------------------------------------
  {
    id: 'refund-settlement',
    name: 'Refund Settlement',
    nameKo: '환불 정산',
    icon: '💸',
    category: '요금·정산',
    description: '승차권 취소 시 위약금 규정에 따라 환불액을 산정하고 실제 환불 처리를 실행하며, 환불 처리 상태를 조회한다. 결제 승인·대사(payment-gateway)와 달리 취소·환불 흐름에 특화.',
    version: '1.0.0',
    tags: ['환불', '취소', 'refund', '위약금'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'calculate_refund',
        description: '취소 사유·취소 시점에 따른 위약금율을 적용해 환불 예정액을 산정한다. 실제 환불 실행이 아닌 금액 산정에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            transactionId: { type: 'string', description: '취소할 결제 거래번호', examples: ['TXN-20260704-9931247'] },
            cancelReason: { type: 'string', enum: ['단순변심', '열차지연', '천재지변', '중복결제'], description: '취소 사유' },
            cancelAt: { type: 'string', format: 'date-time', description: '취소 요청 시각(선택)', examples: ['2026-07-04T10:00:00'] }
          },
          required: ['transactionId', 'cancelReason']
        },
        outputSchema: {
          type: 'object',
          properties: {
            transactionId: { type: 'string' },
            originalAmount: { type: 'number' },
            penaltyRate: { type: 'number', description: '위약금율(%)' },
            penaltyAmount: { type: 'number' },
            refundAmount: { type: 'number' }
          }
        },
        mock: {
          latencyMs: [120, 400],
          samples: [
            {
              transactionId: 'TXN-20260704-9931247',
              originalAmount: 59800,
              penaltyRate: 5,
              penaltyAmount: 2990,
              refundAmount: 56810
            }
          ]
        }
      },
      {
        name: 'process_refund_payout',
        description: '산정된 환불액을 실제로 환급 처리하고 환불번호를 발급한다. 금액 산정이 아닌 환급 실행(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            transactionId: { type: 'string', description: '환불 대상 거래번호', examples: ['TXN-20260704-9931247'] },
            refundAmount: { type: 'number', description: '환불할 금액(원)', examples: [56810] },
            refundMethod: { type: 'string', enum: ['원결제수단', '계좌이체'], default: '원결제수단', description: '환불 수단' }
          },
          required: ['transactionId', 'refundAmount']
        },
        outputSchema: {
          type: 'object',
          properties: {
            refundId: { type: 'string' },
            transactionId: { type: 'string' },
            refundAmount: { type: 'number' },
            status: { type: 'string' },
            processedAt: { type: 'string', format: 'date-time' }
          }
        }
      },
      {
        name: 'get_refund_status',
        description: '환불번호로 환불 처리 상태와 금액을 조회한다. 신규 환불 처리가 아닌 기존 환불 건 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            refundId: { type: 'string', description: '조회할 환불번호', examples: ['RFD-20260704-0021'] }
          },
          required: ['refundId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            refundId: { type: 'string' },
            status: { type: 'string' },
            refundAmount: { type: 'number' },
            processedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 5. 선불카드 잔액
  // --------------------------------------------------------------------------
  {
    id: 'prepaid-card-balance',
    name: 'Prepaid Card Balance',
    nameKo: '선불카드 잔액',
    icon: '🪙',
    category: '요금·정산',
    description: '교통 선불카드의 잔액을 조회하고 충전·요금 차감을 처리하며, 카드별 이용 내역을 제공한다.',
    version: '1.0.0',
    tags: ['선불카드', '충전', 'balance', '차감'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_card_balance',
        description: '교통 선불카드의 현재 잔액과 최근 사용 시각을 조회한다. 이용 내역 전체 조회가 아닌 현재 잔액 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: '조회할 카드 ID', examples: ['CARD-3021-9987'] }
          },
          required: ['cardId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string' },
            balance: { type: 'number' },
            lastUsedAt: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['정상', '정지', '분실신고'] }
          }
        },
        mock: {
          latencyMs: [80, 250],
          samples: [
            { cardId: 'CARD-3021-9987', balance: 12300, lastUsedAt: '2026-07-04T08:12:00', status: '정상' }
          ]
        }
      },
      {
        name: 'charge_card',
        description: '선불카드에 금액을 충전하고 충전번호와 신규 잔액을 반환한다. 잔액 조회가 아닌 충전(쓰기) 처리에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: '충전할 카드 ID', examples: ['CARD-3021-9987'] },
            amount: { type: 'number', minimum: 1, description: '충전 금액(원)', examples: [30000] },
            chargeMethod: { type: 'string', enum: ['현금', '계좌이체', '간편결제'], default: '현금', description: '충전 수단' }
          },
          required: ['cardId', 'amount']
        },
        outputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string' },
            chargedAmount: { type: 'number' },
            newBalance: { type: 'number' },
            chargeId: { type: 'string' }
          }
        }
      },
      {
        name: 'deduct_fare',
        description: '승차 시 카드 잔액에서 요금을 차감하고 잔여 잔액을 반환한다. 충전이 아닌 요금 차감(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: '차감할 카드 ID', examples: ['CARD-3021-9987'] },
            fareAmount: { type: 'number', minimum: 0, description: '차감할 요금(원)', examples: [1500] }
          },
          required: ['cardId', 'fareAmount']
        },
        outputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string' },
            deductedAmount: { type: 'number' },
            remainingBalance: { type: 'number' },
            transactionSeq: { type: 'string' }
          }
        }
      },
      {
        name: 'get_card_history',
        description: '지정 기간 동안 카드의 충전·차감 이용 내역을 조회한다. 현재 잔액 단건 조회가 아닌 기간별 이력 조회에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string', description: '조회할 카드 ID', examples: ['CARD-3021-9987'] },
            period: { type: 'string', description: '조회 기간(YYYY-MM)', examples: ['2026-06'] }
          },
          required: ['cardId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            cardId: { type: 'string' },
            period: { type: 'string' },
            records: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['충전', '차감'] },
                  amount: { type: 'number' },
                  occurredAt: { type: 'string', format: 'date-time' }
                }
              }
            }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 6. 청구서/영수증 (부가세 계산 포함)
  // --------------------------------------------------------------------------
  {
    id: 'invoice-receipt-manager',
    name: 'Invoice & Receipt Manager',
    nameKo: '청구서·영수증 관리',
    icon: '🧾',
    category: '요금·정산',
    description: '결제 건에 대한 영수증을 발행하고 공급가액 기준 부가가치세를 계산하며, 정기권·법인 이용자용 청구서를 생성·조회한다.',
    version: '1.0.0',
    tags: ['영수증', '청구서', 'invoice', '부가세'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'issue_receipt',
        description: '완료된 결제 거래에 대해 현금영수증·지출증빙 등 영수증을 발행한다. 청구서 생성이 아닌 개별 거래 영수증 발행(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            transactionId: { type: 'string', description: '영수증을 발행할 결제 거래번호', examples: ['TXN-20260704-9931247'] },
            issueType: { type: 'string', enum: ['현금영수증', '지출증빙', '간이영수증'], default: '간이영수증', description: '영수증 유형' }
          },
          required: ['transactionId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            receiptId: { type: 'string' },
            transactionId: { type: 'string' },
            issuedAt: { type: 'string', format: 'date-time' },
            downloadUrl: { type: 'string' }
          }
        },
        mock: {
          latencyMs: [100, 320],
          samples: [
            {
              receiptId: 'RCP-20260704-5521',
              transactionId: 'TXN-20260704-9931247',
              issuedAt: '2026-07-04T09:25:10',
              downloadUrl: '/receipts/RCP-20260704-5521.pdf'
            }
          ]
        }
      },
      {
        name: 'calculate_vat',
        description: '공급가액에 부가가치세율을 적용해 세액과 합계금액을 계산한다. 영수증 발행이 아닌 세액 산정 자체에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            supplyAmount: { type: 'number', minimum: 0, description: '공급가액(원)', examples: [54364] },
            vatRate: { type: 'number', minimum: 0, maximum: 100, default: 10, description: '부가가치세율(%)' }
          },
          required: ['supplyAmount']
        },
        outputSchema: {
          type: 'object',
          properties: {
            supplyAmount: { type: 'number' },
            vatAmount: { type: 'number' },
            totalAmount: { type: 'number' }
          }
        }
      },
      {
        name: 'generate_invoice',
        description: '정기권·법인 이용 등 여러 항목을 합산해 기간별 청구서(인보이스)를 생성한다. 단건 영수증 발행이 아닌 합산 청구서 생성(쓰기)에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            billingPeriod: { type: 'string', description: '청구 기간(YYYY-MM)', examples: ['2026-07'] },
            customerId: { type: 'string', description: '청구 대상 고객/법인 ID', examples: ['CORP-4471'] },
            items: {
              type: 'array',
              description: '청구 항목 목록',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  amount: { type: 'number' }
                }
              }
            }
          },
          required: ['billingPeriod', 'customerId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            invoiceId: { type: 'string' },
            customerId: { type: 'string' },
            billingPeriod: { type: 'string' },
            subtotal: { type: 'number' },
            vatAmount: { type: 'number' },
            totalAmount: { type: 'number' },
            dueDate: { type: 'string', format: 'date' }
          }
        }
      },
      {
        name: 'get_invoice_status',
        description: '청구서 ID로 결제 여부·미납액 등 청구서 상태를 조회한다. 신규 청구서 생성이 아닌 기존 청구서 상태 확인에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            invoiceId: { type: 'string', description: '조회할 청구서 ID', examples: ['INV-2026-07-4471'] }
          },
          required: ['invoiceId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            invoiceId: { type: 'string' },
            status: { type: 'string', enum: ['미납', '완납', '연체'] },
            paidAmount: { type: 'number' },
            balanceDue: { type: 'number' }
          }
        }
      }
    ]
  },

  // --------------------------------------------------------------------------
  // 7. 동적 요금
  // --------------------------------------------------------------------------
  {
    id: 'dynamic-pricing-engine',
    name: 'Dynamic Pricing Engine',
    nameKo: '동적 요금',
    icon: '📈',
    category: '요금·정산',
    description: '시간대·혼잡도·수요 수준에 따른 동적 요금 배율을 산출하고 기본 운임에 적용하며, 향후 요금 변동을 예측한다.',
    version: '1.0.0',
    tags: ['동적요금', '혼잡도', 'dynamic-pricing', '수요예측'],
    author: 'sample',
    isSample: true,
    createdAt: '2026-07-05T00:00:00Z',
    tools: [
      {
        name: 'get_dynamic_multiplier',
        description: '노선의 시간대·수요 수준에 따른 동적 요금 배율을 조회한다. 최종 요금 계산이 아닌 배율 자체 조회에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            routeId: { type: 'string', description: '대상 노선/구간 ID', examples: ['GTX-A-01'] },
            datetime: { type: 'string', format: 'date-time', description: '기준 시각(선택)', examples: ['2026-07-04T08:30:00'] },
            demandLevel: { type: 'string', enum: ['낮음', '보통', '높음', '피크'], description: '수요 수준(선택, 미지정 시 자동 산정)' }
          },
          required: ['routeId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            routeId: { type: 'string' },
            multiplier: { type: 'number', description: '배율(예: 1.2)' },
            basis: { type: 'string', description: '산정 근거 요약' }
          }
        },
        mock: {
          latencyMs: [100, 300],
          samples: [
            { routeId: 'GTX-A-01', multiplier: 1.2, basis: '출근 피크시간대 혼잡도 높음' }
          ]
        }
      },
      {
        name: 'calculate_dynamic_fare',
        description: '기본 운임에 동적 배율을 곱해 최종 동적 요금을 산정한다. 배율 조회가 아닌 실제 요금 계산에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            baseFare: { type: 'number', minimum: 0, description: '기본 운임(원)', examples: [1400] },
            multiplier: { type: 'number', minimum: 0, description: '적용할 동적 배율', examples: [1.2] }
          },
          required: ['baseFare', 'multiplier']
        },
        outputSchema: {
          type: 'object',
          properties: {
            baseFare: { type: 'number' },
            multiplier: { type: 'number' },
            dynamicFare: { type: 'number' }
          }
        }
      },
      {
        name: 'forecast_price_window',
        description: '향후 지정 시간 동안의 시간대별 동적 요금 변동을 예측한다. 현재 배율 조회가 아닌 미래 구간 예측에 사용.',
        inputSchema: {
          type: 'object',
          properties: {
            routeId: { type: 'string', description: '예측 대상 노선/구간 ID', examples: ['GTX-A-01'] },
            hoursAhead: { type: 'integer', minimum: 1, maximum: 24, default: 6, description: '예측할 시간 범위(시간)' }
          },
          required: ['routeId']
        },
        outputSchema: {
          type: 'object',
          properties: {
            routeId: { type: 'string' },
            forecast: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  hour: { type: 'string', format: 'date-time' },
                  expectedMultiplier: { type: 'number' },
                  expectedFare: { type: 'number' }
                }
              }
            }
          }
        }
      }
    ]
  }
];
