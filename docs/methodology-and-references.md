# 선호 학습·추천 파이프라인: 구현·수식·문헌 대응

이 문서는 **현재 코드베이스(`lib/` 등)에 실제로 구현된 내용**을 기준으로 하며, 각 부분이 **어떤 이론·논문 전통과 맞닿아 있는지**를 수식과 함께 정리합니다.  
저장소 안에는 “○○ 논문 ○페이지 인용” 형태의 주석이 거의 없으므로, **코드가 따르는 수학 구조**를 먼저 밝히고, 그 구조의 **표준 레퍼런스**를 제시합니다.

---

## 1. 전체 구조

| 단계 | 주요 파일 | 역할 |
|------|-----------|------|
| 특징 추출·정규화 | `lib/feature-engineer.ts` | 매물 → 15차원 특징 벡터 \(\phi\) |
| 통학(통계용) | `lib/transit-calculator.ts`, `computeStatsWithCommute` | DB 도보·(선택) ODsay로 `CommuteFeatures` |
| 선호 모델 | `lib/reward-model.ts` | 쌍대 비교로 가중치 \(w\) 사후 추정 |
| 다음 질문(쌍) 선택 | `lib/query-selector.ts` | “정보가 많이 남은” 쌍 고르기 |
| 수렴 판단 | `lib/convergence.ts` | 조기 종료·점수 |
| UI 흐름 | `app/compare/page.tsx` | 비교 한 라운드마다 `updateModel` 등 호출 |

---

## 2. 특징 벡터 \(\phi\) (`feature-engineer.ts`)

### 2.1 차원

- `FEATURE_DIM = 15`
- `FEATURE_NAMES` 순서와 인덱스가 `PRIOR_MEAN` / MCMC 차원과 일치합니다.

### 2.2 수치 특성의 min–max 정규화

연속 변수(월세, 보증금, 관리비, 전용면적, 방 개수, 소음 등)에 대해, 후보 매물 집합에서 구한 통계 \((\min, \max)\)로 다음을 사용합니다.

\[
\text{normalize}(x) = \frac{x - \min}{\max - \min}
\]

구현: `normalize()` (`feature-engineer.ts`).

경계: `max === min`이면 `0`을 반환합니다.

**문헌 대응:** 특성 스케일 맞추기는 회귀·선호 학습 전반의 관행이며, 특정 한 논문의 “○절만” 인용하는 형태는 아닙니다.

### 2.3 통학(도보) 특성 \(f_{\text{walk}}\)

`commuteWalkMin` 범위 \([m_{\min}, m_{\max}]\)와 도보 시간 `walkMin`에 대해:

- `walkMin`이 없거나 비정상 → **0.5** (중립)
- `walkMin ≤ m_{\min}` → **1**
- `walkMin ≥ m_{\max}` → **0**
- 그 사이는 선형:

\[
f_{\text{walk}} = \frac{m_{\max} - \text{walkMin}}{m_{\max} - m_{\min}}
\]

구현: `commuteWalkFeatureValue()`.

### 2.4 버스 통학 총시간(연속·결측)

DB 필드 합 \(T_{\text{bus}} = \texttt{bus\_to\_gate\_min} + \texttt{bus\_from\_gate\_min}\) (분). 둘 다 없으면 **null** → φ **0.5**.

도보와 동일하게 후보 집합에서 \((m_{\min}, m_{\max})\)로 min–max 정규화하여 **짧을수록 φ가 큼**.

구현: `commuteBusTotalFeatureValue()` (`lib/feature-engineer.ts`), `busTotalMinutesFromDb()` (`lib/commute-db.ts`).

### 2.5 년식·옵션

- `yearScore`: `within_4y` … 구간에 따라 `{1, 0.75, 0.5, 0.25, 0}` (`yearScore()`).
- `optionsScore`: 옵션 3개 중 만족 개수 / 3 (`optionsScore()`).

### 2.6 방향(남/북 원-핫)

