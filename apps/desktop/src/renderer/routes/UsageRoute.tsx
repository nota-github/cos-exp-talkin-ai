import { Link } from 'react-router-dom';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import { useDesktopQuery } from '../lib/ipc/query-hooks';
import {
  getUsageCumulativeBody,
  getUsageCategoryShareCopy,
  getUsageCumulativeCards,
  getUsageCumulativeLabel,
  getUsageComparisonCards,
  getUsageMetricCards,
  getUsagePricingBasisChips,
  getUsagePricingBasisLabel,
  getUsageProofLabel,
  getUsageSurfaceState,
  isUsageDashboardComparable,
  isUsageDashboardEmpty,
  previewAllTimeUsageDashboard,
  previewUsageDashboard,
  usageDashboardCopy,
} from './usage-surface';

function UsageLoadingState() {
  return (
    <section className="panel usage-state-card">
      <span className="panel-kicker">불러오는 중</span>
      <strong>{usageDashboardCopy.loadingTitle}</strong>
      <p>{usageDashboardCopy.loadingBody}</p>
    </section>
  );
}

function UsageErrorState({ message }: { message: string | null }) {
  return (
    <section className="panel usage-state-card usage-state-card-error">
      <span className="panel-kicker">불러오지 못함</span>
      <strong>{usageDashboardCopy.errorTitle}</strong>
      <p>{usageDashboardCopy.errorBody}</p>
      {message ? <span className="badge badge-muted">{message}</span> : null}
    </section>
  );
}

function UsageEmptyState() {
  return (
    <section className="panel usage-empty-state">
      <div className="usage-empty-copy">
        <span className="panel-kicker">아직 기록 없음</span>
        <h3>{usageDashboardCopy.emptyTitle}</h3>
        <p>{usageDashboardCopy.emptyBody}</p>
        <p>{usageDashboardCopy.emptyChecklist}</p>
      </div>

      <div className="usage-empty-actions">
        <Link
          to="/"
          className="primary-button usage-empty-cta"
        >
          {usageDashboardCopy.emptyCta}
        </Link>
        <span className="badge badge-muted">{usageDashboardCopy.sourceFootnote}</span>
      </div>
    </section>
  );
}

