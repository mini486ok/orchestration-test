# DB 전략·실시간 테스트 — 1회차 검증 반영 요약 (2회차 검증 대상)

1회차 6검증(Codex 2 + Claude 4)에서 채택한 이슈를 반영한 결과. 배포 차단급은 없었고 아래는 품질 향상.

## 엔진 (catalogGraph.js / orchestrator.js / samples.js)
- io 엣지 raw를 min(1,…)로 클램프(가중치 폭주 방지).
- **io/llm 엣지가 중첩 출력 키를 재귀 포착**(배열 items.properties·객체 properties 1단계): 실제 워크플로우 체인(search_trains 출력 trains[].trainNo → check_seat_availability 입력 trainNo)을 잡음. io out-degree 0→9.
- semantic 후보를 낮은 고정 하한(0.30)으로 저장 → 런타임 threshold 조절이 재구축 없이 반영.
- graphRetrieve 예외 시 전체 카탈로그가 아니라 vector→keyword 축소 폴백.
- llm 엣지 전부 추출 실패 시 stats.llmFailed + trace 명시.
- graphRetrieve 확산에 허브 degree 보정(이웃 기여 1/√deg).
- buildGraph 무거운 루프에 await 양보(프리즈·진행바 개선).
- graphStatus(mcps,benchmarks,embed,extract,{wantSemantic,wantLlm}) → needsRebuild/rebuildReasons/llmFailed 반환.
- recommendPaths pathEdges 옵션(['io'] 기본, ['io','llm'] 허용). 미사용 index 파라미터 정리.
- 샘플 그래프 DB 전략 cooccur.on=false.

## UI (orchestration.js / main.css)
- 검색 미리보기의 "null" 텍스트 노출 제거(replaceChildren에 filter(Boolean)).
- **그래프 시각화 과밀 해소**: 요약(기본)/전체 토글, semantic 기본 숨김+토글, 노드당 상위 3엣지 캡, 노드 상한(요약60/전체130), 반발력·간선길이 조정.
- 엣지색을 카테고리 노드색과 분리(중립색+대시 패턴), 범례 스와치.
- 포커스(노드 클릭) 시 흐린 엣지의 화살표 마커 제거.
- 줌·팬(드래그/휠) + "크게 보기" 확대 모달.
- 숫자 입력 clamp 후 input.value 동기화.
- **그래프 구축 abort를 뷰 cleanup에 연결**(라우트 이탈 시 LLM 추출·임베딩 중단), redrawTimer 정리, vector buildIndex에 signal.
- 재구축 필요(semantic/llm 신규 on·모델 변경) amber 표시, 후보/활성 엣지 구분 캡션, 안내 문구 수정.
- cooccur 기본 off + 카드에 정보 누출 경고.
- 모델 드롭다운에 임베딩 모델 표시(embedModel=전체, extractModel=채팅).

## 리드 직접
- ollama.listModels({embedding}) 옵션(임베딩 필터 수정) + isEmbedding.
- store.reset에 catalogIndex/catalogGraph 포함.
- evaluation.js: db 전략을 LLM 사용 전략으로 분류, TYPE_LABEL/KIND에 db.
- guide.js: DB-F1 결합·cooccur 누출·semantic/llm 재구축 주의 추가.
- playground.js: 결과 그리드 적응형 열.

## 2회차 검증 포커스
- io 중첩키 반영으로 그래프 지문이 바뀌어 기존 그래프는 1회 stale(정상). 재구축 후 io 체인·경로추천 확인.
- 시각화 개선 후 실제 판독성·상호작용(줌/팬/모달).
- abort cleanup 실효(라우트 이탈 시 LLM 추출 정지).
- 회귀: prompt/skill/rule, vector RAG, 평가·실시간 테스트.