`directionSouthNorthOneHot` (`lib/direction.ts`)로 남향·북향 가중을 씁니다. 특징 벡터의 해당 차원에 들어갑니다.

---

## 3. 선호 모델: 로지스틱 쌍대 비교 + 단위 구 제약 (`reward-model.ts`)

### 3.1 쌍대 비교의 표준 형태 (Bradley–Terry 계열)

한 라운드에서 사용자이 **A를 B보다 선호**하면, 코드는 차이 벡터를

\[
\phi = \phi^{(A)} - \phi^{(B)}
\]

로 두고, **선호 방향이 \(\phi\)와 \(w\)의 내적과 같은 쪽**이 되도록 `preferred = 1`로 저장합니다 (`updateModel`).

**문헌 대응 (이 구조의 고전):**

- **Bradley, R. A., & Terry, M. E. (1952).** “Rank analysis of incomplete block designs: I. The method of paired comparisons.” *Biometrika*, 39(3/4), 324–345.  
  - 짝 비교로 항목의 “강도”를 추정하는 모형의 원형.
- 선형 특징이 있는 경우의 로지스틱 형태는 **“선형 보상 \(w^\top \phi\) + 로지스틱 링크”**로 서술되는 것이 일반적입니다(다항 로짓/Bradley–Terry의 특징 확장으로 자주 쓰임).

### 3.2 로그 사후(log-posterior)의 우도 항

비교 데이터 \(\{(\phi_k, y_k)\}\)에 대해 \(y_k \in \{+1,-1\}\) (코드에서는 승자 방향에 맞춘 부호)이고,

\[
\mathbb{P}(\text{현재 부호가 관측}) = \sigma(y_k \cdot w^\top \phi_k), \quad \sigma(z) = \frac{1}{1+e^{-z}}
\]

이면 로그 우도는

\[
\sum_k \log\bigl(\sigma(y_k \, w^\top \phi_k) + \varepsilon\bigr)
\]

구현: `logPosterior()`에서 `sigmoid(s)`에 `1e-10`을 더해 수치 안정화.

**문헌 대응:** 위는 **이항 로지스틱 회귀의 로그 우도**와 동일한 형태입니다. 쌍대 선호 추정 문헌에서도 동일한 로짓 링크를 사용합니다.

### 3.3 사전(가우시안형) MAP 페널티

코드 주석: `MAP: log N(w|μ₀) ∝ -(λ/2)||w-μ₀||²`에 해당하는 항으로,

\[
-\frac{\lambda(n_c)}{2} \|w - \mu_0\|^2
\]

를 더합니다. 여기서 \(n_c\)는 비교 횟수이고,

\[
\lambda(n_c) = \frac{\lambda_{\text{base}}}{1 + \sqrt{n_c}}, \quad \lambda_{\text{base}} = 14
\]

구현: `priorScale = PRIOR_LAMBDA_BASE / (1 + Math.sqrt(nComp))`.

**의미:** 비교가 많아질수록 데이터 우도 비중을 늘리고, 초기에는 사전(초기 슬라이더·`PRIOR_MEAN`)을 더 믿게 합니다.  
**문헌 대응:** 가우시안 사전을 둔 로지스틱/Bayesian MAP의 일반 형태; **프로젝트에서 임의로 고른 하이퍼파라미터**입니다.

### 3.4 제약: \(\|w\| \le 1\) (단위 구)

`logPosterior`에서 \(\|w\| > 1\)이면 \(-\infty\)로 두어 **단위 구 안에서만** 샘플링합니다.  
정규화는 `normalizeToUnitBall()` (노름 1 초과 시 스케일로 투영).

**문헌 대응:** “가중치 벡터를 단위 구에 두고 선호를 학습한다”는 **식별성·스케일 고정** 목적의 설계이며, 특정 논문 한 절을 그대로 옮긴 것은 아닙니다.

### 3.5 MCMC: Metropolis–Hastings 스타일의 Metropolis 단계

구현: `mcmcSample()`.