export function UsageRoute() {
  const desktopClient = getRendererDesktopClient();
  const queryCache = getDesktopQueryCache();
  const monthUsageDashboardDescriptor = createDesktopQueryDescriptor('getUsageDashboard', {
    range: 'month',
  });
  const allTimeUsageDashboardDescriptor = createDesktopQueryDescriptor('getUsageDashboard', {
    range: 'all_time',
  });
  const monthUsageDashboardQuery = useDesktopQuery(
    queryCache,
    monthUsageDashboardDescriptor,
    { enabled: desktopClient.available },
  );
  const allTimeUsageDashboardQuery = useDesktopQuery(
    queryCache,
    allTimeUsageDashboardDescriptor,
    { enabled: desktopClient.available },
  );
  const monthDashboard = desktopClient.available
    ? monthUsageDashboardQuery.data
    : previewUsageDashboard;
  const allTimeDashboard = desktopClient.available
    ? allTimeUsageDashboardQuery.data
    : previewAllTimeUsageDashboard;
  const metricCards = monthDashboard ? getUsageMetricCards(monthDashboard) : [];
  const cumulativeCards = allTimeDashboard ? getUsageCumulativeCards(allTimeDashboard) : [];
  const comparisonCards = monthDashboard ? getUsageComparisonCards(monthDashboard) : [];
  const monthComparable = monthDashboard ? isUsageDashboardComparable(monthDashboard) : false;
  const allTimeComparable = allTimeDashboard ? isUsageDashboardComparable(allTimeDashboard) : false;
  const monthPricingBasisChips = monthDashboard ? getUsagePricingBasisChips(monthDashboard) : [];
  const allTimePricingBasisChips = allTimeDashboard ? getUsagePricingBasisChips(allTimeDashboard) : [];
  const showMonthEmptyState = monthDashboard ? isUsageDashboardEmpty(monthDashboard) : false;
  const surfaceState = getUsageSurfaceState({
    desktopAvailable: desktopClient.available,
    monthStatus: monthUsageDashboardQuery.status,
    allTimeStatus: allTimeUsageDashboardQuery.status,
    hasMonthData: Boolean(monthUsageDashboardQuery.data),
    hasAllTimeData: Boolean(allTimeUsageDashboardQuery.data),
    allTimeEmpty: allTimeDashboard ? isUsageDashboardEmpty(allTimeDashboard) : false,
  });
  const showLoadingState = surfaceState === 'loading';
  const showErrorState = surfaceState === 'error';
  const showEmptyState = surfaceState === 'empty';
  const proofLabel = monthDashboard ? getUsageProofLabel(monthDashboard) : usageDashboardCopy.loadingTitle;
  const cumulativeLabel = allTimeDashboard
    ? getUsageCumulativeLabel(allTimeDashboard)
    : usageDashboardCopy.loadingTitle;
  const cumulativeBody = getUsageCumulativeBody({
    allTimeComparable,
    showMonthEmptyState,
  });
  const monthPricingBasisLabel = monthDashboard
    ? getUsagePricingBasisLabel(monthDashboard)
    : usageDashboardCopy.loadingTitle;
  const allTimePricingBasisLabel = allTimeDashboard
    ? getUsagePricingBasisLabel(allTimeDashboard)
    : usageDashboardCopy.loadingTitle;

  return (
    <section className="screen screen-usage">
      <header className="screen-header usage-screen-header">
        <div>
          <span className="screen-kicker">사용량 대시보드</span>
          <h1>{usageDashboardCopy.headline}</h1>
          <p>
            {usageDashboardCopy.intro}{' '}
            {desktopClient.available ? null : usageDashboardCopy.previewModeBody}
          </p>
        </div>

        <article className="hero-stat-card usage-proof-callout">
          <span className="hero-stat-label">{usageDashboardCopy.proofTitle}</span>
          <strong>{proofLabel}</strong>
          <p>{usageDashboardCopy.proofBody}</p>
          <div className="chip-row">
            <span className="badge badge-primary">이번 달 기준 비교</span>
            <span className="badge badge-muted">{monthPricingBasisLabel}</span>
            <span className="badge badge-success">한국어 요청 절감 화면</span>
            {!desktopClient.available ? (
              <span className="badge badge-muted">예시 데이터</span>
            ) : null}
          </div>
        </article>
      </header>

      {showLoadingState ? <UsageLoadingState /> : null}
      {showErrorState ? (
        <UsageErrorState
          message={
            monthUsageDashboardQuery.error?.message ??
            allTimeUsageDashboardQuery.error?.message ??
            null
          }
        />
      ) : null}
      {!showLoadingState && !showErrorState && showEmptyState ? <UsageEmptyState /> : null}

      {!showLoadingState && !showErrorState && !showEmptyState && monthDashboard && allTimeDashboard ? (
        <>
          <section
            className={`panel usage-cumulative-panel${allTimeComparable ? '' : ' usage-mixed-basis-panel'}`}
          >
            <div className="panel-header panel-header-stack">
              <div>
                <span className="panel-kicker">누적 절감</span>
                <h3>{usageDashboardCopy.cumulativeTitle}</h3>
                <p>{cumulativeBody}</p>
              </div>
              <span className="badge badge-success">{cumulativeLabel}</span>
            </div>

            <div className="chip-row">
              <span className="badge badge-muted">{allTimePricingBasisLabel}</span>
              <span className="badge badge-muted">{usageDashboardCopy.sourceFootnote}</span>
            </div>

            {allTimeComparable ? (
              <div className="usage-cumulative-grid">
                {cumulativeCards.map((card) => (
                  <article
                    key={card.id}
                    className={`usage-cumulative-card usage-cumulative-card-${card.tone}`}
                  >
                    <span className="metric-label">{card.label}</span>
                    <strong>{card.value}</strong>
                    <p>{card.detail}</p>
                  </article>
                ))}
              </div>
            ) : (
              <>
                <p className="usage-mixed-basis-copy">{usageDashboardCopy.cumulativeMixedBasisBody}</p>
                <div className="usage-basis-chip-list">
                  {allTimePricingBasisChips.map((chip) => (
                    <article
                      key={chip.id}
                      className="usage-basis-chip"
                    >
                      <strong>{chip.label}</strong>
                      <span>{chip.detail}</span>
                    </article>
                  ))}
                </div>
                <p className="usage-mixed-basis-footnote">{usageDashboardCopy.mixedBasisFootnote}</p>
              </>
            )}
          </section>

          {showMonthEmptyState ? (
            <section className="panel usage-month-empty-panel">
              <div className="panel-header panel-header-stack">
                <div>
                  <span className="panel-kicker">이번 달</span>
                  <h3>{usageDashboardCopy.monthEmptyTitle}</h3>
                  <p>{usageDashboardCopy.monthEmptyBody}</p>
                </div>
                <span className="badge badge-primary">{proofLabel}</span>
              </div>

              <p className="usage-mixed-basis-copy">{usageDashboardCopy.monthEmptyChecklist}</p>

              <div className="usage-empty-actions">
                <Link
                  to="/"
                  className="primary-button usage-empty-cta"
                >
                  {usageDashboardCopy.monthEmptyCta}
                </Link>
                <span className="badge badge-muted">{monthPricingBasisLabel}</span>
              </div>
            </section>
          ) : monthComparable ? (
            <>
              <div className="usage-summary-grid">
                {metricCards.map((card) => (
                  <article
                    key={card.id}
                    className={`panel usage-metric-card usage-metric-card-${card.tone}`}
                  >
                    <span className="metric-label">{card.label}</span>
                    <strong>{card.value}</strong>
                    <p>{card.detail}</p>
                  </article>
                ))}
              </div>

              <div className="usage-proof-layout">
                <section className="panel usage-proof-board">
                  <div className="panel-header panel-header-stack">
                    <div>
                      <span className="panel-kicker">이번 달 비교</span>
                      <h3>{usageDashboardCopy.comparisonTitle}</h3>
                      <p>{usageDashboardCopy.comparisonBody}</p>
                    </div>
                    <span className="savings-pill">{proofLabel}</span>
                  </div>

                  <div className="chip-row">
                    <span className="badge badge-muted">{monthPricingBasisLabel}</span>
                    <span className="badge badge-muted">{usageDashboardCopy.sourceFootnote}</span>
                  </div>

                  <div className="usage-comparison-ledger">
                    {comparisonCards.map((card) => (
                      <article
                        key={card.id}
                        className={`comparison-card usage-comparison-card usage-comparison-card-${card.tone}`}
                      >
                        <span className="starter-eyebrow">{card.eyebrow}</span>
                        <strong>{card.title}</strong>
                        <p>{card.body}</p>
                        <div className="usage-comparison-metrics">
                          <div>
                            <span className="metric-label">입력 토큰</span>
                            <strong>{card.inputTokensLabel}</strong>
                          </div>
                          <div>
                            <span className="metric-label">추정 비용</span>
                            <strong>{card.costLabel}</strong>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="usage-proof-ribbon">
                    <span className="panel-kicker">이번 달 변화</span>
                    <strong>
                      원문 그대로 보냈을 때보다 {monthDashboard.totals.tokenReduction.toLocaleString('ko-KR')} 토큰,
                      {' '}
                      {monthDashboard.totals.estimatedSavingsUsd.toFixed(2)}달러를 절감했습니다.
                    </strong>
                    <p>{usageDashboardCopy.sourceFootnote}</p>
                  </div>
                </section>

                <aside className="panel usage-breakdown-panel">
                  <div className="panel-header panel-header-stack">
                    <div>
                      <span className="panel-kicker">작업별 절감 흐름</span>
                      <h3>{usageDashboardCopy.breakdownTitle}</h3>
                      <p>{usageDashboardCopy.breakdownBody}</p>
                    </div>
                  </div>

                  <div className="usage-breakdown-list">
                    {monthDashboard.categories.map((category) => (
                      <article
                        key={category.id}
                        className="usage-category-row"
                      >
                        <div className="usage-category-header">
                          <div>
                            <strong>{category.label}</strong>
                            <p>{getUsageCategoryShareCopy(monthDashboard, category)}</p>
                          </div>
                          <span className="badge badge-muted">{category.savingsRate}% 절감</span>
                        </div>

                        <div className="usage-category-bar">
                          <span
                            className="usage-category-bar-fill"
                            style={{ width: `${Math.max(category.share, category.requestCount > 0 ? 8 : 0)}%` }}
                          />
                        </div>

                        <div className="usage-category-metrics">
                          <span>원문 {category.baselineTokens.toLocaleString('ko-KR')} 토큰</span>
                          <span>최적화 {category.optimizedTokens.toLocaleString('ko-KR')} 토큰</span>
                          <span className="usage-category-metric-savings">
                            {category.tokenReduction.toLocaleString('ko-KR')} 토큰 감소
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </aside>
              </div>
            </>
          ) : (
            <section className="panel usage-mixed-basis-panel">
              <div className="panel-header panel-header-stack">
                <div>
                  <span className="panel-kicker">이번 달 비교 보류</span>
                  <h3>{usageDashboardCopy.mixedBasisTitle}</h3>
                  <p>{usageDashboardCopy.mixedBasisBody}</p>
                </div>
                <span className="badge badge-primary">{proofLabel}</span>
              </div>

              <div className="usage-basis-chip-list">
                {monthPricingBasisChips.map((chip) => (
                  <article
                    key={chip.id}
                    className="usage-basis-chip"
                  >
                    <strong>{chip.label}</strong>
                    <span>{chip.detail}</span>
                  </article>
                ))}
              </div>

              <div className="usage-breakdown-list">
                {monthDashboard.categories
                  .filter((category) => category.requestCount > 0)
                  .map((category) => (
                    <article
                      key={category.id}
                      className="usage-category-row"
                    >
                      <div className="usage-category-header">
                        <div>
                          <strong>{category.label}</strong>
                          <p>{getUsageCategoryShareCopy(monthDashboard, category)}</p>
                        </div>
                        <span className="badge badge-muted">비교 잠시 보류</span>
                      </div>

                      <div className="usage-category-bar">
                        <span
                          className="usage-category-bar-fill"
                          style={{ width: `${Math.max(category.share, category.requestCount > 0 ? 8 : 0)}%` }}
                        />
                      </div>

                      <div className="usage-category-metrics">
                        <span>{category.requestCount}건 기록</span>
                        <span>{usageDashboardCopy.mixedBasisFootnote}</span>
                      </div>
                    </article>
                  ))}
              </div>
            </section>
          )}
        </>
      ) : null}
    </section>
  );
}
