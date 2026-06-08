import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import { useDesktopQuery } from '../lib/ipc/query-hooks';
import {
  formatHistoryTimestamp,
  getHistoryAdvancedReveals,
  getHistoryArtifactSections,
  getHistoryListMeta,
  getHistoryModeLabel,
  getHistoryUsageCards,
  historyInspectionCopy,
  previewHistoryEntries,
  previewHistoryFeed,
} from './history-surface';
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

function HistoryLoadingState() {
  return (
    <section className="panel usage-history-state-card">
      <span className="panel-kicker">히스토리 불러오는 중</span>
      <strong>{historyInspectionCopy.sectionTitle}</strong>
      <p>{historyInspectionCopy.sectionBody}</p>
    </section>
  );
}

function HistoryErrorState({ message }: { message: string | null }) {
  return (
    <section className="panel usage-history-state-card usage-history-state-card-error">
      <span className="panel-kicker">히스토리 읽기 실패</span>
      <strong>{historyInspectionCopy.sectionTitle}</strong>
      <p>저장된 대화와 절감 기록은 그대로 있습니다. 잠시 후 다시 열어 보세요.</p>
      {message ? <span className="badge badge-muted">{message}</span> : null}
    </section>
  );
}

function HistoryEmptyState() {
  return (
    <section className="panel usage-history-state-card">
      <span className="panel-kicker">아직 실행 없음</span>
      <strong>{historyInspectionCopy.emptyTitle}</strong>
      <p>{historyInspectionCopy.emptyBody}</p>
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
  const historyFeedDescriptor = createDesktopQueryDescriptor('getHistoryFeed', {});
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
  const historyFeedQuery = useDesktopQuery(
    queryCache,
    historyFeedDescriptor,
    { enabled: desktopClient.available },
  );
  const historyFeed = desktopClient.available
    ? historyFeedQuery.data
    : previewHistoryFeed;
  const [selectedHistoryRunId, setSelectedHistoryRunId] = useState<string | null>(
    desktopClient.available ? null : previewHistoryFeed.items[0]?.runId ?? null,
  );
  const [showOptimizedPrompt, setShowOptimizedPrompt] = useState(false);
  const [showProviderResponse, setShowProviderResponse] = useState(false);
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
  const historyItems = historyFeed?.items ?? [];
  const historyDetailRunId =
    selectedHistoryRunId ??
    historyItems[0]?.runId ??
    (desktopClient.available ? null : previewHistoryFeed.items[0]?.runId ?? null);
  const historyEntryDescriptor = createDesktopQueryDescriptor('getHistoryEntry', {
    runId: historyDetailRunId ?? '__history_preview__',
  });
  const historyEntryQuery = useDesktopQuery(
    queryCache,
    historyEntryDescriptor,
    {
      enabled: desktopClient.available && historyDetailRunId !== null,
    },
  );
  const selectedHistoryEntry =
    desktopClient.available
      ? historyEntryQuery.data
      : (historyDetailRunId ? previewHistoryEntries[historyDetailRunId] ?? null : null);
  const historyUsageCards = selectedHistoryEntry ? getHistoryUsageCards(selectedHistoryEntry) : [];
  const historyArtifactSections = selectedHistoryEntry
    ? getHistoryArtifactSections(selectedHistoryEntry, {
        showOptimizedPrompt,
        showProviderResponse,
      })
    : [];
  const historyAdvancedReveals = selectedHistoryEntry
    ? getHistoryAdvancedReveals(selectedHistoryEntry, {
        showOptimizedPrompt,
        showProviderResponse,
      })
    : [];
  const showHistoryLoadingState =
    desktopClient.available &&
    historyFeedQuery.status === 'loading' &&
    !historyFeedQuery.data;
  const showHistoryErrorState =
    desktopClient.available &&
    historyFeedQuery.status === 'error' &&
    !historyFeedQuery.data;
  const showHistoryEmptyState =
    !showHistoryLoadingState &&
    !showHistoryErrorState &&
    historyItems.length === 0;

  useEffect(() => {
    const firstRunId = historyItems[0]?.runId ?? null;

    if (!selectedHistoryRunId && firstRunId) {
      setSelectedHistoryRunId(firstRunId);
      return;
    }

    if (
      selectedHistoryRunId &&
      !historyItems.some((item) => item.runId === selectedHistoryRunId)
    ) {
      setSelectedHistoryRunId(firstRunId);
    }
  }, [historyItems, selectedHistoryRunId]);

  useEffect(() => {
    setShowOptimizedPrompt(false);
    setShowProviderResponse(false);
  }, [historyDetailRunId]);

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

      {!showLoadingState && !showErrorState && !showEmptyState ? (
        <>
          {showHistoryLoadingState ? <HistoryLoadingState /> : null}
          {showHistoryErrorState ? (
            <HistoryErrorState message={historyFeedQuery.error?.message ?? null} />
          ) : null}
          {showHistoryEmptyState ? <HistoryEmptyState /> : null}

          {!showHistoryLoadingState && !showHistoryErrorState && !showHistoryEmptyState ? (
            <section className="panel usage-history-panel">
              <div className="panel-header panel-header-stack">
                <div>
                  <span className="panel-kicker">{historyInspectionCopy.sectionKicker}</span>
                  <h3>{historyInspectionCopy.sectionTitle}</h3>
                  <p>{historyInspectionCopy.sectionBody}</p>
                </div>
                <div className="chip-row">
                  <span className="badge badge-primary">{historyInspectionCopy.listTitle}</span>
                  {!desktopClient.available ? (
                    <span className="badge badge-muted">예시 히스토리</span>
                  ) : null}
                </div>
              </div>

              <div className="usage-history-layout">
                <aside className="usage-history-list">
                  <div className="usage-history-list-header">
                    <div>
                      <span className="panel-kicker">{historyInspectionCopy.listTitle}</span>
                      <p>{historyInspectionCopy.listBody}</p>
                    </div>
                    <span className="badge badge-muted">{historyItems.length}개 실행</span>
                  </div>

                  <div className="usage-history-list-rows">
                    {historyItems.map((item) => (
                      <button
                        key={item.runId}
                        type="button"
                        className={
                          item.runId === historyDetailRunId
                            ? 'usage-history-row usage-history-row-active'
                            : 'usage-history-row'
                        }
                        onClick={() => {
                          setSelectedHistoryRunId(item.runId);
                        }}
                      >
                        <span className="starter-eyebrow">{item.title}</span>
                        <strong>{item.finalResponsePreview}</strong>
                        <div className="usage-history-row-meta">
                          <span>{getHistoryListMeta(item)}</span>
                          <span>{formatHistoryTimestamp(item.completedAt)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </aside>

                <section className="usage-history-detail">
                  {desktopClient.available &&
                  historyDetailRunId !== null &&
                  historyEntryQuery.status === 'loading' &&
                  !historyEntryQuery.data ? (
                    <article className="usage-history-detail-state">
                      <span className="panel-kicker">상세 불러오는 중</span>
                      <strong>{historyInspectionCopy.detailTitle}</strong>
                      <p>{historyInspectionCopy.detailBody}</p>
                    </article>
                  ) : desktopClient.available &&
                    historyDetailRunId !== null &&
                    historyEntryQuery.status === 'error' &&
                    !historyEntryQuery.data ? (
                    <article className="usage-history-detail-state usage-history-detail-state-error">
                      <span className="panel-kicker">상세 읽기 실패</span>
                      <strong>{historyInspectionCopy.detailTitle}</strong>
                      <p>{historyEntryQuery.error?.message ?? '저장된 실행 상세를 읽지 못했습니다.'}</p>
                    </article>
                  ) : selectedHistoryEntry ? (
                    <>
                      <header className="usage-history-detail-header">
                        <div>
                          <span className="panel-kicker">{historyInspectionCopy.detailTitle}</span>
                          <h4>{selectedHistoryEntry.title}</h4>
                          <p>{historyInspectionCopy.detailBody}</p>
                        </div>
                        <div className="usage-history-detail-badges">
                          <span className="badge badge-primary">
                            {selectedHistoryEntry.model} · {getHistoryModeLabel(selectedHistoryEntry.mode)}
                          </span>
                          <span className="badge badge-success">
                            {selectedHistoryEntry.usage.savingsRate}% 절감
                          </span>
                          <span className="badge badge-muted">
                            {formatHistoryTimestamp(selectedHistoryEntry.completedAt)}
                          </span>
                        </div>
                      </header>

                      <div className="usage-history-metrics">
                        {historyUsageCards.map((card) => (
                          <article
                            key={card.id}
                            className={
                              card.tone === 'savings'
                                ? 'usage-history-metric-card usage-history-metric-card-savings'
                                : 'usage-history-metric-card'
                            }
                          >
                            <span className="metric-label">{card.label}</span>
                            <strong>{card.value}</strong>
                            <p>{card.detail}</p>
                          </article>
                        ))}
                      </div>

                      <div className="usage-history-artifact-list">
                        {historyArtifactSections
                          .filter((section) => section.visibility === 'default')
                          .map((section) => (
                            <article
                              key={section.id}
                              className={`usage-history-artifact-card usage-history-artifact-card-${section.tone}`}
                            >
                              <div className="usage-history-artifact-header">
                                <div>
                                  <span className="panel-kicker">{section.label}</span>
                                  {section.tokenLabel ? <strong>{section.tokenLabel}</strong> : null}
                                </div>
                                <span className="badge badge-muted">
                                  {section.tone === 'result' ? '바로 읽기' : '저장된 원문'}
                                </span>
                              </div>
                              <pre className="usage-history-artifact-body">{section.body}</pre>
                            </article>
                          ))}
                      </div>

                      {historyAdvancedReveals.length > 0 ? (
                        <div className="usage-history-reveal-list">
                          {historyAdvancedReveals.map((reveal) => (
                            <div
                              key={reveal.id}
                              className="usage-history-reveal-item"
                            >
                              <button
                                type="button"
                                className="soft-button usage-history-reveal-button"
                                aria-expanded={reveal.expanded}
                                aria-controls={`${selectedHistoryEntry.runId}-${reveal.id}`}
                                onClick={() => {
                                  if (reveal.id === 'optimized_prompt_en') {
                                    setShowOptimizedPrompt((current) => !current);
                                    return;
                                  }

                                  setShowProviderResponse((current) => !current);
                                }}
                              >
                                {reveal.label}
                              </button>
                              <p>{reveal.helper}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div className="usage-history-artifact-list">
                        {historyArtifactSections
                          .filter((section) => section.visibility === 'advanced')
                          .map((section) => (
                            <article
                              key={section.id}
                              id={`${selectedHistoryEntry.runId}-${section.id}`}
                              className="usage-history-artifact-card usage-history-artifact-card-advanced"
                            >
                              <div className="usage-history-artifact-header">
                                <div>
                                  <span className="panel-kicker">{section.label}</span>
                                  {section.tokenLabel ? <strong>{section.tokenLabel}</strong> : null}
                                </div>
                                <span className="badge badge-muted">고급 보기</span>
                              </div>
                              <pre className="usage-history-artifact-body">{section.body}</pre>
                            </article>
                          ))}
                      </div>

                      {selectedHistoryEntry.usage.isEstimated ? (
                        <p className="usage-history-footnote">{historyInspectionCopy.estimatedFootnote}</p>
                      ) : null}
                    </>
                  ) : (
                    <article className="usage-history-detail-state">
                      <span className="panel-kicker">선택 대기</span>
                      <strong>{historyInspectionCopy.detailTitle}</strong>
                      <p>{historyInspectionCopy.emptyBody}</p>
                    </article>
                  )}
                </section>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