- 제안: \(w' = w + \sigma \varepsilon\), \(\varepsilon \sim \mathcal{N}(0,I)\) (Box–Muller `randn`).
- 투영: 단위 구로 `normalizeToUnitBall`.
- 수락 확률: \(\alpha = \min(1, \exp(\log p(w') - \log p(w)))\).

**문헌 대응:**

- **Metropolis, N., Rosenbluth, A. W., Rosenbluth, M. N., Teller, A. H., & Teller, E. (1953).** “Equation of state calculations by fast computing machines.” *J. Chem. Phys.*
- **Hastings, W. K. (1970).** “Monte Carlo sampling methods using Markov chains and their applications.” *Biometrika* 57(1), 97–109.

(대칭 제안이면 Metropolis 비율과 동일.)

- 적응적 \(\sigma\): 수락률에 따라 `PROPOSAL_SIGMA`를 조정 — **Robbins–Monro 스타일의 휴리스틱**이 아니라 **고정 규칙**(수락률 0.15 미만이면 축소 등)입니다.

### 3.6 사후 요약

- `getMeanWeight`: 샘플 평균 \(\bar w\).
- `scoreProperty(model, \phi) = \bar w^\top \phi`.
- `predict`: \(\sigma(\bar w^\top \phi_A - \bar w^\top \phi_B)\).

### 3.7 Thompson 스타일 점수 (랜덤 \(w\))

`scorePropertyThompson`: 샘플 인덱스를 하나 고른 뒤 \(w^{(s)\top} \phi\) — **Thompson sampling**의 “사후에서 한 번 그은 \(w\)” 아이디어와 같습니다.

**문헌 대응:**

- **Thompson, W. R. (1933).** “On the likelihood that one unknown probability exceeds another in view of the evidence of two samples.” *Biometrika* 25(3–4), 285–294.

(현재 코드에서 이 함수가 UI의 주 경로인지는 호출부를 보면 됨 — `query-selector`는 주로 `computeExpectedVolumeRemoval`과 평균 가중치를 사용.)

---

## 4. 다음 쌍 선택: 기대 “체적 제거” (`query-selector.ts`)

### 4.1 정의 (코드와 동일하게)

후보 쌍 \((A,B)\), \(\phi = \phi^{(A)} - \phi^{(B)}\). 사후 샘플 \(\{w^{(s)}\}_{s=1}^S\)에 대해

\[
\begin{aligned}
E_+ &= \frac{1}{S}\sum_s \bigl(1 - \sigma(w^{(s)\top}\phi)\bigr), \\
E_- &= \frac{1}{S}\sum_s \bigl(1 - \sigma(-w^{(s)\top}\phi)\bigr), \\
\text{EVR} &= \min(E_+, E_-).
\end{aligned}
\]

구현: `computeExpectedVolumeRemoval()`.

**해석(직관):** \(w^\top\phi\)가 0 근처일수록 \(\sigma(\cdot)\approx 0.5\)라서 \(1-\sigma\)가 크고, **어느 쪽이 이길지 사후가 불확실한 쌍**에서 EVR이 커지도록 설계되어 있습니다. 반대로 한쪽으로 확고하면 EVR은 작아집니다.

**문헌 대응:**

- **정보 이론적 실험 설계·활성 학습**에서 “불확실성이 큰 구분”을 고르는 것과 같은 직관입니다. 다만 위 \(\min(E_+,E_-)\) 형태는 **이 저장소에만 있는 구체식**이며, 특정 논문의 “식 (N)”을 복사한 것은 **아닙니다**.
- 가장 가까운 일반 키워드: **pairwise active learning**, **Bayesian optimal experimental design** (Chaloner & Verdinelli, 1995 등) — 본 구현은 그 중에서도 **단순화된 휴리스틱**입니다.

### 4.2 제약

- `haversine` 거리 &lt; `MIN_DISTANCE_M`(50m)인 쌍은 제외.
- 이미 본 쌍(`usedPairs`) 제외.
- 후보가 많으면 무작위로 `MAX_CANDIDATES = 100`만 사용.

---

## 5. 수렴 (`convergence.ts`)

다음 **세 가지를 조합**한 휴리스틱입니다 (코드 상수: `TOP_K`, `STABILITY_WINDOW`, `VOLUME_THRESHOLD`, `CONCENTRATION_THRESHOLD`).

1. **상위 K 안정성:** 최근 `STABILITY_WINDOW`라운드에서 상위 K 매물 ID 나열이 동일하면 수렴.
2. **EVR 임계:** `getMaxExpectedVolumeRemoval` &lt; `VOLUME_THRESHOLD`이면 “추가 비교 가치 낮음”.
3. **사후 농도:** `posteriorConcentration` ≥ `CONCENTRATION_THRESHOLD`이면 수렴.

### 5.1 `posteriorConcentration`

각 샘플 \(w^{(s)}\)와 평균 \(\bar w\)의 **코사인 유사도** 평균:

\[
\frac{1}{S}\sum_s \frac{w^{(s)\top} \bar w}{\|w^{(s)}\|\|\bar w\|}
\]

구현: `cosineSimilarity` 평균 (`reward-model.ts`).

**문헌 대응:** MCMC 샘플이 한 점(평균) 주변으로 모였는지 보는 **경험적 산포 지표**입니다. 특정 논문 인용 형태는 코드에 없습니다.

### 5.2 `convergenceScore`

`concScore`, `evrScore`, `stabilityScore`의 가중 조합(코드의 `0.4`, `0.3`, `0.3` 등) — **UI용 점수**이며 논문에서 가져온 공식은 아닙니다.

---

## 6. API·지리 (요약)

- **ODsay** (`transit-calculator.ts`): 대중교통 경로 API — 수학적 “논문 인용”보다는 **외부 서비스 규약**에 따름.
- **Haversine** (`lib/geo.ts`): 구면 거리의 표준 근사.

---

## 7. 요약 표: “논문의 어디”를 가져왔는가?

| 구분 | 코드 위치 | 이론적 뿌리 (표준 문헌) | 이 레포에서의 상태 |
|------|-----------|-------------------------|---------------------|
| 쌍대 비교 + 로짓 | `reward-model.ts` 우도 | Bradley–Terry(1952), 로지스틱 링크 | 수식 구조는 동일 계열; 하이퍼는 자체 |
| 단위 구 제약 | `normalizeToUnitBall`, `logPosterior` | (식별·정규화 관행) | 자체 설계 |
| 가우시안형 사전 | `priorScale`, `PRIOR_MEAN` | Bayesian 로지스틱/MAP 일반론 | \(\lambda(n_c)\) 규칙은 자체 |
| MCMC | `mcmcSample` | Metropolis(1953), Hastings(1970) | 표준 MH; \(\sigma\) 적응은 휴리스틱 |
| Thompson | `scorePropertyThompson` | Thompson(1933) | 샘플 하나로 내적 — 전형적 아이디어 |
| EVR 쌍 선택 | `query-selector.ts` | 활성 학습·불확실성 샘플링 직관 | **식은 자체 정의** |
| 수렴 | `convergence.ts` | — | **임계값·가중은 자체** |
| 특징 정규화 | `feature-engineer.ts` | min–max, 결측 0.5 등 | **자체** |

---

## 8. 읽을 거리 (추가로 깊게 파고들 때)

1. Bradley–Terry paired comparison의 현대적 정리: 통계·기계학습 교재의 “paired comparison models” 절.  
2. Bayesian logistic regression + MCMC: Gelman 등의 계층 모델 서술과 맞닿음(코드는 단순화됨).  
3. Preference learning / learning to rank: Joachims, Burges 등의 랭킹 SVM·RankNet 계열은 **다른 손실**을 쓰는 경우가 많아 본 코드와 1:1 대응은 아님.

---

*문서 생성 기준: 저장소 내 `lib/reward-model.ts`, `lib/query-selector.ts`, `lib/convergence.ts`, `lib/feature-engineer.ts` 구현을 원문과 대조함.*
