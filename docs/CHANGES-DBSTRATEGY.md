# 증분 변경 요약 — DB 전략 + 실시간 테스트 (검증 대상)

이 문서는 방금 추가된 기능의 검증 범위를 요약한다. 계약은 docs/SPEC-GRAPH.md.

## 신규 기능
1. **DB 전략** — 오케스트레이션 4번째 전략 타입(prompt/skill/rule + **db**).
   - `config.store: 'vector' | 'graph'`. vector는 임베딩 인덱스(catalogIndex), graph는 도구 관계 그래프(catalogGraph).
   - 검색된 관련 도구만 축소 카탈로그로 플래너(plan/react)에 공급. `orchestrator.runDb`.
2. **graph db 엔진** — `services/catalogGraph.js` (신규).
   - 엣지 6종: io(입출력 스키마, 방향), semantic(임베딩 kNN), server, category, cooccur(벤치마크 공출현), **llm**(LLM이 도구별 requires/produces 개념 추출 → A.produces∩B.requires 방향 엣지).
   - buildGraph(후보 전량 저장·1회), effectiveAdjacency(런타임 파라미터 조합), graphRetrieve(시드→hop 가중확산→topK), recommendPaths(io 경로 빔서치).
   - 파라미터: 엣지별 on/weight/threshold, seedMethod/seedK/hops/decay/topK, embedModel/extractModel(둘 다 선택 가능·null이면 기본값).
   - llm 엣지는 무거워 기본 off. graphFingerprint에 embedModel·extractModel 반영(stale).
3. **DB 전략 UI** — orchestration.js dbEditor(vector/graph 편집기), 엣지 6종 카드(on/가중치/임계값), 모델 드롭다운(listModels), 그래프 상태 카드+구축 버튼, **SVG 그래프 시각화**(파라미터 변경 시 즉시 재그림), 검색 미리보기, 워크플로우 경로 추천.
4. **실시간 테스트** — `views/playground.js` (신규) + app.js 라우트(#/playground, ⚡). 전략 다중 선택 → 질의 → 병렬 실행 → 전략별 답변·워크플로우·트레이스 비교, 대화 히스토리, JSON 내보내기.
5. 샘플 전략 5·6: "벡터 DB 플래너"(db/vector), "그래프 DB 플래너"(db/graph).
6. 가이드에 "DB 전략", "실시간 테스트" 섹션 추가.

## 변경/신규 파일
- 신규: services/catalogGraph.js, views/playground.js, docs/SPEC-GRAPH.md
- 수정: services/orchestrator.js(runDb·applyGraphRetrieval·applyCatalogRetrieval 일반화), views/orchestration.js(db 타입 전체), data/samples.js(전략5·6), app.js(playground 라우트), views/guide.js, assets/css/main.css(append)

## 검증 포인트(회귀 금지)
- 기존 prompt/skill/rule 전략, 기존 vector RAG(catalogMode) 하위호환, 평가·벤치마크·MCP·서버모드 무손상.
- DB 전략이 그래프/인덱스 없을 때 폴백(graph→vector→keyword). 임베딩·그래프 LLM 추출은 전략 llmCalls에 미집계.
- 실시간 테스트 병렬 실행·중단·히스토리. Ollama 미연결 시 rule은 동작·LLM 전략은 카드 오류.
